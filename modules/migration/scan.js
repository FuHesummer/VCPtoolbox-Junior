// modules/migration/scan.js
// 源目录扫描器：识别上游 VCPToolBox 目录结构，输出可迁移资产清单
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { isValidUpstreamRoot, dirSize } = require('./utils');

// 已知的向量索引子目录名（用于识别）
const VECTOR_SUBDIRS = ['VectorStore', 'vector_store', 'vectors', 'db'];

async function scanUpstream(sourcePath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { valid: false, reason: 'path not exists', sourcePath };
    }
    if (!isValidUpstreamRoot(sourcePath)) {
        return { valid: false, reason: 'not a VCPToolBox root (missing Plugin.js/server.js/Plugin/Agent/TVStxt)', sourcePath };
    }

    const result = {
        valid: true,
        sourcePath,
        scanAt: new Date().toISOString(),
        agents: [],
        dailynotes: [],
        plugins: [],
        tvs: [],
        images: [],
        vectors: [],
        configEnv: null,
        agentMap: null,
        summary: {},
    };

    await Promise.all([
        scanAgents(sourcePath, result),
        scanDailynote(sourcePath, result),
        scanPlugins(sourcePath, result),
        scanTvs(sourcePath, result),
        scanImages(sourcePath, result),
        scanConfigEnv(sourcePath, result),
        scanAgentMap(sourcePath, result),
    ]);

    // 向量索引扫描依赖插件清单，放在最后
    await scanVectors(sourcePath, result);

    // 汇总
    result.summary = {
        agents: result.agents.length,
        dailynotes: result.dailynotes.length,
        plugins: result.plugins.length,
        tvs: result.tvs.length,
        images: result.images.length,
        vectors: result.vectors.length,
        configEnvKeys: result.configEnv ? result.configEnv.keys.length : 0,
    };

    return result;
}

// 上游 Agent/<Name>.txt 扁平结构
async function scanAgents(root, result) {
    const agentDir = path.join(root, 'Agent');
    if (!fs.existsSync(agentDir)) return;
    try {
        const entries = await fsp.readdir(agentDir, { withFileTypes: true });
        for (const ent of entries) {
            if (ent.isFile() && ent.name.endsWith('.txt')) {
                const name = ent.name.replace(/\.txt$/, '');
                const filePath = path.join(agentDir, ent.name);
                const st = await fsp.stat(filePath);
                result.agents.push({
                    name,
                    promptFile: `Agent/${ent.name}`,
                    size: st.size,
                });
            }
        }
    } catch {}
}

// 上游 dailynote/<分类>/
async function scanDailynote(root, result) {
    const dailyDir = path.join(root, 'dailynote');
    if (!fs.existsSync(dailyDir)) return;
    try {
        const entries = await fsp.readdir(dailyDir, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const subDir = path.join(dailyDir, ent.name);
            const files = await fsp.readdir(subDir).catch(() => []);
            const size = await dirSize(subDir);
            result.dailynotes.push({
                name: ent.name,
                relPath: `dailynote/${ent.name}`,
                fileCount: files.length,
                size,
                suggest: guessDailynoteTarget(ent.name),
            });
        }
    } catch {}
}

// 基于目录名启发式推荐迁移目标
function guessDailynoteTarget(name) {
    const isPublic = /^(VCP|公共|共享|Knowledge|知识|百科|前思维|反思|结果|逻辑|测试|陈词)/.test(name);
    return isPublic ? 'public' : 'personal';
}

// 上游 Plugin/*/
async function scanPlugins(root, result) {
    const pluginDir = path.join(root, 'Plugin');
    if (!fs.existsSync(pluginDir)) return;
    try {
        const entries = await fsp.readdir(pluginDir, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const sub = path.join(pluginDir, ent.name);
            const manifest = path.join(sub, 'plugin-manifest.json');
            const manifestBlock = path.join(sub, 'plugin-manifest.json.block');
            const hasManifest = fs.existsSync(manifest);
            const blocked = fs.existsSync(manifestBlock);
            if (!hasManifest && !blocked) continue;

            let manifestData = null;
            try {
                const src = hasManifest ? manifest : manifestBlock;
                manifestData = JSON.parse(await fsp.readFile(src, 'utf8'));
            } catch {}

            const configFiles = [];
            for (const cf of ['config.env', 'config.json']) {
                if (fs.existsSync(path.join(sub, cf))) configFiles.push(cf);
            }
            const size = await dirSize(sub);
            result.plugins.push({
                name: ent.name,
                enabled: hasManifest,
                manifest: manifestData ? {
                    version: manifestData.version,
                    pluginType: manifestData.pluginType,
                    displayName: manifestData.displayName,
                    description: manifestData.description,
                } : null,
                configFiles,
                size,
            });
        }
    } catch {}
}

