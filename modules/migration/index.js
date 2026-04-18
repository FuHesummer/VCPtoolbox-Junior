// modules/migration/index.js
// 迁移引擎入口：编排所有子模块，按 plan 串行执行
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const lock = require('./lock');
const { PROJECT_ROOT } = require('./utils');
const { scanUpstream } = require('./scan');
const { backupCurrent, listBackups } = require('./backup');
const { migrateAgents, triggerAgentManagerReload } = require('./agents');
const { migrateDailynote, autoPlan: dailynoteAutoPlan } = require('./dailynote');
const { migrateKnowledge, autoPlan: knowledgeAutoPlan } = require('./knowledge');
const { migrateTvs, migrateImages } = require('./assets');
const { migrateVectors } = require('./vectors');
const { diffConfigEnv, applyMerge } = require('./config');
const { matchPlugins, installSelectedPlugins, BUILTIN_CORE } = require('./plugins');
const { resolveSource } = require('./source');

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
        let resolved = null;
        try {
            // 0. 解析源（dir / zip 自动解压到临时目录），后续统一用 resolved.tempRoot
            emit(emitter, 'info', 'init', '开始迁移...');
            resolved = await resolveSource(plan.sourcePath);
            summary.sourceType = resolved.type;
            if (resolved.type !== 'dir') {
                emit(emitter, 'progress', 'init',
                    `已解压源包 (${resolved.type}) → ${resolved.tempRoot}`);
            }
            const sourceRoot = resolved.tempRoot;

            // 0.1 扫描源（复用已 resolved 的临时目录）
            const scan = await scanUpstream(plan.sourcePath, { preResolved: resolved });
            if (!scan.valid) {
                throw new Error(`源无效：${scan.reason}`);
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
                summary.stages.agents = await migrateAgents(sourceRoot, plan.agents, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 3. Dailynote
            if (plan.dailynotes && plan.dailynotes.length > 0) {
                emit(emitter, 'info', 'dailynote', `📔 迁移日记（${plan.dailynotes.length}类）...`);
                summary.stages.dailynote = await migrateDailynote(
                    sourceRoot, plan.dailynotes, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 3.5 Knowledge (上游 knowledge/<Name>/ 分流)
            if (plan.knowledge && plan.knowledge.length > 0) {
                emit(emitter, 'info', 'knowledge', `📚 迁移知识库（${plan.knowledge.length}类）...`);
                summary.stages.knowledge = await migrateKnowledge(
                    sourceRoot, plan.knowledge, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 4. TVS
            if (plan.tvs && plan.tvs.length > 0) {
                emit(emitter, 'info', 'tvs', `🎨 迁移 TVS 变量（${plan.tvs.length}个）...`);
                summary.stages.tvs = await migrateTvs(sourceRoot, plan.tvs, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 5. Images
            if (plan.images && plan.images.length > 0) {
                emit(emitter, 'info', 'images', `🖼 迁移图片资源（${plan.images.length}组）...`);
                summary.stages.images = await migrateImages(sourceRoot, plan.images, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 6. 插件（策略 A：仓库匹配 + 安装 + config merge）
            if (plan.plugins && plan.plugins.length > 0) {
                emit(emitter, 'info', 'plugins', `🔌 安装插件（${plan.plugins.length}个）...`);
                summary.stages.plugins = await installSelectedPlugins(
                    sourceRoot, plan.plugins, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 7. 向量索引（可选：迁移未通过插件 install 的 global 向量）
            if (plan.copyVectors && scan.vectors.length > 0) {
                emit(emitter, 'info', 'vectors', `📊 迁移向量索引...`);
                const junPlugins = await listJuniorPlugins();
                summary.stages.vectors = await migrateVectors(
                    sourceRoot, scan.vectors, junPlugins, emitter);
            }
            if (cancelled(job)) return aborted(emitter, summary);

            // 8. config.env merge
            if (plan.configMerge && (plan.configMerge.add || plan.configMerge.conflicts)) {
                emit(emitter, 'info', 'config', `⚙️ 合并 config.env...`);
                summary.stages.config = await applyMerge(
                    sourceRoot, plan.configMerge, emitter);
            }

            // 9. 收尾：触发 AgentManager 重扫磁盘 + 回写 agent_map.json
            emit(emitter, 'info', 'finalize', `🔄 触发 AgentManager 自动发现...`);
            await triggerAgentManagerReload(emitter);

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
            // 清理临时解压目录（dir 源 cleanup 是 no-op）
            if (resolved) {
                try { await resolved.cleanup(); } catch {}
            }
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

/**
 * 🪄 智能推荐：基于 scanResult + matchPlugins 生成一键默认 plan
 *   - agents: 全选
 *   - dailynotes: 自动按 Agent 同名 → personal，其余 → public（公共前缀）
 *   - knowledge: 同上（Agent 同名 → personal，其余 → public）
 *   - tvs/images: 全选
 *   - plugins: installable 全选（本地+远程，source 字段保留），notAvailable 跳过
 *   - configMerge: 全部 add=true，conflicts 保守 keep junior
 *   - copyVectors: false（默认不搬全局向量，用户要再手动勾）
 *
 * @param {string} sourcePath 源路径（dir 或 zip）
 * @returns {Promise<{ plan, scan, match, summary }>}
 */
async function generateAutoPlan(sourcePath, opts = {}) {
    const scan = await scanUpstream(sourcePath);
    if (!scan.valid) {
        throw new Error(`源无效：${scan.reason}`);
    }
    const match = await matchPlugins(scan.plugins || []);

    const agentNames = (scan.agents || []).map(a => a.name);
    const plan = {
        sourcePath,
        doBackup: true,
        agents: agentNames,
        dailynotes: dailynoteAutoPlan(scan.dailynotes || [], agentNames),
        knowledge: knowledgeAutoPlan(scan.knowledge || [], agentNames),
        tvs: (scan.tvs || []).map(t => t.name),
        images: (scan.images || []).map(i => i.name),
        plugins: (match.installable || []).map(p => ({
            name: p.name,
            source: p.source,
            mergeConfig: true,
            copyVectorStore: false,
            enable: p.upstreamEnabled !== false,
        })),
        configMerge: null, // 前端如果要 diff 再另外调 /migration/config-diff
        copyVectors: false,
    };

    return {
        plan,
        scan,
        match,
        summary: {
            agents: plan.agents.length,
            dailynotes: plan.dailynotes.length,
            knowledge: plan.knowledge.length,
            tvs: plan.tvs.length,
            images: plan.images.length,
            pluginsInstallable: plan.plugins.length,
            pluginsBuiltin: (match.builtin || []).length,
            pluginsSkipped: (match.notAvailable || []).length,
        },
    };
}

module.exports = {
    scanUpstream,
    diffConfigEnv,
    matchPlugins,
    backupCurrent,
    listBackups,
    executeMigration,
    generateAutoPlan,
    readHistory,
    lock,
    // 新增（VCPBackUp 适配 + WebDAV + 定期备份）
    source: require('./source'),
    webdav: require('./webdav'),
    exporter: require('./export'),
    scheduler: require('./schedule'),
};
