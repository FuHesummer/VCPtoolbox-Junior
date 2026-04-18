// modules/migration/schedule.js
// 定期备份调度器：用 node-schedule（已在依赖）cron 执行 export → 可选 WebDAV 上传
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const schedule = require('node-schedule');
const { PROJECT_ROOT } = require('./utils');
const { exportVcpServerBackup, exportFullBackup, rotateExports } = require('./export');
const webdav = require('./webdav');

const CONFIG_PATH = path.join(PROJECT_ROOT, 'data', 'backup-schedule.json');
const HISTORY_PATH = path.join(PROJECT_ROOT, 'data', 'backup-history.json');
const MAX_HISTORY = 50;

const DEFAULT_CONFIG = {
    enabled: false,
    cron: '0 3 * * *',               // 每天凌晨 3 点
    keepCount: 10,
    keepDays: 0,                      // 0 = 不按天数清理
    uploadToWebdav: false,            // 备份后是否上传坚果云
    uploadAsFull: true,               // true=VCP_Full_Backup.zip（固定覆盖） / false=带时间戳
    lastRun: null,
    lastStatus: null,
};

let currentJob = null;

async function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
        const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

async function saveConfig(config) {
    await fsp.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    const merged = { ...DEFAULT_CONFIG, ...config };
    await fsp.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
}

async function loadHistory() {
    try {
        if (!fs.existsSync(HISTORY_PATH)) return [];
        return JSON.parse(await fsp.readFile(HISTORY_PATH, 'utf8'));
    } catch {
        return [];
    }
}

async function appendHistory(entry) {
    try {
        const arr = await loadHistory();
        arr.unshift(entry);
        if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
        await fsp.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
        await fsp.writeFile(HISTORY_PATH, JSON.stringify(arr, null, 2), 'utf8');
    } catch {}
}

/**
 * 立即执行一次备份 + 可选上传。面板和 cron 都调这个。
 */
async function runOnce(opts = {}) {
    const config = await loadConfig();
    const startedAt = new Date().toISOString();
    const entry = {
        startedAt,
        trigger: opts.trigger || 'manual',
        uploadToWebdav: !!(opts.uploadToWebdav ?? config.uploadToWebdav),
        uploadAsFull: !!(opts.uploadAsFull ?? config.uploadAsFull),
        stages: {},
        status: 'running',
    };

    try {
        // 1. 导出 VCPServer_Backup_xxx.zip
        const srv = await exportVcpServerBackup();
        entry.stages.export = srv;

        // 2. 如需上传 → 构建 Full 或直传 Server zip
        if (entry.uploadToWebdav) {
            const wdConfig = webdav.getConfig();
            if (!wdConfig.user || !wdConfig.password) {
                throw new Error('坚果云未配置，无法上传');
            }
            await webdav.mkcol().catch(() => {});

            if (entry.uploadAsFull) {
                const full = await exportFullBackup({ vcpServerZipPath: srv.zipPath });
                entry.stages.full = full;
                const up = await webdav.upload(full.zipPath, full.filename);
                entry.stages.upload = up;
            } else {
                const up = await webdav.upload(srv.zipPath, srv.filename);
                entry.stages.upload = up;
            }
        }

        // 3. 滚动保留
        const rot = await rotateExports(config.keepCount, config.keepDays);
        entry.stages.rotate = rot;

        entry.status = 'success';
        entry.finishedAt = new Date().toISOString();

        // 更新 lastRun 状态
        await saveConfig({ ...config, lastRun: entry.finishedAt, lastStatus: 'success' });
    } catch (e) {
        entry.status = 'error';
        entry.error = e.message;
        entry.finishedAt = new Date().toISOString();
        await saveConfig({ ...config, lastRun: entry.finishedAt, lastStatus: 'error' });
    }

    await appendHistory(entry);
    return entry;
}

function isValidCron(cronExpr) {
    if (!cronExpr || typeof cronExpr !== 'string') return false;
    const parts = cronExpr.trim().split(/\s+/);
    // 支持 5 段或 6 段（node-schedule 可处理秒级）
    return parts.length === 5 || parts.length === 6;
}

// 应用配置：清旧任务 + 启新任务
async function applySchedule() {
    if (currentJob) {
        currentJob.cancel();
        currentJob = null;
    }
    const config = await loadConfig();
    if (!config.enabled) return { scheduled: false };
    if (!isValidCron(config.cron)) {
        return { scheduled: false, error: 'invalid cron: ' + config.cron };
    }

    currentJob = schedule.scheduleJob(config.cron, async () => {
        try {
            await runOnce({ trigger: 'cron' });
        } catch (e) {
            console.error('[backup-schedule] cron run failed:', e.message);
        }
    });
    const next = currentJob ? currentJob.nextInvocation() : null;
    return {
        scheduled: !!currentJob,
        cron: config.cron,
        nextInvocation: next ? next.toISOString() : null,
    };
}

// 面板查询用：当前运行状态
async function getSchedulerStatus() {
    const config = await loadConfig();
    const next = currentJob ? currentJob.nextInvocation() : null;
    return {
        ...config,
        active: !!currentJob,
        nextInvocation: next ? next.toISOString() : null,
    };
}

// 初始化：服务启动时调
async function init() {
    try {
        const result = await applySchedule();
        if (result.scheduled) {
            console.log(`[backup-schedule] active, next run: ${result.nextInvocation}`);
        }
        return result;
    } catch (e) {
        console.warn('[backup-schedule] init failed:', e.message);
        return { scheduled: false, error: e.message };
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    loadHistory,
    runOnce,
    applySchedule,
    getSchedulerStatus,
    init,
    DEFAULT_CONFIG,
};
