// modules/migration/agents.js
// Agent 迁移：上游扁平 Agent/<Name>.txt → Junior 嵌套 Agent/<Name>/<Name>.txt
// 同时更新 Junior agent_map.json
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT } = require('./utils');

const JUNIOR_AGENT_DIR = path.join(PROJECT_ROOT, 'Agent');
const AGENT_MAP_PATH = path.join(PROJECT_ROOT, 'agent_map.json');

async function migrateAgents(sourceRoot, selectedNames, emitter) {
    const result = { migrated: [], skipped: [], failed: [], agentMap: null };
    const srcDir = path.join(sourceRoot, 'Agent');

    if (!fs.existsSync(srcDir)) {
        emit(emitter, 'warn', 'agents', '上游 Agent/ 目录不存在，跳过');
        return result;
    }

    await fsp.mkdir(JUNIOR_AGENT_DIR, { recursive: true });

    for (const name of selectedNames) {
        try {
            const srcFile = path.join(srcDir, `${name}.txt`);
            if (!fs.existsSync(srcFile)) {
                result.skipped.push({ name, reason: 'source file missing' });
                continue;
            }

            const targetAgentDir = path.join(JUNIOR_AGENT_DIR, name);
            const targetPromptFile = path.join(targetAgentDir, `${name}.txt`);

            // 创建 Agent/<Name>/ 主目录 + diary + knowledge 占位
            await fsp.mkdir(targetAgentDir, { recursive: true });
            await fsp.mkdir(path.join(targetAgentDir, 'diary'), { recursive: true });
            await fsp.mkdir(path.join(targetAgentDir, 'knowledge'), { recursive: true });

            // 拷贝提示词文件（覆盖）
            await fsp.copyFile(srcFile, targetPromptFile);

            result.migrated.push({
                name,
                from: `Agent/${name}.txt`,
                to: `Agent/${name}/${name}.txt`,
            });
            emit(emitter, 'progress', 'agents', `✅ ${name}`);
        } catch (e) {
            result.failed.push({ name, error: e.message });
            emit(emitter, 'error', 'agents', `❌ ${name}: ${e.message}`);
        }
    }

    // 更新 agent_map.json
    try {
        result.agentMap = await mergeAgentMap(result.migrated);
        emit(emitter, 'progress', 'agents',
            `agent_map.json 已更新（${result.agentMap.added} 新增，${result.agentMap.updated} 覆盖）`);
    } catch (e) {
        emit(emitter, 'error', 'agents', `agent_map.json 更新失败: ${e.message}`);
    }

    return result;
}

// 合并新迁移的 Agent 到 agent_map.json（旧格式：字符串路径，跨平台用正斜杠）
async function mergeAgentMap(migrated) {
    let map = {};
    if (fs.existsSync(AGENT_MAP_PATH)) {
        try {
            map = JSON.parse(await fsp.readFile(AGENT_MAP_PATH, 'utf8'));
        } catch {
            map = {};
        }
    }

    let added = 0, updated = 0;
    for (const m of migrated) {
        const value = `${m.name}/${m.name}.txt`;
        if (map[m.name] !== undefined) updated++; else added++;
        map[m.name] = value;
    }

    await fsp.writeFile(AGENT_MAP_PATH, JSON.stringify(map, null, 2) + '\n', 'utf8');
    return { added, updated, total: Object.keys(map).length };
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = { migrateAgents };
