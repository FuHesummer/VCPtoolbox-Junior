// modules/migration/export.js
// 导出 VCPBackUp 兼容的 zip（与上游 lioensky/VCPBcakUpDEV 产出格式一致）
// 扁平过滤 .txt/.md/.env/.json，排除已知大缓存
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const archiver = require('archiver');
const { PROJECT_ROOT, formatSize } = require('./utils');

// 输出目录（与 migration-backup 平行，专门放 VCPBackUp 风格的"外送"包）
const EXPORT_DIR = path.join(PROJECT_ROOT, 'data', 'migration-export');

const INCLUDE_EXTENSIONS = new Set(['.txt', '.md', '.env', '.json']);
const EXCLUDE_DIR_NAMES = new Set([
    '.git', '__pycache__', 'node_modules', '.venv', 'venv',
    'DebugLog', 'VCPAsyncResults', '.file_cache',
    'migration-temp', 'migration-backup', 'migration-export',
]);
const EXCLUDE_PATHS = [
    // 与上游排除一致
    path.join('dailynote', 'MusicDiary').replace(/\\/g, '/'),
    path.join('Plugin', 'ImageProcessor', 'multimodal_cache.json').replace(/\\/g, '/'),
    path.join('Plugin', 'TarotDivination', 'celestial_database.json').replace(/\\/g, '/'),
    // Junior 额外排除：不暴露内部大型运行数据
    path.join('data', 'migration-temp').replace(/\\/g, '/'),
    path.join('data', 'migration-backup').replace(/\\/g, '/'),
    path.join('data', 'migration-export').replace(/\\/g, '/'),
    path.join('knowledge', 'MusicDiary').replace(/\\/g, '/'),
];

// 时间戳（与上游命名一致：YYYYMMDD_HHMMSS）
function tsCompat() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 扁平扫描 PROJECT_ROOT，按 VCPBackUp 规则筛选
 * @returns {Promise<string[]>} 绝对路径数组
 */
async function scanBackupFiles(sourceRoot = PROJECT_ROOT) {
    const results = [];
    const stack = ['.'];
    const absRoot = path.resolve(sourceRoot);

    while (stack.length > 0) {
        const rel = stack.pop();
        const abs = path.join(absRoot, rel);
        let entries = [];
        try {
            entries = await fsp.readdir(abs, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            const relChild = rel === '.' ? ent.name : path.join(rel, ent.name);
            const relPosix = relChild.replace(/\\/g, '/');

            if (ent.isDirectory()) {
                if (EXCLUDE_DIR_NAMES.has(ent.name)) continue;
                if (EXCLUDE_PATHS.some(p => relPosix === p || relPosix.startsWith(p + '/'))) continue;
                stack.push(relChild);
                continue;
            }
            if (!ent.isFile()) continue;

            const ext = path.extname(ent.name).toLowerCase();
            if (!INCLUDE_EXTENSIONS.has(ext)) continue;
            if (EXCLUDE_PATHS.some(p => relPosix === p)) continue;

            results.push(path.join(absRoot, relChild));
        }
    }
    return results;
}

/**
 * 导出 VCPServer_Backup_*.zip（扁平过滤版，与上游格式一致）
 * @param {object} opts { timestamp?, outputDir?, filename?, onProgress? }
 */
async function exportVcpServerBackup(opts = {}) {
    const outputDir = opts.outputDir || EXPORT_DIR;
    await fsp.mkdir(outputDir, { recursive: true });
    const ts = opts.timestamp || tsCompat();
    const filename = opts.filename || `VCPServer_Backup_${ts}.zip`;
    const zipPath = path.join(outputDir, filename);

    const files = await scanBackupFiles(PROJECT_ROOT);
    const total = files.length;

    const size = await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });
        out.on('close', () => resolve(archive.pointer()));
        out.on('error', reject);
        archive.on('error', reject);
        archive.pipe(out);

        let appended = 0;
        const absRoot = path.resolve(PROJECT_ROOT);
        for (const f of files) {
            try {
                const rel = path.relative(absRoot, f).replace(/\\/g, '/');
                archive.file(f, { name: rel });
                appended++;
                if (opts.onProgress && (appended % 200 === 0 || appended === total)) {
                    opts.onProgress({ appended, total });
                }
            } catch {}
        }
        archive.finalize();
    });

    return {
        ok: true,
        // 与 listExports 字段对齐：name=filename, absPath=zipPath, type 自动
        name: filename,
        filename,
        zipPath,
        absPath: zipPath,
        relPath: path.relative(PROJECT_ROOT, zipPath),
        fileCount: total,
        size,
        sizeHuman: formatSize(size),
        createdAt: new Date().toISOString(),
        type: 'server',
    };
}

