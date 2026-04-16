// TimelineOrganizer — 时间线整理器主模块
// Junior 本体第 10 核心插件：管理 Agent 生平时间线 + 一键生成 TVStxt/ 下的 Markdown txt

const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const DATA_DIR = path.join(PLUGIN_DIR, 'data');
const VCP_ROOT = path.resolve(PLUGIN_DIR, '..', '..');
const AGENT_DIR = path.join(VCP_ROOT, 'Agent');
const TVSTXT_DIR = path.join(VCP_ROOT, 'TVStxt');
const CONFIG_ENV_PATH = path.join(VCP_ROOT, 'config.env');

// Timeline 文件名规范：Timeline{AgentName}.txt（驼峰连写，匹配现有 Agent 提示词里的 {{VarTimeline{Name}}}）
function timelineTxtName(agentName) {
    return `Timeline${agentName}.txt`;
}

// env var key：VarTimeline{Agent}（和文件名前缀对齐）
function timelineEnvKey(agentName) {
    return `VarTimeline${agentName}`;
}

function dataJsonPath(agentName) {
    return path.join(DATA_DIR, `${agentName}_timeline.json`);
}

// 在 config.env 中登记 `VarTimeline{Agent}={filename}.txt`
// 已存在则替换 value，不存在则 append 到文件末尾
async function registerEnvBinding(key, value) {
    let text = '';
    try { text = await fs.readFile(CONFIG_ENV_PATH, 'utf-8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }

    const re = new RegExp(`^(\\s*)(${key})(\\s*=\\s*)(["']?)([^"'\\r\\n]*)\\4(\\s*)$`, 'm');
    if (re.test(text)) {
        text = text.replace(re, `$1$2$3$4${value}$4$6`);
    } else {
        const prefix = text && !text.endsWith('\n') ? '\n' : '';
        text += `${prefix}# TimelineOrganizer 自动注册：${key}\n${key}=${value}\n`;
    }
    await fs.writeFile(CONFIG_ENV_PATH, text, 'utf-8');

    // 运行时更新 process.env 供 messageProcessor 立即使用（无需重启）
    process.env[key] = value;
}

// 卸载某 Agent 时清理 config.env 中的 VarTimeline 行
async function unregisterEnvBinding(key) {
    let text = '';
    try { text = await fs.readFile(CONFIG_ENV_PATH, 'utf-8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; return; }
    // 把 key 行和它上面的自动注册注释一起删掉
    const lineRe = new RegExp(`(^# TimelineOrganizer 自动注册：${key}\\s*\\n)?^${key}\\s*=.*$\\n?`, 'm');
    text = text.replace(lineRe, '');
    await fs.writeFile(CONFIG_ENV_PATH, text, 'utf-8');
    delete process.env[key];
}

async function ensureDirs() {
    for (const dir of [DATA_DIR, TVSTXT_DIR]) {
        try { await fs.mkdir(dir, { recursive: true }); } catch { /* ignore */ }
    }
}

// 扫 Agent/ 下所有子目录作为 Agent 列表（Junior v2 嵌套结构）
async function listAgents() {
    try {
        const entries = await fs.readdir(AGENT_DIR, { withFileTypes: true });
        const agents = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const agentName = entry.name;
            const jsonPath = dataJsonPath(agentName);
            const txtPath = path.join(TVSTXT_DIR, timelineTxtName(agentName));
            agents.push({
                name: agentName,
                hasTimeline: fsSync.existsSync(jsonPath),
                hasGeneratedTxt: fsSync.existsSync(txtPath),
            });
        }
        agents.sort((a, b) => a.name.localeCompare(b.name));
        return agents;
    } catch (e) {
        return [];
    }
}

// 读取单个 Agent 的 timeline.json（不存在时返回空壳）
async function readTimeline(agentName) {
    const p = dataJsonPath(agentName);
    try {
        const raw = await fs.readFile(p, 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        if (e.code === 'ENOENT') {
            return { character: agentName, lastUpdated: null, entries: {} };
        }
        throw e;
    }
}

// writeFile 风格：直接落盘 body（agent 名通过 :agent 参数校验）
async function writeTimeline(agentName, payload) {
    await ensureDirs();
    const safe = {
        character: payload.character || agentName,
        lastUpdated: new Date().toISOString().slice(0, 10),
        entries: (payload && typeof payload.entries === 'object' && payload.entries) || {},
    };
    await fs.writeFile(dataJsonPath(agentName), JSON.stringify(safe, null, 2), 'utf-8');
    return safe;
}

// 按日期升序生成 Markdown → 落盘到 TVStxt/Timeline_{Agent}.txt
async function generate(agentName) {
    await ensureDirs();
    const data = await readTimeline(agentName);
    const entries = data.entries || {};
    const dates = Object.keys(entries).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

    const lines = [];
    lines.push(`# ${data.character || agentName}的时间线`);
    lines.push(`> 最后更新: ${data.lastUpdated || new Date().toISOString().slice(0, 10)}`);
    lines.push('---');
    lines.push('');

    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        lines.push(`## ${date}`);
        const bucket = Array.isArray(entries[date]) ? entries[date] : [];
        for (const entry of bucket) {
            const summary = (entry && typeof entry.summary === 'string')
                ? entry.summary.trim().replace(/[。<]+$/, '')
                : '';
            if (summary) lines.push(`- ${summary}`);
        }
        if (i < dates.length - 1) lines.push('');
    }

    const markdown = lines.join('\n') + '\n';
    const fileName = timelineTxtName(agentName);
    const txtPath = path.join(TVSTXT_DIR, fileName);
    await fs.writeFile(txtPath, markdown, 'utf-8');

    // 自动在 config.env 注册 VarTimeline{Agent}=Timeline{Agent}.txt
    const envKey = timelineEnvKey(agentName);
    let envRegistered = false;
    try {
        await registerEnvBinding(envKey, fileName);
        envRegistered = true;
    } catch (e) {
        console.warn(`[TimelineOrganizer] env-binding 自动注册失败: ${e.message}`);
    }

    return {
        agent: agentName,
        file: fileName,
        path: txtPath,
        bytes: Buffer.byteLength(markdown),
        dates: dates.length,
        envKey,
        envRegistered,
    };
}

async function removeTimeline(agentName) {
    const jsonP = dataJsonPath(agentName);
    const txtP = path.join(TVSTXT_DIR, timelineTxtName(agentName));
    let jsonRemoved = false, txtRemoved = false, envRemoved = false;
    try { await fs.unlink(jsonP); jsonRemoved = true; } catch { /* ignore */ }
    try { await fs.unlink(txtP); txtRemoved = true; } catch { /* ignore */ }
    // 反向清理 config.env 中的 VarTimeline{Agent}
    try {
        await unregisterEnvBinding(timelineEnvKey(agentName));
        envRemoved = true;
    } catch (e) {
        console.warn(`[TimelineOrganizer] env-binding 反注册失败: ${e.message}`);
    }
    return { jsonRemoved, txtRemoved, envRemoved };
}

// ============ pluginAdminRouter ============
const pluginAdminRouter = express.Router();
pluginAdminRouter.use(express.json({ limit: '8mb' }));

// 简单的 Agent 名校验（防路径穿越）
const AGENT_NAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5\-]+$/;
function validateAgent(req, res, next) {
    const agent = req.params.agent;
    if (!agent || !AGENT_NAME_RE.test(agent)) {
        return res.status(400).json({ success: false, error: 'Invalid agent name' });
    }
    next();
}

pluginAdminRouter.get('/agents', async (req, res) => {
    try {
        const agents = await listAgents();
        res.json({ success: true, agents });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

pluginAdminRouter.get('/timeline/:agent', validateAgent, async (req, res) => {
    try {
        const data = await readTimeline(req.params.agent);
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

pluginAdminRouter.post('/timeline/:agent', validateAgent, async (req, res) => {
    try {
        const saved = await writeTimeline(req.params.agent, req.body || {});
        res.json({ success: true, data: saved });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

pluginAdminRouter.post('/generate/:agent', validateAgent, async (req, res) => {
    try {
        const result = await generate(req.params.agent);
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

pluginAdminRouter.delete('/timeline/:agent', validateAgent, async (req, res) => {
    try {
        const result = await removeTimeline(req.params.agent);
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Bootstrap：启动时为所有 Agent 预注册 VarTimeline{Agent}，保证 {{VarTimelineXXX}}
// 占位符随时可识别（即使用户从未编辑过）。已存在的不覆盖（保护用户改动）。
async function bootstrapTimelineEnv() {
    const agents = await listAgents();
    let created = 0, registered = 0;
    for (const a of agents) {
        const envKey = timelineEnvKey(a.name);
        const fileName = timelineTxtName(a.name);
        const txtPath = path.join(TVSTXT_DIR, fileName);

        // 1. 占位 TXT（如果不存在，写入友好提示内容）
        if (!fsSync.existsSync(txtPath)) {
            const placeholder = `# ${a.name}的时间线\n> 尚未设置。请在管理面板「时间线整理」中为 ${a.name} 添加日期和事件，然后点击「一键生成」。\n`;
            await fs.writeFile(txtPath, placeholder, 'utf-8');
            created++;
        }

        // 2. config.env 注册（如果未注册）
        if (!process.env[envKey]) {
            await registerEnvBinding(envKey, fileName);
            registered++;
        }
    }
    if (created || registered) {
        console.log(`[TimelineOrganizer] bootstrap: ${created} 个占位 TXT 创建, ${registered} 个 env 变量注册`);
    }
}

// ============ service plugin lifecycle ============
async function initialize(config) {
    await ensureDirs();
    try {
        await bootstrapTimelineEnv();
    } catch (e) {
        console.warn(`[TimelineOrganizer] bootstrap 失败（继续启动）: ${e.message}`);
    }
    return true;
}

async function shutdown() {
    return true;
}

module.exports = {
    initialize,
    shutdown,
    pluginAdminRouter,
};
