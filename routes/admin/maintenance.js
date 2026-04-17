// routes/admin/maintenance.js
// 运维中心：白名单执行 + 串行锁 + SSE 实时日志 + 审计落盘
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// SEA 兼容：__dirname 在 SEA 里是虚拟路径
const PROJECT_ROOT = process.env.VCP_ROOT || path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'maintenance-history.json');
const LOGS_DIR = path.join(DATA_DIR, 'maintenance-logs');
const MAX_HISTORY = 100;
const MAX_OUTPUT_MEMORY = 512 * 1024;  // 内存里只保 512KB，磁盘完整
const MAX_LOG_DISK_SIZE = 4 * 1024 * 1024;  // 单个 log 上限 4MB

// ============================================================
// 白名单：所有允许通过面板执行的脚本
// key = 前端展示的 scriptId；cmd = 实际执行的命令数组
// ============================================================
const SCRIPTS = {
    'rebuild-vectors': {
        title: '重建向量索引',
        description: '清空并重建所有向量索引文件，修复 ghost ID 不同步问题',
        category: 'index',
        danger: 'high',
        requiresStopServer: true,
        icon: 'refresh',
        cmd: ['node', 'maintain.js', 'rebuild-vectors'],
    },
    'rebuild-tags': {
        title: '重建标签索引',
        description: '重建 TagMemo 引擎的标签向量索引（清理黑名单/重复标签）',
        category: 'index',
        danger: 'high',
        requiresStopServer: true,
        icon: 'label',
        cmd: ['node', 'maintain.js', 'rebuild-tags'],
    },
    'repair-db': {
        title: '修复数据库重复标签',
        description: '修复数据库中重复的标签条目（无需重新嵌入）',
        category: 'db',
        danger: 'high',
        requiresStopServer: true,
        icon: 'healing',
        cmd: ['node', 'maintain.js', 'repair-db'],
    },
    'sync-tags': {
        title: '补齐缺失标签',
        description: '扫描日记文件，补齐数据库中已记录但缺失的标签',
        category: 'db',
        danger: 'medium',
        requiresStopServer: false,
        icon: 'sync',
        cmd: ['node', 'maintain.js', 'sync-tags'],
    },
    'check-tagmemo': {
        title: '检查标签记忆状态',
        description: '诊断 TagMemo 引擎数据完整性，只读不改',
        category: 'diagnose',
        danger: 'low',
        requiresStopServer: false,
        icon: 'health_and_safety',
        cmd: ['node', 'scripts/check_tagmemo_status.js'],
    },
    'backup': {
        title: '备份到 ZIP',
        description: '打包项目关键配置文件（txt/md/env/json）到 zip 存档',
        category: 'ops',
        danger: 'low',
        requiresStopServer: false,
        icon: 'archive',
        cmd: ['node', 'maintain.js', 'backup'],
        args: [
            { name: 'filename', label: '备份文件名', placeholder: 'vcp-backup.zip', required: false },
        ],
    },
    'sync-env': {
        title: '同步 config.env 结构',
        description: '比对 config.env 与 config.env.example 结构，补齐缺失项',
        category: 'ops',
        danger: 'low',
        requiresStopServer: false,
        icon: 'settings_sync',
        cmd: ['node', 'scripts/sync-env-structure.js'],
    },
    // 注：scripts/sync-panel.js 是本地开发专用工具（把 AdminPanel-Vue 源码推送到独立发布仓库）
    // 不做成面板动作，也不随仓库分发，已在 .gitignore 白名单中排除
};

const CATEGORIES = {
    index: '索引重建',
    db: '数据库修复',
    diagnose: '状态诊断',
    ops: '备份运维',
};

// ============================================================
// 运行时状态：串行锁 + SSE 订阅者
// ============================================================
let currentJob = null;
const activeStreams = new Map();  // jobId -> Set<res>

function publicJob(job) {
    if (!job) return null;
    return {
        id: job.id,
        scriptId: job.scriptId,
        title: job.title,
        danger: job.danger,
        cmd: job.cmd,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        status: job.status,
        exitCode: job.exitCode,
        initiator: job.initiator,
    };
}

