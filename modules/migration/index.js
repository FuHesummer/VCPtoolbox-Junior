// modules/migration/index.js
// 迁移引擎入口：编排所有子模块，按 plan 串行执行
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const lock = require('./lock');
const { PROJECT_ROOT } = require('./utils');
const { scanUpstream } = require('./scan');
const { backupCurrent, listBackups } = require('./backup');
const { migrateAgents } = require('./agents');
const { migrateDailynote } = require('./dailynote');
const { migrateTvs, migrateImages } = require('./assets');
const { migrateVectors } = require('./vectors');
const { diffConfigEnv, applyMerge } = require('./config');
const { matchPlugins, installSelectedPlugins, BUILTIN_CORE } = require('./plugins');

const HISTORY_FILE = path.join(PROJECT_ROOT, 'data', 'migration-history.json');
const MAX_HISTORY = 50;

/**
 * 执行完整迁移 plan
 * plan 结构：
 * {
 *   sourcePath: string,
 *   doBackup: bool,
 *   agents: string[],
 *   dailynotes: [{ sourceName, targetType, agentName?, publicDirName? }],
 *   tvs: string[],
 *   images: string[],
 *   plugins: [{ name, mergeConfig?, copyVectorStore?, enable? }],
 *   configMerge: { add: {}, conflicts: {} },
 *   copyVectors: bool  // 是否迁独立向量（未通过插件 install 的）
 * }
 * @returns EventEmitter，事件：log(evt)、done(summary)、error(err)
 */
function executeMigration(plan) {
    const emitter = new EventEmitter();
    const job = lock.acquire('migration', emitter);
    const summary = {
        jobId: job.jobId,
        startedAt: job.startedAt,
        sourcePath: plan.sourcePath,
        stages: {},
    };

    // 异步推进
    (async () => {
        try {
            // 0. 扫描源（获取必要上下文，如插件清单供向量迁移用）
            emit(emitter, 'info', 'init', '开始迁移...');
            const scan = await scanUpstream(plan.sourcePath);
            if (!scan.valid) {
                throw new Error(`源目录无效：${scan.reason}`);
            }

            // 1. 备份
            if (plan.doBackup !== false) {
                emit(emitter, 'info', 'backup', '📦 备份 Junior 当前状态...');
                const bk = await backupCurrent('pre-migration');
                summary.stages.backup = bk;
                emit(emitter, 'progress', 'backup',
                    `✅ 备份完成 ${bk.relPath} (${bk.sizeHuman})`);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 2. Agents
            if (plan.agents && plan.agents.length > 0) {
                emit(emitter, 'info', 'agents', `👤 迁移 Agent（${plan.agents.length}个）...`);
                summary.stages.agents = await migrateAgents(plan.sourcePath, plan.agents, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 3. Dailynote
            if (plan.dailynotes && plan.dailynotes.length > 0) {
                emit(emitter, 'info', 'dailynote', `📔 迁移日记（${plan.dailynotes.length}类）...`);
                summary.stages.dailynote = await migrateDailynote(
                    plan.sourcePath, plan.dailynotes, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 4. TVS
            if (plan.tvs && plan.tvs.length > 0) {
                emit(emitter, 'info', 'tvs', `🎨 迁移 TVS 变量（${plan.tvs.length}个）...`);
                summary.stages.tvs = await migrateTvs(plan.sourcePath, plan.tvs, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 5. Images
            if (plan.images && plan.images.length > 0) {
                emit(emitter, 'info', 'images', `🖼 迁移图片资源（${plan.images.length}组）...`);
                summary.stages.images = await migrateImages(plan.sourcePath, plan.images, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 6. 插件（策略 A：仓库匹配 + 安装 + config merge）
            if (plan.plugins && plan.plugins.length > 0) {
                emit(emitter, 'info', 'plugins', `🔌 安装插件（${plan.plugins.length}个）...`);
                summary.stages.plugins = await installSelectedPlugins(
                    plan.sourcePath, plan.plugins, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 7. 向量索引（可选：迁移未通过插件 install 的 global 向量）
            if (plan.copyVectors && scan.vectors.length > 0) {
                emit(emitter, 'info', 'vectors', `📊 迁移向量索引...`);
                const junPlugins = await listJuniorPlugins();
                summary.stages.vectors = await migrateVectors(
                    plan.sourcePath, scan.vectors, junPlugins, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 8. config.env merge
            if (plan.configMerge && (plan.configMerge.add || plan.configMerge.conflicts)) {
                emit(emitter, 'info', 'config', `⚙️ 合并 config.env...`);
                summary.stages.config = await applyMerge(
                    plan.sourcePath, plan.configMerge, emitter);
            }

            summary.finishedAt = new Date().toISOString();
            summary.status = 'success';
            await appendHistory(summary);
            emit(emitter, 'done', 'done', `🎉 迁移完成`);
            emitter.emit('done', summary);
        } catch (e) {
            summary.finishedAt = new Date().toISOString();
            summary.status = 'error';
            summary.error = e.message;
            await appendHistory(summary).catch(() => {});
            emit(emitter, 'error', 'fatal', e.message);
            emitter.emit('error', e);
        } finally {
            lock.release(job.jobId);
        }
    })();

    return { emitter, job };
}

function cancelled(job) {
    return lock.isCancelled(job.jobId);
}

function aborted(emitter, summary) {
    summary.finishedAt = new Date().toISOString();
    summary.status = 'cancelled';
    emit(emitter, 'warn', 'abort', '⛔ 迁移被取消');
    appendHistory(summary).catch(() => {});
    emitter.emit('done', summary);
}

async function listJuniorPlugins() {
    const set = new Set(BUILTIN_CORE);
    const dir = path.join(PROJECT_ROOT, 'Plugin');
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const m1 = path.join(dir, ent.name, 'plugin-manifest.json');
            const m2 = path.join(dir, ent.name, 'plugin-manifest.json.block');
            if (fs.existsSync(m1) || fs.existsSync(m2)) set.add(ent.name);
        }
    } catch {}
    return set;
}

async function appendHistory(entry) {
    try {
        await fs.promises.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
        let arr = [];
        if (fs.existsSync(HISTORY_FILE)) {
            arr = JSON.parse(await fs.promises.readFile(HISTORY_FILE, 'utf8'));
        }
        arr.unshift(entry);
        if (arr.length > MAX_HISTORY) arr = arr.slice(0, MAX_HISTORY);
        await fs.promises.writeFile(HISTORY_FILE, JSON.stringify(arr, null, 2), 'utf8');
    } catch {}
}

async function readHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        return JSON.parse(await fs.promises.readFile(HISTORY_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function emit(emitter, level, stage, message) {
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = {
    scanUpstream,
    diffConfigEnv,
    matchPlugins,
    backupCurrent,
    listBackups,
    executeMigration,
    readHistory,
    lock,
};
