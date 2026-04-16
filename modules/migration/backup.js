// modules/migration/backup.js
// 迁移前自动 zip 备份 Junior 当前关键数据
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT, createZip, tsLabel, formatSize } = require('./utils');

const BACKUP_DIR = path.join(PROJECT_ROOT, 'data', 'migration-backup');
const MAX_BACKUPS = 10; // 保留最近 10 个

// 核心待备份路径（都是相对 PROJECT_ROOT）
const BACKUP_ITEMS = [
    'Agent',
    'knowledge',
    'thinking',
    'TVStxt',
    'config.env',
    'agent_map.json',
    'plugin-ui-prefs.json',
    // Junior 独有的数据（可能与迁移相关）
    'data/panel-registry.json',
    'data/dashboardLayout.json',
    'data/dashboard-bubbles.json',
];

async function backupCurrent(label) {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });

    const tag = label ? `${label}_${tsLabel()}` : tsLabel();
    const zipPath = path.join(BACKUP_DIR, `backup_${tag}.zip`);

    const entries = [];
    for (const item of BACKUP_ITEMS) {
        const abs = path.join(PROJECT_ROOT, item);
        if (!fs.existsSync(abs)) continue;
        entries.push({ source: abs, archivePath: item });
    }

    if (entries.length === 0) {
        return { success: false, reason: 'nothing to backup', zipPath: null };
    }

    const { size } = await createZip(zipPath, entries);
    await rotateBackups();

    return {
        success: true,
        zipPath,
        relPath: path.relative(PROJECT_ROOT, zipPath),
        size,
        sizeHuman: formatSize(size),
        items: entries.map(e => e.archivePath),
        createdAt: new Date().toISOString(),
    };
}

// 保留最近 MAX_BACKUPS，旧的删除
async function rotateBackups() {
    try {
        const files = await fsp.readdir(BACKUP_DIR);
        const zips = [];
        for (const f of files) {
            if (!f.endsWith('.zip')) continue;
            const p = path.join(BACKUP_DIR, f);
            const st = await fsp.stat(p);
            zips.push({ path: p, mtime: st.mtimeMs });
        }
        zips.sort((a, b) => b.mtime - a.mtime);
        const toDelete = zips.slice(MAX_BACKUPS);
        for (const z of toDelete) {
            await fsp.unlink(z.path).catch(() => {});
        }
    } catch {}
}

async function listBackups() {
    try {
        await fsp.mkdir(BACKUP_DIR, { recursive: true });
        const files = await fsp.readdir(BACKUP_DIR);
        const results = [];
        for (const f of files) {
            if (!f.endsWith('.zip')) continue;
            const p = path.join(BACKUP_DIR, f);
            const st = await fsp.stat(p);
            results.push({
                name: f,
                relPath: path.relative(PROJECT_ROOT, p),
                size: st.size,
                sizeHuman: formatSize(st.size),
                createdAt: st.mtime.toISOString(),
            });
        }
        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return results;
    } catch (e) {
        return [];
    }
}

module.exports = { backupCurrent, listBackups, BACKUP_DIR };
