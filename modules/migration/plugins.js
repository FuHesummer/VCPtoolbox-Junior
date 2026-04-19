// modules/migration/plugins.js
// 策略：
//   1. builtin（本体 16 核心）→ 跳过（已在 Plugin/）
//   2. localRepo（sibling 目录 VCPtoolbox-Junior-Plugins 存在）→ 本地 copy
//   3. remoteStore（走 modules/pluginStore.js 从 GitHub 下载 tarball）→ 网络安装
//   4. notAvailable（三类都不匹配）→ 跳过 + 清晰告知用户
// 所有安装成功的插件都把上游 config.env 同名字段值 merge 进来。
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT, copyDir, dirSize } = require('./utils');
const { parseEnv } = require('./config');
const pluginStore = require('../pluginStore');

const JUNIOR_PLUGIN_DIR = path.join(PROJECT_ROOT, 'Plugin');

// 16 个内置核心（README 定义）
const BUILTIN_CORE = new Set([
    'RAGDiaryPlugin', 'DailyNote', 'DailyNoteWrite', 'DailyNoteManager',
    'DailyNotePanel', 'LightMemo', 'ContextFoldingV2', 'UserAuth', 'VCPLog',
    'AgentDream', 'DailyNoteEditor', 'SemanticGroupEditor', 'ThoughtClusterManager',
    'EmojiListGenerator', 'ImageServer', 'FileOperator',
]);

function resolvePluginsRepoRoot() {
    const envPath = (process.env.PLUGINS_REPO_PATH || '').trim();
    if (envPath) return path.resolve(envPath);
    return path.resolve(PROJECT_ROOT, '..', 'VCPtoolbox-Junior-Plugins');
}

/**
 * 匹配上游插件清单与 Junior 多源（本地仓库 + 远程商店）
 * @param {Array} upstreamPlugins scan.js 输出 [{ name, enabled, configFiles, size, ... }]
 * @returns {Promise<{ installable, builtin, notAvailable, sources }>}
 *   installable 合并 localRepo + remoteStore，每条带 source 字段标识来源
 */
async function matchPlugins(upstreamPlugins) {
    const result = {
        installable: [],
        builtin: [],
        notAvailable: [],
    };
    const repoRoot = resolvePluginsRepoRoot();
    const repoExists = fs.existsSync(repoRoot);

    // 并发拿远程商店清单（失败不影响本地）
    let remoteSet = new Set();
    let remoteInfo = new Map();
    try {
        const remote = await pluginStore.listRemote();
        for (const r of remote) {
            remoteSet.add(r.name);
            remoteInfo.set(r.name, r);
        }
    } catch (e) {
        console.warn('[migration/plugins] listRemote 失败，仅用本地仓库匹配:', e.message);
    }

    for (const p of upstreamPlugins) {
        if (BUILTIN_CORE.has(p.name)) {
            result.builtin.push({ name: p.name, reason: 'Junior 内置核心，本体已包含' });
            continue;
        }

        // 优先级 1: 本地插件仓库
        const repoPluginDir = repoExists ? path.join(repoRoot, p.name) : null;
        if (repoPluginDir && fs.existsSync(repoPluginDir)) {
            const manifestExists = fs.existsSync(path.join(repoPluginDir, 'plugin-manifest.json'));
            const manifestBlock = fs.existsSync(path.join(repoPluginDir, 'plugin-manifest.json.block'));
            const repoSize = await dirSize(repoPluginDir);
            result.installable.push({
                name: p.name,
                source: 'localRepo',
                upstreamSize: p.size,
                repoSize,
                hasUpstreamConfig: (p.configFiles || []).includes('config.env'),
                repoDefaultEnabled: manifestExists,
                repoBlocked: manifestBlock && !manifestExists,
                upstreamEnabled: p.enabled,
            });
            continue;
        }

        // 优先级 2: 远程商店
        if (remoteSet.has(p.name)) {
            const info = remoteInfo.get(p.name) || {};
            result.installable.push({
                name: p.name,
                source: 'remoteStore',
                upstreamSize: p.size,
                remoteVersion: info.version,
                remoteDisplayName: info.displayName,
                remoteDescription: info.description,
                hasUpstreamConfig: (p.configFiles || []).includes('config.env'),
                upstreamEnabled: p.enabled,
            });
            continue;
        }

        // 都没有
        result.notAvailable.push({
            name: p.name,
            reason: 'Junior 本体/本地仓库/远程商店均不包含，迁移时自动跳过',
        });
    }

    return {
        ...result,
        sources: {
            localRepoPath: repoExists ? repoRoot : null,
            remoteStoreSize: remoteSet.size,
        },
    };
}

