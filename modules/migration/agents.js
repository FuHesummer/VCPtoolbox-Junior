// modules/migration/agents.js
// Agent 迁移：上游扁平 Agent/<Name>.txt → Junior 嵌套 Agent/<Name>/<Name>.txt
// map 不在这里维护：搬完文件后由 AgentManager 启动自动扫目录生成（见 modules/agentManager.js）
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT, copyDir } = require('./utils');

const JUNIOR_AGENT_DIR = path.join(PROJECT_ROOT, 'Agent');

/**
 * @param {string} sourceRoot 上游根
 * @param {string[]} selectedNames 要迁移的 Agent 名
 * @param {object} opts
 *   - mergeDiary: bool 如果上游 dailynote/<Name>/ 存在，顺带搬进 Agent/<Name>/diary/（默认 true）
 *   - mergeKnowledge: bool 如果上游 knowledge/<Name>/ 存在，搬进 Agent/<Name>/knowledge/<Name>/（默认 false，避免跟公共知识分流冲突）
 */
async function migrateAgents(sourceRoot, selectedNames, emitter, opts = {}) {
    const mergeDiary = opts.mergeDiary !== false;
    const mergeKnowledge = opts.mergeKnowledge === true;
    const result = { migrated: [], skipped: [], failed: [] };
    const srcAgentDir = path.join(sourceRoot, 'Agent');
    const srcDailyDir = path.join(sourceRoot, 'dailynote');
    const srcKnowledgeDir = path.join(sourceRoot, 'knowledge');

    if (!fs.existsSync(srcAgentDir)) {
        emit(emitter, 'warn', 'agents', '上游 Agent/ 目录不存在，跳过');
        return result;
    }

    await fsp.mkdir(JUNIOR_AGENT_DIR, { recursive: true });

    for (const name of selectedNames) {
        try {
            // 1. 定位上游提示词文件（支持扁平 / 已嵌套两种）
            let srcPromptFile = path.join(srcAgentDir, `${name}.txt`);
            if (!fs.existsSync(srcPromptFile)) {
                // 兜底：已嵌套的 <Name>/<Name>.txt
                const nestedCandidate = path.join(srcAgentDir, name, `${name}.txt`);
                if (fs.existsSync(nestedCandidate)) {
                    srcPromptFile = nestedCandidate;
                } else {
                    result.skipped.push({ name, reason: 'source prompt file missing' });
                    continue;
                }
            }

            const targetAgentDir = path.join(JUNIOR_AGENT_DIR, name);
            const targetPromptFile = path.join(targetAgentDir, `${name}.txt`);
            await fsp.mkdir(targetAgentDir, { recursive: true });
            await fsp.copyFile(srcPromptFile, targetPromptFile);

            const migrated = {
                name,
                from: path.relative(sourceRoot, srcPromptFile).replace(/\\/g, '/'),
                to: `Agent/${name}/${name}.txt`,
                diary: null,
                knowledge: null,
            };

            // 2. 上游 dailynote/<Name>/ 同名 → Agent/<Name>/diary/ 顺带搬
            if (mergeDiary && fs.existsSync(path.join(srcDailyDir, name))) {
                const targetDiary = path.join(targetAgentDir, 'diary');
                await fsp.mkdir(targetDiary, { recursive: true });
                const count = await copyDir(path.join(srcDailyDir, name), targetDiary, ['VectorStore', 'vectors']);
                migrated.diary = { fileCount: count };
                emit(emitter, 'progress', 'agents', `   └─ diary: ${count} 文件`);
            }

            // 3. 上游 knowledge/<Name>/ 同名 → Agent/<Name>/knowledge/<Name>/（可选）
            if (mergeKnowledge && fs.existsSync(path.join(srcKnowledgeDir, name))) {
                const targetKnowledge = path.join(targetAgentDir, 'knowledge', name);
                await fsp.mkdir(targetKnowledge, { recursive: true });
                const count = await copyDir(path.join(srcKnowledgeDir, name), targetKnowledge, ['VectorStore', 'vectors']);
                migrated.knowledge = { fileCount: count };
                emit(emitter, 'progress', 'agents', `   └─ knowledge: ${count} 文件`);
            }

            result.migrated.push(migrated);
            emit(emitter, 'progress', 'agents', `✅ ${name}`);
        } catch (e) {
            result.failed.push({ name, error: e.message });
            emit(emitter, 'error', 'agents', `❌ ${name}: ${e.message}`);
        }
    }

    return result;
}

/**
 * 触发 AgentManager 重扫磁盘 + 回写 agent_map.json
 * 迁移链路收尾调一次，用户立即在 Panel 看到新 Agent
 */
async function triggerAgentManagerReload(emitter) {
    try {
        const agentManager = require('../agentManager');
        await agentManager.loadMap();
        emit(emitter, 'progress', 'agents', '✅ AgentManager 已重扫磁盘并更新 map');
    } catch (e) {
        emit(emitter, 'warn', 'agents', `AgentManager reload failed: ${e.message}`);
    }
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = { migrateAgents, triggerAgentManagerReload };
