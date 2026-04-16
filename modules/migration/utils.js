// modules/migration/utils.js
// 通用工具：路径安全、文件 copy、zip 归档、尺寸计算
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const archiver = require('archiver');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// 路径穿越防护：确保 childPath 在 parentPath 范围内
function assertWithinRoot(parentPath, childPath) {
    const absParent = path.resolve(parentPath);
    const absChild = path.resolve(childPath);
    const rel = path.relative(absParent, absChild);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path escape detected: ${childPath} not within ${parentPath}`);
    }
    return absChild;
}

// 目录是否合法的上游 VCPToolBox 根（至少包含这些标志）
function isValidUpstreamRoot(dir) {
    const markers = ['Plugin.js', 'server.js', 'Plugin', 'Agent', 'TVStxt'];
    const exists = markers.every(m => fs.existsSync(path.join(dir, m)));
    return exists;
}

// 递归 copy 目录（带 excludes）
async function copyDir(src, dest, excludes = []) {
    const stat = await fsp.stat(src);
    if (stat.isFile()) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(src, dest);
        return 1;
    }
    await fsp.mkdir(dest, { recursive: true });
    let count = 0;
    for (const entry of await fsp.readdir(src)) {
        if (excludes.some(ex => entry === ex || entry.includes(ex))) continue;
        count += await copyDir(path.join(src, entry), path.join(dest, entry), excludes);
    }
    return count;
}

// 计算目录大小（字节）
async function dirSize(dir) {
    try {
        const st = await fsp.stat(dir);
        if (st.isFile()) return st.size;
        let total = 0;
        for (const entry of await fsp.readdir(dir)) {
            total += await dirSize(path.join(dir, entry));
        }
        return total;
    } catch {
        return 0;
    }
}

// 人类可读的大小
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 生成 zip 归档（流式）
// entries: [{ source: absPath, archivePath: 'relative/in/zip' }]
async function createZip(destZipPath, entries) {
    await fsp.mkdir(path.dirname(destZipPath), { recursive: true });
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destZipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });
        output.on('close', () => resolve({ size: archive.pointer(), path: destZipPath }));
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        for (const ent of entries) {
            if (!fs.existsSync(ent.source)) continue;
            const st = fs.statSync(ent.source);
            if (st.isDirectory()) {
                archive.directory(ent.source, ent.archivePath);
            } else {
                archive.file(ent.source, { name: ent.archivePath });
            }
        }
        archive.finalize();
    });
}

// ISO 时间戳（文件名用，去特殊字符）
function tsLabel() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

module.exports = {
    PROJECT_ROOT,
    assertWithinRoot,
    isValidUpstreamRoot,
    copyDir,
    dirSize,
    formatSize,
    createZip,
    tsLabel,
};
