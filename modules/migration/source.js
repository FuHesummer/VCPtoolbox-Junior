// modules/migration/source.js
// 源适配器：把多种输入（本地目录 / VCPBackUp zip / 嵌套 Full zip）归一为一个"可扫描目录"
// 产出 { tempRoot, cleanup, type, meta }；cleanup 由调用方在任务完成后调
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const unzipper = require('unzipper');
const { PROJECT_ROOT, isValidUpstreamRoot } = require('./utils');

const TEMP_ROOT = path.join(PROJECT_ROOT, 'data', 'migration-temp');

// 最大解压尺寸（防 zip 炸弹）
const MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_FILE_COUNT = 200000;

// 源类型
const SOURCE_TYPE = {
    DIR: 'dir',
    VCP_SERVER_ZIP: 'vcpserver-zip',   // VCPServer_Backup_*.zip（扁平后端包）
    VCP_FULL_ZIP: 'vcpfull-zip',        // VCP_Full_Backup*.zip（含嵌套 zip）
    GENERIC_ZIP: 'generic-zip',         // 其他 zip（尽量当 VCPServer 包处理）
};

/**
 * 解析源：支持本地目录或 zip 文件路径
 * @param {string} sourcePath 绝对路径
 * @returns {Promise<{ tempRoot, cleanup, type, meta }>}
 *   - tempRoot: 最终可扫描的目录（dir 情况下 = sourcePath；zip 情况下 = 临时解压目录）
 *   - cleanup: async () => void（dir 情况下是 no-op；zip 情况下删临时目录）
 *   - type: SOURCE_TYPE.*
 *   - meta: { originalPath, innerZip?, innerExtracted? }
 */
