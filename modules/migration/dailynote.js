// modules/migration/dailynote.js
// 日记分流：上游 dailynote/<分类>/ → Junior Agent/<Name>/diary/（个人）或 knowledge/<名>/（公共）
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT, copyDir } = require('./utils');

const JUNIOR_AGENT_DIR = path.join(PROJECT_ROOT, 'Agent');
const JUNIOR_KNOWLEDGE_DIR = path.join(PROJECT_ROOT, 'knowledge');

/**
 * @param {string} sourceRoot 上游根路径
 * @param {Array} items 每项 { sourceName, targetType, agentName?, publicDirName? }
 *   - targetType: 'personal' | 'public' | 'skip'
 *   - personal: agentName 必填，目标 Agent/<agentName>/diary/
 *   - public: publicDirName 可选，默认 '公共<sourceName>'，目标 knowledge/<publicDirName>/
 */
async function migrateDailynote(sourceRoot, items, emitter) {
    const result = { migrated: [], skipped: [], failed: [] };
    const srcDir = path.join(sourceRoot, 'dailynote');

    if (!fs.existsSync(srcDir)) {
        emit(emitter, 'warn', 'dailynote', '上游 dailynote/ 目录不存在，跳过');
        return result;
    }

    for (const item of items) {
        try {
            if (!item || item.targetType === 'skip') {
                result.skipped.push({ name: item?.sourceName, reason: 'user skipped' });
                continue;
            }
            const srcSub = path.join(srcDir, item.sourceName);
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
                targetDir = path.join(JUNIOR_AGENT_DIR, item.agentName, 'diary');
                targetLabel = `Agent/${item.agentName}/diary`;
            } else if (item.targetType === 'public') {
                const dirName = (item.publicDirName || `公共${item.sourceName}`).trim();
                targetDir = path.join(JUNIOR_KNOWLEDGE_DIR, dirName);
                targetLabel = `knowledge/${dirName}`;
            } else {
                result.skipped.push({ name: item.sourceName, reason: `unknown targetType: ${item.targetType}` });
                continue;
            }

            await fsp.mkdir(targetDir, { recursive: true });
            // 覆盖策略：直接合并到目标目录（同名文件覆盖）
            const fileCount = await copyDir(srcSub, targetDir, ['VectorStore', 'vectors']);

            result.migrated.push({
                name: item.sourceName,
                from: `dailynote/${item.sourceName}`,
                to: targetLabel,
                fileCount,
            });
            emit(emitter, 'progress', 'dailynote',
                `✅ ${item.sourceName} → ${targetLabel} (${fileCount} 文件)`);
        } catch (e) {
            result.failed.push({ name: item?.sourceName, error: e.message });
            emit(emitter, 'error', 'dailynote', `❌ ${item?.sourceName}: ${e.message}`);
        }
    }

    return result;
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = { migrateDailynote };
