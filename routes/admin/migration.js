// routes/admin/migration.js
// 上游 VCPToolBox / VCPBackUp 一键迁移 + 备份管理路由
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const {
    scanUpstream,
    diffConfigEnv,
    matchPlugins,
    backupCurrent,
    listBackups,
    executeMigration,
    generateAutoPlan,
    readHistory,
    lock,
    source,
    webdav,
    exporter,
    scheduler,
} = require('../../modules/migration');
const { PROJECT_ROOT } = require('../../modules/migration/utils');

const UPLOAD_DIR = path.join(PROJECT_ROOT, 'data', 'migration-temp', 'uploads');
const MAX_UPLOAD_MB = parseInt(process.env.MIGRATION_UPLOAD_MAX_MB || '5120', 10);

// ========= multer: 接收 VCPBackUp zip 上传 =========

const upload = multer({
    storage: multer.diskStorage({
        destination: async (req, file, cb) => {
            try {
                await fsp.mkdir(UPLOAD_DIR, { recursive: true });
                cb(null, UPLOAD_DIR);
            } catch (e) {
                cb(e, UPLOAD_DIR);
            }
        },
        filename: (req, file, cb) => {
            const safe = file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
            const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}_${safe}`;
            cb(null, unique);
        },
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!/\.zip$/i.test(file.originalname)) {
            return cb(new Error('only .zip allowed'));
        }
        cb(null, true);
    },
});

module.exports = function (_options) {
const router = express.Router();

// ========= 源扫描与决策 =========

// 扫描源目录或 zip
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

// 🪄 智能推荐：一键生成完整默认 plan（Agent 全选 / 日记知识自动分流 / 插件合并本地+远程 / 配置不动）
router.post('/migration/auto-plan', async (req, res) => {
    try {
        const sourcePath = (req.body?.sourcePath || '').trim();
        if (!sourcePath) return res.status(400).json({ error: 'sourcePath required' });
        const result = await generateAutoPlan(sourcePath);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========= 上传 VCPBackUp zip =========

router.post('/migration/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'file required (multipart field: file)' });
        const abs = req.file.path;
        res.json({
            ok: true,
            sourcePath: abs,
            filename: req.file.originalname,
            savedAs: path.basename(abs),
            size: req.file.size,
            note: '下一步调 /migration/scan 传 sourcePath',
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 列出已上传 zip（供 Panel 复用历史上传）
router.get('/migration/uploads', async (req, res) => {
    try {
        await fsp.mkdir(UPLOAD_DIR, { recursive: true });
        const entries = await fsp.readdir(UPLOAD_DIR);
        const out = [];
        for (const f of entries) {
            if (!/\.zip$/i.test(f)) continue;
            const p = path.join(UPLOAD_DIR, f);
            const st = await fsp.stat(p).catch(() => null);
            if (!st) continue;
            out.push({
                filename: f,
                absPath: p,
                size: st.size,
                createdAt: st.mtime.toISOString(),
            });
        }
        out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        res.json(out);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 删除指定上传文件
router.delete('/migration/uploads/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const target = path.join(UPLOAD_DIR, name);
        if (path.dirname(target) !== UPLOAD_DIR) return res.status(400).json({ error: 'invalid name' });
        if (!fs.existsSync(target)) return res.status(404).json({ error: 'not found' });
        await fsp.unlink(target);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========= WebDAV（坚果云）=========

router.get('/migration/webdav/config', (req, res) => {
    const cfg = webdav.getConfig();
    // 脱敏
    res.json({
        enabled: cfg.enabled,
        url: cfg.url,
        basePath: cfg.basePath,
        userConfigured: !!cfg.user,
        passwordConfigured: !!cfg.password,
    });
});

router.post('/migration/webdav/test', async (req, res) => {
    try {
        const r = await webdav.testConnection();
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/migration/webdav/list', async (req, res) => {
    try {
        const items = await webdav.list();
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/migration/webdav/download', async (req, res) => {
    try {
        const filename = (req.body?.filename || '').trim();
        if (!filename) return res.status(400).json({ error: 'filename required' });
        await fsp.mkdir(UPLOAD_DIR, { recursive: true });
        const localPath = path.join(UPLOAD_DIR, `webdav-${Date.now()}_${filename}`);
        const result = await webdav.download(filename, localPath);
        res.json({ ...result, sourcePath: localPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/migration/webdav/upload', async (req, res) => {
    try {
        const relOrAbs = (req.body?.filePath || '').trim();
        if (!relOrAbs) return res.status(400).json({ error: 'filePath required' });
        const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(PROJECT_ROOT, relOrAbs);
        if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file not found' });

        // 确保远端目录存在
        await webdav.mkcol().catch(() => {});
        const remoteName = req.body?.remoteName || path.basename(abs);
        const r = await webdav.upload(abs, remoteName);
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/migration/webdav/:filename', async (req, res) => {
    try {
        const r = await webdav.remove(req.params.filename);
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========= 导出 VCPBackUp 兼容包 =========

router.post('/migration/export', async (req, res) => {
    try {
        const asFull = !!req.body?.asFull;
        const uploadAfter = !!req.body?.uploadToWebdav;

        const srv = await exporter.exportVcpServerBackup();
        let full = null;
        let upload = null;

        if (asFull || uploadAfter) {
            full = await exporter.exportFullBackup({ vcpServerZipPath: srv.zipPath });
        }

        if (uploadAfter) {
            await webdav.mkcol().catch(() => {});
            const target = full || srv;
            upload = await webdav.upload(target.zipPath, target.filename);
        }

        res.json({ ok: true, server: srv, full, upload });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/migration/exports', async (req, res) => {
    try {
        res.json(await exporter.listExports());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 下载本地导出文件
router.get('/migration/exports/:name/download', async (req, res) => {
    try {
        const name = req.params.name;
        const p = path.join(exporter.EXPORT_DIR, name);
        if (path.dirname(p) !== exporter.EXPORT_DIR) return res.status(400).json({ error: 'invalid name' });
        if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
        res.download(p, name);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/migration/exports/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const p = path.join(exporter.EXPORT_DIR, name);
        if (path.dirname(p) !== exporter.EXPORT_DIR) return res.status(400).json({ error: 'invalid name' });
        if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
        await fsp.unlink(p);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========= 定期备份调度 =========

router.get('/migration/schedule', async (req, res) => {
    try {
        res.json(await scheduler.getSchedulerStatus());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/migration/schedule', async (req, res) => {
    try {
        const input = req.body || {};
        const allowed = ['enabled', 'cron', 'keepCount', 'keepDays', 'uploadToWebdav', 'uploadAsFull'];
        const patch = {};
        for (const k of allowed) if (k in input) patch[k] = input[k];
        const prev = await scheduler.loadConfig();
        await scheduler.saveConfig({ ...prev, ...patch });
        const applied = await scheduler.applySchedule();
        res.json({ ok: true, config: await scheduler.loadConfig(), applied });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/migration/schedule/trigger', async (req, res) => {
    try {
        const entry = await scheduler.runOnce({ trigger: 'manual' });
        res.json(entry);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/migration/schedule/history', async (req, res) => {
    try {
        res.json(await scheduler.loadHistory());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========= 迁移备份（原有 + 清理）=========

router.post('/migration/backup', async (req, res) => {
    try {
        const label = (req.body?.label || '').trim() || null;
        const result = await backupCurrent(label);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/migration/backups', async (req, res) => {
    try {
        res.json(await listBackups());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/migration/history', async (req, res) => {
    try {
        res.json(await readHistory());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 清理迁移临时目录（zip 解压残留）
router.post('/migration/cleanup-temp', async (req, res) => {
    try {
        const r = await source.cleanupAllTemp();
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/migration/temp-list', async (req, res) => {
    try {
        res.json(await source.listTempDirs());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========= 执行控制（原有）=========

router.get('/migration/status', (req, res) => {
    res.json(lock.status());
});

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

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    const keepAlive = setInterval(() => {
        try { res.write(': keepalive\n\n'); } catch {}
    }, 15000);

    try {
        const handle = executeMigration(plan);
        const emitter = handle.emitter;
        const jobId = handle.job.jobId;
        res.write(`event: open\ndata: ${JSON.stringify({ jobId })}\n\n`);

        emitter.on('log', evt => {
            try { res.write(`event: log\ndata: ${JSON.stringify(evt)}\n\n`); } catch {}
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