async function resolveSource(sourcePath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error(`source path not exists: ${sourcePath}`);
    }
    const st = await fsp.stat(sourcePath);

    if (st.isDirectory()) {
        return {
            tempRoot: sourcePath,
            cleanup: async () => {},
            type: SOURCE_TYPE.DIR,
            meta: { originalPath: sourcePath },
        };
    }

    // 文件：必须是 zip
    if (!/\.zip$/i.test(sourcePath)) {
        throw new Error(`unsupported source: ${sourcePath} (only directory or .zip allowed)`);
    }

    const baseName = path.basename(sourcePath);
    const isFullZip = /VCP_Full_Backup/i.test(baseName);

    await fsp.mkdir(TEMP_ROOT, { recursive: true });
    const tempDirName = `src-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tempDir = path.join(TEMP_ROOT, tempDirName);
    await fsp.mkdir(tempDir, { recursive: true });

    try {
        if (isFullZip) {
            // 嵌套：先解压外层到 temp/_outer，找 VCPServer_Backup_*.zip 再解到最终 temp
            const outerDir = path.join(tempDir, '_outer');
            await fsp.mkdir(outerDir, { recursive: true });
            await extractZip(sourcePath, outerDir);

            const inner = findInnerZip(outerDir, /VCPServer_Backup.*\.zip$/i);
            if (!inner) {
                throw new Error('VCP_Full_Backup zip inside missing VCPServer_Backup_*.zip');
            }
            await extractZip(inner, tempDir, [outerDir]);

            return {
                tempRoot: tempDir,
                cleanup: () => cleanupDir(tempDir),
                type: SOURCE_TYPE.VCP_FULL_ZIP,
                meta: {
                    originalPath: sourcePath,
                    innerZip: path.basename(inner),
                    innerExtracted: tempDir,
                },
            };
        }

        // 单层（VCPServer_Backup_*.zip 或其他）
        await extractZip(sourcePath, tempDir);
        const detectedType = /VCPServer_Backup/i.test(baseName)
            ? SOURCE_TYPE.VCP_SERVER_ZIP
            : SOURCE_TYPE.GENERIC_ZIP;

        return {
            tempRoot: tempDir,
            cleanup: () => cleanupDir(tempDir),
            type: detectedType,
            meta: { originalPath: sourcePath },
        };
    } catch (e) {
        // 失败时清理临时目录
        await cleanupDir(tempDir).catch(() => {});
        throw e;
    }
}

// 解压 zip 到 destDir，带安全检查（zip 穿越 / 尺寸限制）
// 用 unzipper.Open 串行处理 entries，避免 Parse 流的 async race
async function extractZip(zipPath, destDir, excludeDirs = []) {
    const absDest = path.resolve(destDir);
    const excludedAbs = excludeDirs.map(e => path.resolve(e));
    const directory = await unzipper.Open.file(zipPath);

    let totalSize = 0;
    let fileCount = 0;

    for (const entry of directory.files) {
        // 路径穿越防护
        const target = path.resolve(absDest, entry.path);
        const rel = path.relative(absDest, target);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
        if (excludedAbs.some(ex => target.startsWith(ex))) continue;

        if (entry.type === 'Directory') {
            await fsp.mkdir(target, { recursive: true });
            continue;
        }

        fileCount++;
        if (fileCount > MAX_FILE_COUNT) {
            throw new Error(`zip too many files: >${MAX_FILE_COUNT}`);
        }

        await fsp.mkdir(path.dirname(target), { recursive: true });

        // 流式解压 + 尺寸守门
        await new Promise((resolve, reject) => {
            const rs = entry.stream();
            const ws = fs.createWriteStream(target);
            let fileSize = 0;
            rs.on('data', chunk => {
                fileSize += chunk.length;
                totalSize += chunk.length;
                if (totalSize > MAX_UNCOMPRESSED_SIZE) {
                    rs.destroy(new Error(`zip too large: >${MAX_UNCOMPRESSED_SIZE}`));
                }
            });
            rs.on('error', reject);
            ws.on('error', reject);
            ws.on('close', resolve);
            rs.pipe(ws);
        });
    }
}

// 在目录中找第一个匹配 pattern 的 zip 文件（仅顶层）
function findInnerZip(dir, pattern) {
    try {
        const entries = fs.readdirSync(dir);
        for (const ent of entries) {
            if (pattern.test(ent)) return path.join(dir, ent);
        }
    } catch {}
    return null;
}

// 放宽版上游目录校验：只要有 Agent / TVStxt / Plugin 就算 VCP 包
// （VCPBackUp 产出的 zip 解压后可能没有 Plugin.js/server.js —— 因为它只压 .txt/.md/.env/.json）
function isValidRestoredRoot(dir) {
    const hasAny = ['Agent', 'TVStxt', 'Plugin'].some(m => fs.existsSync(path.join(dir, m)));
    return hasAny;
}

// 统一校验：严格模式用 utils.isValidUpstreamRoot，宽松模式用本地
function validateSourceRoot(dir, strict = false) {
    if (strict) return isValidUpstreamRoot(dir);
    return isValidRestoredRoot(dir);
}

async function cleanupDir(dir) {
    try {
        await fsp.rm(dir, { recursive: true, force: true });
    } catch {}
}

// 清理所有迁移临时目录（面板/定时任务可调用）
async function cleanupAllTemp() {
    try {
        if (!fs.existsSync(TEMP_ROOT)) return { removed: 0 };
        const entries = await fsp.readdir(TEMP_ROOT);
        let removed = 0;
        for (const ent of entries) {
            if (!ent.startsWith('src-')) continue;
            await cleanupDir(path.join(TEMP_ROOT, ent));
            removed++;
        }
        return { removed };
    } catch (e) {
        return { removed: 0, error: e.message };
    }
}

// 列出当前残留的临时目录（诊断用）
async function listTempDirs() {
    try {
        if (!fs.existsSync(TEMP_ROOT)) return [];
        const entries = await fsp.readdir(TEMP_ROOT, { withFileTypes: true });
        const result = [];
        for (const ent of entries) {
            if (!ent.isDirectory() || !ent.name.startsWith('src-')) continue;
            const p = path.join(TEMP_ROOT, ent.name);
            const st = await fsp.stat(p).catch(() => null);
            if (st) {
                result.push({
                    name: ent.name,
                    path: p,
                    createdAt: st.birthtime?.toISOString?.() || st.ctime?.toISOString?.(),
                });
            }
        }
        return result;
    } catch {
        return [];
    }
}

module.exports = {
    SOURCE_TYPE,
    TEMP_ROOT,
    resolveSource,
    validateSourceRoot,
    cleanupAllTemp,
    listTempDirs,
};