async function readHistory() {
    try {
        const txt = await fsp.readFile(HISTORY_FILE, 'utf8');
        const arr = JSON.parse(txt);
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

async function appendHistory(record) {
    try {
        await fsp.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
        const hist = await readHistory();
        hist.unshift(record);
        const trimmed = hist.slice(0, MAX_HISTORY);
        await fsp.writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
    } catch (e) {
        console.error('[Maintenance] Failed to write history:', e.message);
    }
}

// 参数过滤：只允许字母数字 + `-_.` + 中文
function sanitizeArg(v) {
    if (typeof v !== 'string') return '';
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > 200) return '';
    return trimmed.replace(/[^A-Za-z0-9_\-.\u4e00-\u9fa5]/g, '');
}

function startJob(scriptId, def, userArgs = {}) {
    const id = crypto.randomUUID();
    const cmdArgs = [...def.cmd];

    // 按白名单定义追加参数
    if (Array.isArray(def.args)) {
        for (const argDef of def.args) {
            const raw = userArgs && userArgs[argDef.name];
            const safe = sanitizeArg(raw);
            if (safe) cmdArgs.push(safe);
        }
    }

    const [cmd, ...args] = cmdArgs;
    const startedAt = new Date().toISOString();

    const proc = spawn(cmd, args, {
        cwd: PROJECT_ROOT,
        env: process.env,
        windowsHide: true,
        shell: process.platform === 'win32',  // Windows 下需要 shell 找 node.exe
    });

    const job = {
        id,
        scriptId,
        title: def.title,
        danger: def.danger,
        cmd: cmdArgs.join(' '),
        startedAt,
        finishedAt: null,
        status: 'running',
        exitCode: null,
        cancelled: false,
        output: '',
        diskBytes: 0,
        stderrLines: 0,
        process: proc,
        initiator: 'admin',
    };
    currentJob = job;

    // 确保磁盘日志目录
    try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) { /* ignore */ }
    const logPath = path.join(LOGS_DIR, id + '.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });

    function append(chunk, kind) {
        const text = chunk.toString('utf8');
        // 内存：保留末尾 N 字节
        job.output += text;
        if (job.output.length > MAX_OUTPUT_MEMORY) {
            job.output = job.output.slice(-MAX_OUTPUT_MEMORY);
        }
        // 磁盘：超过上限丢弃
        if (job.diskBytes < MAX_LOG_DISK_SIZE) {
            logStream.write(text);
            job.diskBytes += text.length;
            if (job.diskBytes >= MAX_LOG_DISK_SIZE) {
                logStream.write('\n[... 日志超过 ' + MAX_LOG_DISK_SIZE + ' 字节上限，后续输出已截断 ...]\n');
            }
        }
        // SSE 广播
        const subs = activeStreams.get(id);
        if (subs && subs.size) {
            const payload = JSON.stringify({ kind, text });
            for (const res of subs) {
                try { res.write('event: chunk\ndata: ' + payload + '\n\n'); } catch (_) { /* ignore */ }
            }
        }
    }

    proc.stdout.on('data', (c) => append(c, 'stdout'));
    proc.stderr.on('data', (c) => { job.stderrLines++; append(c, 'stderr'); });

    proc.on('error', (err) => {
        append('\n[ERROR] 无法启动进程: ' + err.message + '\n', 'stderr');
    });

    proc.on('close', async (exitCode) => {
        job.exitCode = exitCode;
        job.finishedAt = new Date().toISOString();
        job.status = job.cancelled ? 'cancelled' : (exitCode === 0 ? 'completed' : 'failed');
        try { logStream.end(); } catch (_) { /* ignore */ }

        // 完成事件推给订阅者
        const subs = activeStreams.get(id);
        if (subs && subs.size) {
            const payload = JSON.stringify({
                status: job.status,
                exitCode: job.exitCode,
                finishedAt: job.finishedAt,
                cancelled: job.cancelled,
            });
            for (const res of subs) {
                try {
                    res.write('event: done\ndata: ' + payload + '\n\n');
                    res.end();
                } catch (_) { /* ignore */ }
            }
            activeStreams.delete(id);
        }

        // 审计落盘
        await appendHistory({
            id: job.id,
            scriptId: job.scriptId,
            title: job.title,
            danger: job.danger,
            cmd: job.cmd,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            durationMs: new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime(),
            status: job.status,
            exitCode: job.exitCode,
            stderrLines: job.stderrLines,
            logBytes: job.diskBytes,
            initiator: job.initiator,
        });

        // 释放串行锁（必须在 appendHistory 之后，避免 race）
        if (currentJob && currentJob.id === id) {
            currentJob = null;
        }
    });

    return job;
}

module.exports = function (options) {
    const router = express.Router();

    // 脚本清单
    router.get('/maintenance/scripts', (req, res) => {
        const scripts = Object.entries(SCRIPTS).map(([id, def]) => ({
            id,
            title: def.title,
            description: def.description,
            category: def.category,
            categoryLabel: CATEGORIES[def.category] || def.category,
            danger: def.danger,
            requiresStopServer: def.requiresStopServer,
            icon: def.icon,
            args: def.args || [],
        }));
        res.json({ success: true, scripts, categories: CATEGORIES });
    });

    // 当前运行中任务（前端首次进入用来恢复）
    router.get('/maintenance/jobs/current', (req, res) => {
        res.json({
            success: true,
            job: currentJob ? publicJob(currentJob) : null,
            output: currentJob ? currentJob.output : '',
        });
    });

    // 历史列表（审计）
    router.get('/maintenance/history', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_HISTORY);
        const hist = await readHistory();
        res.json({ success: true, items: hist.slice(0, limit) });
    });

    // 单个 job 详情（含完整 stdout/stderr）
    router.get('/maintenance/jobs/:id', async (req, res) => {
        const { id } = req.params;
        if (currentJob && currentJob.id === id) {
            return res.json({ success: true, job: publicJob(currentJob), output: currentJob.output });
        }
        const hist = await readHistory();
        const rec = hist.find(h => h.id === id);
        if (!rec) return res.status(404).json({ success: false, error: '任务不存在' });
        let output = '';
        try {
            output = await fsp.readFile(path.join(LOGS_DIR, id + '.log'), 'utf8');
        } catch (_) { /* optional */ }
        res.json({ success: true, job: rec, output });
    });

    // 启动任务
    router.post('/maintenance/run', (req, res) => {
        if (currentJob) {
            return res.status(409).json({
                success: false,
                error: '当前已有任务在运行，请等其完成或取消',
                currentJobId: currentJob.id,
                currentTitle: currentJob.title,
            });
        }
        const scriptId = req.body && req.body.scriptId;
        const userArgs = (req.body && req.body.args) || {};
        const def = SCRIPTS[scriptId];
        if (!def) {
            return res.status(400).json({ success: false, error: '未知或未授权的脚本: ' + scriptId });
        }
        try {
            const job = startJob(scriptId, def, userArgs);
            res.json({ success: true, job: publicJob(job) });
        } catch (e) {
            res.status(500).json({ success: false, error: '启动失败: ' + e.message });
        }
    });

    // 取消运行中任务
    router.post('/maintenance/jobs/:id/cancel', (req, res) => {
        if (!currentJob || currentJob.id !== req.params.id) {
            return res.status(404).json({ success: false, error: '任务不在运行' });
        }
        try {
            currentJob.cancelled = true;
            // SIGTERM 优先，3 秒后 SIGKILL
            currentJob.process.kill('SIGTERM');
            const pid = currentJob.process.pid;
            setTimeout(() => {
                try {
                    if (currentJob && currentJob.process && currentJob.process.pid === pid && !currentJob.process.killed) {
                        currentJob.process.kill('SIGKILL');
                    }
                } catch (_) { /* ignore */ }
            }, 3000);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // SSE 实时日志流
    router.get('/maintenance/jobs/:id/stream', (req, res) => {
        const { id } = req.params;
        if (!currentJob || currentJob.id !== id) {
            return res.status(404).end();
        }
        res.set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders && res.flushHeaders();

        // 先补发历史 output（前端能恢复完整日志）
        if (currentJob.output) {
            res.write('event: replay\ndata: ' + JSON.stringify({ text: currentJob.output }) + '\n\n');
        }
        // 心跳，避免代理超时断开
        const heartbeat = setInterval(() => {
            try { res.write(':hb\n\n'); } catch (_) { /* ignore */ }
        }, 15000);

        const subs = activeStreams.get(id) || new Set();
        subs.add(res);
        activeStreams.set(id, subs);

        req.on('close', () => {
            clearInterval(heartbeat);
            const s = activeStreams.get(id);
            if (s) { s.delete(res); if (s.size === 0) activeStreams.delete(id); }
        });
    });

    return router;
};