/**
 * 从插件仓库安装一个插件，并把上游插件配置 merge 进去
 * @param {string} pluginName
 * @param {string} sourceRoot 上游根
 * @param {object} opts { mergeConfig: bool, copyVectorStore: bool, enable: bool }
 */
async function installPluginFromRepo(pluginName, sourceRoot, opts, emitter) {
    opts = opts || {};
    const repoRoot = resolvePluginsRepoRoot();
    const repoPluginDir = path.join(repoRoot, pluginName);
    if (!fs.existsSync(repoPluginDir)) {
        throw new Error(`仓库中未找到插件 ${pluginName}`);
    }

    const destDir = path.join(JUNIOR_PLUGIN_DIR, pluginName);

    // 覆盖策略：先清 dest（除了 VectorStore —— 避免误删已有向量），再 copy 仓库版
    if (fs.existsSync(destDir)) {
        for (const entry of await fsp.readdir(destDir)) {
            if (entry === 'VectorStore') continue;
            await fsp.rm(path.join(destDir, entry), { recursive: true, force: true });
        }
    }
    await fsp.mkdir(destDir, { recursive: true });
    await copyDir(repoPluginDir, destDir, ['node_modules', '.git', '__pycache__']);
    emit(emitter, 'progress', 'plugins', `📥 ${pluginName} 从仓库安装完成`);

    // 处理 enable/block 状态
    const manifestPath = path.join(destDir, 'plugin-manifest.json');
    const manifestBlockPath = path.join(destDir, 'plugin-manifest.json.block');
    if (opts.enable === true && fs.existsSync(manifestBlockPath)) {
        await fsp.rename(manifestBlockPath, manifestPath);
        emit(emitter, 'progress', 'plugins', `   启用 ${pluginName}`);
    } else if (opts.enable === false && fs.existsSync(manifestPath)) {
        await fsp.rename(manifestPath, manifestBlockPath);
        emit(emitter, 'progress', 'plugins', `   禁用 ${pluginName}`);
    }

    // merge 上游 config.env 到新装插件
    let configResult = null;
    if (opts.mergeConfig) {
        configResult = await mergePluginConfig(sourceRoot, pluginName, destDir);
        if (configResult?.applied > 0) {
            emit(emitter, 'progress', 'plugins',
                `   config.env merged（${configResult.applied} 字段来自上游）`);
        }
    }

    // copy 上游 VectorStore（仅当用户明确要）
    let vectorResult = null;
    if (opts.copyVectorStore) {
        const srcVec = path.join(sourceRoot, 'Plugin', pluginName, 'VectorStore');
        if (fs.existsSync(srcVec)) {
            const destVec = path.join(destDir, 'VectorStore');
            await fsp.mkdir(destVec, { recursive: true });
            const count = await copyDir(srcVec, destVec, []);
            vectorResult = { fileCount: count };
            emit(emitter, 'progress', 'plugins', `   VectorStore copied（${count} 文件）`);
        }
    }

    return {
        name: pluginName,
        installedFrom: path.relative(PROJECT_ROOT, repoPluginDir),
        configMerged: configResult,
        vectorStore: vectorResult,
    };
}

/**
 * 把上游插件的 config.env 值 merge 到新装插件的 config.env
 * 策略：仓库版本有的 key，上游有对应值就覆盖；仓库没有的 key 不新增（避免污染）
 */
async function mergePluginConfig(sourceRoot, pluginName, destDir) {
    const srcConfig = path.join(sourceRoot, 'Plugin', pluginName, 'config.env');
    const destConfig = path.join(destDir, 'config.env');
    if (!fs.existsSync(srcConfig)) return { applied: 0, reason: 'upstream has no config.env' };
    if (!fs.existsSync(destConfig)) return { applied: 0, reason: 'repo has no config.env' };

    const srcText = await fsp.readFile(srcConfig, 'utf8');
    const destText = await fsp.readFile(destConfig, 'utf8');
    const srcMap = parseEnv(srcText);
    const destLines = destText.split(/\r?\n/);

    let applied = 0;
    for (let i = 0; i < destLines.length; i++) {
        const m = destLines[i].match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
        if (!m) continue;
        const key = m[2];
        if (srcMap[key] !== undefined && srcMap[key].value !== '') {
            destLines[i] = `${m[1]}${key}${m[3]}${srcMap[key].value.includes(' ') ? `"${srcMap[key].value}"` : srcMap[key].value}`;
            applied++;
        }
    }

    if (applied > 0) {
        await fsp.writeFile(destConfig, destLines.join('\n'), 'utf8');
    }
    return { applied, total: Object.keys(srcMap).length };
}

