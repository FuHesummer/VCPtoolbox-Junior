// routes/admin/migration.js
// 上游 VCPToolBox 一键迁移路由
const express = require('express');
const {
    scanUpstream,
    diffConfigEnv,
    matchPlugins,
    backupCurrent,
    listBackups,
    executeMigration,
    readHistory,
    lock,
} = require('../../modules/migration');

module.exports = function (_options) {
const router = express.Router();

// 扫描源目录
router.post('/migration/scan', async (req, res) => {
    try {
        const sourcePath = (req.body?.sourcePath || '').trim();
        if (!sourcePath) return res.status(400).json({ error: 'sourcePath required' });
        const result = await scanUpstream(sourcePath);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 配置 diff
router.post('/migration/diff-config', async (req, res) => {
    try {
        const sourcePath = (req.body?.sourcePath || '').trim();
        if (!sourcePath) return res.status(400).json({ error: 'sourcePath required' });
        const result = await diffConfigEnv(sourcePath);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 插件匹配
router.post('/migration/match-plugins', async (req, res) => {
    try {
        const plugins = req.body?.plugins;
        if (!Array.isArray(plugins)) return res.status(400).json({ error: 'plugins array required' });
        const result = await matchPlugins(plugins);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 手动触发备份（不迁移，仅备份）
router.post('/migration/backup', async (req, res) => {
    try {
        const label = (req.body?.label || '').trim() || null;
        const result = await backupCurrent(label);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 备份列表
router.get('/migration/backups', async (req, res) => {
    try {
        const list = await listBackups();
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 历史记录
router.get('/migration/history', async (req, res) => {
    try {
        const list = await readHistory();
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 执行状态（lock 信息）
router.get('/migration/status', (req, res) => {
    res.json(lock.status());
});

// 取消当前任务
router.post('/migration/cancel', (req, res) => {
    const jobId = req.body?.jobId;
    const status = lock.status();
    if (!status.running) return res.status(409).json({ error: '无正在运行的任务' });
    if (jobId && status.jobId !== jobId) {
        return res.status(409).json({ error: 'jobId 不匹配', currentJobId: status.jobId });
    }
    lock.cancel(status.jobId);
    res.json({ ok: true, jobId: status.jobId, note: '取消标志已设置，当前步骤完成后将停止' });
});

// 执行迁移（SSE）
router.post('/migration/execute', async (req, res) => {
    // 前置：lock 可用性检查
    if (lock.status().running) {
        return res.status(409).json({ error: '已有迁移任务在运行', current: lock.status() });
    }

    const plan = req.body?.plan;
    if (!plan || typeof plan !== 'object') {
        return res.status(400).json({ error: 'plan object required' });
    }
    if (!plan.sourcePath) {
        return res.status(400).json({ error: 'plan.sourcePath required' });
    }

    // SSE 头
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    // 保活
    const keepAlive = setInterval(() => {
        try { res.write(': keepalive\n\n'); } catch {}
    }, 15000);

    let emitter;
    try {
        const handle = executeMigration(plan);
        emitter = handle.emitter;
        const jobId = handle.job.jobId;
        res.write(`event: open\ndata: ${JSON.stringify({ jobId })}\n\n`);

        emitter.on('log', evt => {
            try {
                res.write(`event: log\ndata: ${JSON.stringify(evt)}\n\n`);
            } catch {}
        });
        emitter.on('done', summary => {
            try {
                res.write(`event: done\ndata: ${JSON.stringify(summary)}\n\n`);
                res.end();
            } catch {}
            clearInterval(keepAlive);
        });
        emitter.on('error', err => {
            try {
                res.write(`event: fatal\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
                res.end();
            } catch {}
            clearInterval(keepAlive);
        });

        req.on('close', () => {
            // 客户端断开不自动取消任务（迁移继续后台跑到完成 / 调用 /cancel 才中断）
            clearInterval(keepAlive);
        });
    } catch (e) {
        clearInterval(keepAlive);
        try {
            res.write(`event: fatal\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
        } catch {}
        res.end();
    }
});

return router;
};