// 上游 TVStxt/*.txt
async function scanTvs(root, result) {
    const tvsDir = path.join(root, 'TVStxt');
    if (!fs.existsSync(tvsDir)) return;
    try {
        const entries = await fsp.readdir(tvsDir, { withFileTypes: true });
        for (const ent of entries) {
            if (ent.isFile() && ent.name.endsWith('.txt')) {
                const st = await fsp.stat(path.join(tvsDir, ent.name));
                result.tvs.push({
                    name: ent.name,
                    relPath: `TVStxt/${ent.name}`,
                    size: st.size,
                });
            }
        }
    } catch {}
}

// 上游 image/<表情包或目录>/
async function scanImages(root, result) {
    const imgDir = path.join(root, 'image');
    if (!fs.existsSync(imgDir)) return;
    try {
        const entries = await fsp.readdir(imgDir, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const sub = path.join(imgDir, ent.name);
            const files = await fsp.readdir(sub).catch(() => []);
            const size = await dirSize(sub);
            result.images.push({
                name: ent.name,
                relPath: `image/${ent.name}`,
                fileCount: files.length,
                size,
            });
        }
    } catch {}
}

// 向量索引：扫描每个插件下的 VectorStore/
async function scanVectors(root, result) {
    for (const plugin of result.plugins) {
        const sub = path.join(root, 'Plugin', plugin.name);
        for (const v of VECTOR_SUBDIRS) {
            const vp = path.join(sub, v);
            if (fs.existsSync(vp)) {
                const size = await dirSize(vp);
                result.vectors.push({
                    plugin: plugin.name,
                    relPath: `Plugin/${plugin.name}/${v}`,
                    size,
                });
                break;
            }
        }
    }
    // 顶层 modules/VectorStore（Junior 结构，上游可能没有）
    const topVec = path.join(root, 'modules', 'VectorStore');
    if (fs.existsSync(topVec)) {
        result.vectors.push({
            plugin: '__global__',
            relPath: 'modules/VectorStore',
            size: await dirSize(topVec),
        });
    }
}

// 解析 config.env 字段（保留注释位置）
async function scanConfigEnv(root, result) {
    const envPath = path.join(root, 'config.env');
    if (!fs.existsSync(envPath)) return;
    try {
        const text = await fsp.readFile(envPath, 'utf8');
        const keys = [];
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (m) {
                keys.push({
                    key: m[1],
                    value: m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'),
                    lineNum: i + 1,
                });
            }
        }
        result.configEnv = { keys, totalLines: lines.length };
    } catch (e) {
        result.configEnv = { error: e.message };
    }
}

// 解析 agent_map.json（可能是旧格式字符串或新格式对象）
async function scanAgentMap(root, result) {
    const paths = [
        path.join(root, 'agent_map.json'),
        path.join(root, 'agent_map.json.example'),
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) {
            try {
                const text = await fsp.readFile(p, 'utf8');
                const parsed = JSON.parse(text);
                result.agentMap = {
                    source: path.basename(p),
                    format: detectAgentMapFormat(parsed),
                    entries: Object.keys(parsed).length,
                    raw: parsed,
                };
                return;
            } catch {}
        }
    }
}

function detectAgentMapFormat(obj) {
    const firstVal = Object.values(obj || {})[0];
    if (typeof firstVal === 'string') return 'legacy-string';
    if (firstVal && typeof firstVal === 'object' && 'prompt' in firstVal) return 'new-object';
    return 'unknown';
}

module.exports = { scanUpstream };