/**
 * 从远程商店安装（走 pluginStore.install），然后 merge 上游 config
 * @param {string} pluginName
 * @param {string} sourceRoot 上游根
 * @param {object} opts { mergeConfig, copyVectorStore, enable }
 */
async function installPluginFromRemote(pluginName, sourceRoot, opts, emitter) {
    opts = opts || {};
    emit(emitter, 'progress', 'plugins', `🌐 ${pluginName} 从远程商店下载...`);
    const res = await pluginStore.install(pluginName, { force: true });
    if (!res.success) {
        throw new Error(`远程安装失败: ${res.message}`);
    }
    emit(emitter, 'progress', 'plugins', `   ${res.message}`);

    const destDir = path.join(JUNIOR_PLUGIN_DIR, pluginName);

    // 处理 enable/block
    const manifestPath = path.join(destDir, 'plugin-manifest.json');
    const manifestBlockPath = path.join(destDir, 'plugin-manifest.json.block');
    if (opts.enable === true && fs.existsSync(manifestBlockPath) && !fs.existsSync(manifestPath)) {
        await fsp.rename(manifestBlockPath, manifestPath);
        emit(emitter, 'progress', 'plugins', `   启用 ${pluginName}`);
    } else if (opts.enable === false && fs.existsSync(manifestPath)) {
        await fsp.rename(manifestPath, manifestBlockPath);
        emit(emitter, 'progress', 'plugins', `   禁用 ${pluginName}`);
    }

    // merge 上游 config.env
    let configResult = null;
    if (opts.mergeConfig) {
        configResult = await mergePluginConfig(sourceRoot, pluginName, destDir);
        if (configResult?.applied > 0) {
            emit(emitter, 'progress', 'plugins',
                `   config.env merged（${configResult.applied} 字段来自上游）`);
        }
    }

    // copy 上游 VectorStore（可选）
    let vectorResult = null;
    if (opts.copyVectorStore) {
        const srcVec = path.join(sourceRoot, 'Plugin', pluginName, 'VectorStore');
        if (fs.existsSync(srcVec)) {
            const destVec = path.join(destDir, 'VectorStore');
            await fsp.mkdir(destVec, { recursive: true });
            const count = await copyDir(srcVec, destVec, []);
            vectorResult = { fileCount: count };
            emit(emitter, 'progress', 'plugins', `   VectorStore copied（${count} 文件）`);
        }
    }

    return {
        name: pluginName,
        installedFrom: 'remoteStore',
        configMerged: configResult,
        vectorStore: vectorResult,
    };
}

/**
 * 批量安装：按 item.source 字段路由到本地 / 远程
 *   - localRepo → installPluginFromRepo
 *   - remoteStore → installPluginFromRemote
 * 若 item 未带 source 字段（旧 plan 格式），优先本地，失败自动 fallback 远程
 */
async function installSelectedPlugins(sourceRoot, selected, emitter) {
    const result = { installed: [], failed: [] };
    for (const item of selected) {
        const source = item.source || 'auto';
        const commonOpts = {
            mergeConfig: item.mergeConfig !== false,
            copyVectorStore: item.copyVectorStore === true,
            enable: item.enable !== false,
        };
        try {
            let info;
            if (source === 'localRepo') {
                info = await installPluginFromRepo(item.name, sourceRoot, commonOpts, emitter);
            } else if (source === 'remoteStore') {
                info = await installPluginFromRemote(item.name, sourceRoot, commonOpts, emitter);
            } else {
                // auto：先试本地，失败走远程
                try {
                    info = await installPluginFromRepo(item.name, sourceRoot, commonOpts, emitter);
                } catch (localErr) {
                    emit(emitter, 'warn', 'plugins',
                        `${item.name} 本地仓库失败（${localErr.message}），尝试远程商店...`);
                    info = await installPluginFromRemote(item.name, sourceRoot, commonOpts, emitter);
                }
            }
            result.installed.push(info);
        } catch (e) {
            result.failed.push({ name: item.name, error: e.message });
            emit(emitter, 'error', 'plugins', `❌ ${item.name}: ${e.message}`);
        }
    }
    return result;
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = {
    matchPlugins,
    installPluginFromRepo,
    installPluginFromRemote,
    installSelectedPlugins,
    resolvePluginsRepoRoot,
    BUILTIN_CORE,
};