/**
 * 导出 VCP_Full_Backup.zip（外层合成包，内含 VCPServer zip；上游固定文件名便于 WebDAV 覆盖）
 * @param {object} opts { vcpServerZipPath?, onProgress? }
 */
async function exportFullBackup(opts = {}) {
    const vcpServerZip = opts.vcpServerZipPath
        ? opts.vcpServerZipPath
        : (await exportVcpServerBackup(opts)).zipPath;

    const outputDir = opts.outputDir || EXPORT_DIR;
    await fsp.mkdir(outputDir, { recursive: true });
    const fullPath = path.join(outputDir, opts.filename || 'VCP_Full_Backup.zip');

    const size = await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(fullPath);
        const archive = archiver('zip', { zlib: { level: 6 } });
        out.on('close', () => resolve(archive.pointer()));
        out.on('error', reject);
        archive.on('error', reject);
        archive.pipe(out);
        archive.file(vcpServerZip, { name: path.basename(vcpServerZip) });
        archive.finalize();
    });

    return {
        ok: true,
        name: path.basename(fullPath),
        filename: path.basename(fullPath),
        zipPath: fullPath,
        absPath: fullPath,
        relPath: path.relative(PROJECT_ROOT, fullPath),
        innerZip: path.basename(vcpServerZip),
        size,
        sizeHuman: formatSize(size),
        createdAt: new Date().toISOString(),
        type: 'full',
    };
}

// 列出所有导出包
async function listExports() {
    try {
        await fsp.mkdir(EXPORT_DIR, { recursive: true });
        const files = await fsp.readdir(EXPORT_DIR);
        const results = [];
        for (const f of files) {
            if (!f.endsWith('.zip')) continue;
            const p = path.join(EXPORT_DIR, f);
            const st = await fsp.stat(p);
            results.push({
                name: f,
                relPath: path.relative(PROJECT_ROOT, p),
                absPath: p,
                size: st.size,
                sizeHuman: formatSize(st.size),
                createdAt: st.mtime.toISOString(),
                type: /VCP_Full_Backup/i.test(f) ? 'full' : 'server',
            });
        }
        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return results;
    } catch {
        return [];
    }
}

// 滚动保留（按数量或保留天数）
async function rotateExports(keepCount = 10, keepDays = 0) {
    try {
        const items = await listExports();
        const now = Date.now();
        const toDelete = [];
        // 先超过天数的
        if (keepDays > 0) {
            for (const it of items) {
                const age = (now - new Date(it.createdAt).getTime()) / (1000 * 86400);
                if (age > keepDays) toDelete.push(it);
            }
        }
        // 再超量删（排除 VCP_Full_Backup.zip，因为它是固定文件名覆盖）
        const remainings = items.filter(it => !toDelete.includes(it) && it.type === 'server');
        const overflow = remainings.slice(keepCount);
        toDelete.push(...overflow);

        const uniq = Array.from(new Set(toDelete.map(it => it.absPath)));
        for (const p of uniq) {
            await fsp.unlink(p).catch(() => {});
        }
        return { deleted: uniq.length, kept: items.length - uniq.length };
    } catch (e) {
        return { deleted: 0, error: e.message };
    }
}

module.exports = {
    EXPORT_DIR,
    scanBackupFiles,
    exportVcpServerBackup,
    exportFullBackup,
    listExports,
    rotateExports,
    tsCompat,
};
