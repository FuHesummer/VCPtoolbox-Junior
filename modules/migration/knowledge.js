// modules/migration/knowledge.js
// 上游 knowledge/<Name>/ 分流：
//   - personal: 搬到 Agent/<agentName>/knowledge/<targetName>/
//   - public  : 搬到 knowledge/<publicDirName || sourceName>/
//   - skip    : 用户选择跳过
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT, copyDir } = require('./utils');

const JUNIOR_AGENT_DIR = path.join(PROJECT_ROOT, 'Agent');
const JUNIOR_KNOWLEDGE_DIR = path.join(PROJECT_ROOT, 'knowledge');

/**
 * @param {string} sourceRoot
 * @param {Array} items [{ sourceName, targetType: 'personal'|'public'|'skip', agentName?, publicDirName? }]
 */
async function migrateKnowledge(sourceRoot, items, emitter) {
    const result = { migrated: [], skipped: [], failed: [] };
    const srcRoot = path.join(sourceRoot, 'knowledge');
    if (!fs.existsSync(srcRoot)) {
        emit(emitter, 'warn', 'knowledge', '上游 knowledge/ 目录不存在，跳过');
        return result;
    }

    for (const item of items) {
        try {
            if (!item || item.targetType === 'skip') {
                result.skipped.push({ name: item?.sourceName, reason: 'user skipped' });
                continue;
            }
            const srcSub = path.join(srcRoot, item.sourceName);
            if (!fs.existsSync(srcSub)) {
                result.skipped.push({ name: item.sourceName, reason: 'source missing' });
                continue;
            }

            let targetDir = null, targetLabel = null;
            if (item.targetType === 'personal') {
                if (!item.agentName) {
                    result.skipped.push({ name: item.sourceName, reason: 'no agentName for personal' });
                    continue;
                }
                const subName = item.publicDirName || item.sourceName;
                targetDir = path.join(JUNIOR_AGENT_DIR, item.agentName, 'knowledge', subName);
                targetLabel = `Agent/${item.agentName}/knowledge/${subName}`;
            } else if (item.targetType === 'public') {
                const dirName = (item.publicDirName || item.sourceName).trim();
                targetDir = path.join(JUNIOR_KNOWLEDGE_DIR, dirName);
                targetLabel = `knowledge/${dirName}`;
            } else {
                result.skipped.push({ name: item.sourceName, reason: `unknown targetType: ${item.targetType}` });
                continue;
            }

            await fsp.mkdir(targetDir, { recursive: true });
            const fileCount = await copyDir(srcSub, targetDir, ['VectorStore', 'vectors']);
            result.migrated.push({
                name: item.sourceName,
                from: `knowledge/${item.sourceName}`,
                to: targetLabel,
                fileCount,
            });
            emit(emitter, 'progress', 'knowledge',
                `✅ ${item.sourceName} → ${targetLabel} (${fileCount} 文件)`);
        } catch (e) {
            result.failed.push({ name: item?.sourceName, error: e.message });
            emit(emitter, 'error', 'knowledge', `❌ ${item?.sourceName}: ${e.message}`);
        }
    }

    return result;
}

/**
 * 自动分流：根据 scan.knowledge 和 Agent 名单生成默认 items
 * 规则：
 *   - 名字命中 Agent → personal
 *   - 名字以 公共/共享/Public/Shared 开头 → public
 *   - 其余 → public（目录名前缀"公共"以示区分）
 */
function autoPlan(knowledgeScan, agentNames) {
    if (!Array.isArray(knowledgeScan) || knowledgeScan.length === 0) return [];
    const agentSet = new Set(agentNames || []);
    const items = [];
    for (const k of knowledgeScan) {
        if (agentSet.has(k.name)) {
            items.push({
                sourceName: k.name,
                targetType: 'personal',
                agentName: k.name,
                publicDirName: k.name,
            });
        } else if (/^(公共|共享|Public|Shared)/.test(k.name)) {
            items.push({
                sourceName: k.name,
                targetType: 'public',
                publicDirName: k.name,
            });
        } else {
            items.push({
                sourceName: k.name,
                targetType: 'public',
                publicDirName: k.name,
            });
        }
    }
    return items;
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = { migrateKnowledge, autoPlan };
