// modules/migration/vectors.js
// 向量索引迁移：上游 Plugin/<X>/VectorStore/ → Junior 对应位置（仅迁那些 Junior 有对应插件的）
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT, copyDir } = require('./utils');

const JUNIOR_PLUGIN_DIR = path.join(PROJECT_ROOT, 'Plugin');
const JUNIOR_MODULES_DIR = path.join(PROJECT_ROOT, 'modules');

const VECTOR_SUBDIRS = ['VectorStore', 'vector_store', 'vectors'];

/**
 * @param {string} sourceRoot 上游根
 * @param {Array<{plugin: string, relPath: string}>} items 从 scan 得到的向量清单
 * @param {Set<string>} availableJuniorPlugins Junior 已安装/内置插件 name 集合
 */
async function migrateVectors(sourceRoot, items, availableJuniorPlugins, emitter) {
    const result = { migrated: [], skipped: [], failed: [] };

    for (const item of items) {
        try {
            if (item.plugin === '__global__') {
                // 顶层 modules/VectorStore（Junior 结构）
                const src = path.join(sourceRoot, item.relPath);
                const dest = path.join(JUNIOR_MODULES_DIR, 'VectorStore');
                if (!fs.existsSync(src)) {
                    result.skipped.push({ plugin: item.plugin, reason: 'source missing' });
                    continue;
                }
                await fsp.mkdir(dest, { recursive: true });
                const count = await copyDir(src, dest, []);
                result.migrated.push({ plugin: item.plugin, from: item.relPath, to: 'modules/VectorStore', fileCount: count });
                emit(emitter, 'progress', 'vectors', `✅ global VectorStore (${count})`);
                continue;
            }

            // 插件级向量：只迁 Junior 存在的插件
            if (!availableJuniorPlugins.has(item.plugin)) {
                result.skipped.push({ plugin: item.plugin, reason: 'Junior 无此插件，向量索引跳过' });
                emit(emitter, 'warn', 'vectors', `⏭ ${item.plugin} (Junior 未安装)`);
                continue;
            }

            const srcDir = path.join(sourceRoot, item.relPath);
            if (!fs.existsSync(srcDir)) {
                result.skipped.push({ plugin: item.plugin, reason: 'source missing' });
                continue;
            }
            // 解析 relPath 中的 VectorStore 子目录名
            const subName = VECTOR_SUBDIRS.find(s => item.relPath.endsWith(`/${s}`)) || 'VectorStore';
            const destDir = path.join(JUNIOR_PLUGIN_DIR, item.plugin, subName);
            await fsp.mkdir(destDir, { recursive: true });
            const count = await copyDir(srcDir, destDir, []);
            result.migrated.push({
                plugin: item.plugin,
                from: item.relPath,
                to: `Plugin/${item.plugin}/${subName}`,
                fileCount: count,
            });
            emit(emitter, 'progress', 'vectors', `✅ ${item.plugin}/${subName} (${count})`);
        } catch (e) {
            result.failed.push({ plugin: item.plugin, error: e.message });
            emit(emitter, 'error', 'vectors', `❌ ${item.plugin}: ${e.message}`);
        }
    }

    return result;
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = { migrateVectors };
