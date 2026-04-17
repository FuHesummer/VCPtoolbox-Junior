const express = require('express');
const fs = require('fs').promises;
const path = require('path');

module.exports = function(options) {
    const router = express.Router();
    const { agentDirPath, DEBUG_MODE } = options;
    const AGENT_FILES_DIR = agentDirPath;
    const AGENT_MAP_FILE = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'agent_map.json');

    // 确保 agentManager 单例在当前进程中已正确配置
    // 在独立 adminServer 进程中，agentManager.initialize() 不会被主服务调用，
    // 因此需要在此处设置目录并触发文件扫描
    const agentManager = require('../../modules/agentManager');
    const _agentScanReady = (async () => {
        try {
            agentManager.setAgentDir(AGENT_FILES_DIR);
            agentManager.debugMode = !!DEBUG_MODE;
            await agentManager.scanAgentFiles();
        } catch (err) {
            console.error('[routes/admin/agents] Failed to initialize agentManager scan:', err.message);
        }
    })();

    // GET agent map — normalize path separators to forward slashes for cross-platform
    router.get('/agents/map', async (req, res) => {
        try {
            const content = await fs.readFile(AGENT_MAP_FILE, 'utf-8');
            const raw = JSON.parse(content);
            const normalized = {};
            for (const [alias, value] of Object.entries(raw)) {
                if (typeof value === 'string') {
                    normalized[alias] = value.replace(/\\/g, '/');
                } else if (value && typeof value === 'object') {
                    normalized[alias] = { ...value };
                    if (typeof value.prompt === 'string') {
                        normalized[alias].prompt = value.prompt.replace(/\\/g, '/');
                    }
                } else {
                    normalized[alias] = value;
                }
            }
            res.json(normalized);
        } catch (error) {
            if (error.code === 'ENOENT') res.json({});
            else res.status(500).json({ error: 'Failed to read agent map file', details: error.message });
        }
    });

    // POST save agent map
    router.post('/agents/map', async (req, res) => {
        const newMap = req.body;
        if (typeof newMap !== 'object' || newMap === null) {
            return res.status(400).json({ error: 'Invalid request body.' });
        }
        try {
            await fs.writeFile(AGENT_MAP_FILE, JSON.stringify(newMap, null, 2), 'utf-8');
            res.json({ message: 'Agent map saved successfully. A server restart may be required for changes to apply.' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to write agent map file', details: error.message });
        }
    });

    // GET list of agent files
    router.get('/agents', async (req, res) => {
        try {
            await _agentScanReady; // 确保初始扫描已完成
            const agentFilesData = await agentManager.getAllAgentFiles();
            res.json(agentFilesData);
        } catch (error) {
            res.status(500).json({ error: 'Failed to list agent files', details: error.message });
        }
    });

    // POST create new agent file
    router.post('/agents/new-file', async (req, res) => {
        const { fileName, folderPath } = req.body;
        if (!fileName || typeof fileName !== 'string') {
            return res.status(400).json({ error: 'Invalid file name.' });
        }
        let finalFileName = fileName;
        if (!fileName.toLowerCase().endsWith('.txt') && !fileName.toLowerCase().endsWith('.md')) {
            finalFileName = `${fileName}.txt`;
        }
        let targetDir = AGENT_FILES_DIR;
        if (folderPath && typeof folderPath === 'string') {
            targetDir = path.join(AGENT_FILES_DIR, folderPath);
        }
        const filePath = path.join(targetDir, finalFileName);
        try {
            await fs.mkdir(targetDir, { recursive: true });
            await fs.writeFile(filePath, '', { flag: 'wx' });
            await agentManager.scanAgentFiles();
            res.json({ message: `File '${finalFileName}' created successfully.` });
        } catch (error) {
            if (error.code === 'EEXIST') res.status(409).json({ error: `File '${finalFileName}' already exists.` });
            else res.status(500).json({ error: `Failed to create agent file ${finalFileName}`, details: error.message });
        }
    });

    // GET specific agent file content
    router.get('/agents/:fileName', async (req, res) => {
        try {
            const decodedFileName = decodeURIComponent(req.params.fileName);
            if (!decodedFileName.toLowerCase().endsWith('.txt') && !decodedFileName.toLowerCase().endsWith('.md')) {
                return res.status(400).json({ error: 'Invalid file name.' });
            }
            const filePath = path.join(AGENT_FILES_DIR, decodedFileName.replace(/\//g, path.sep));
            await fs.access(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            res.json({ content });
        } catch (error) {
            if (error.code === 'ENOENT') res.status(404).json({ error: 'Agent file not found.' });
            else res.status(500).json({ error: 'Failed to read agent file', details: error.message });
        }
    });

    // POST save specific agent file content
    router.post('/agents/:fileName', async (req, res) => {
        const { content } = req.body;
        try {
            const decodedFileName = decodeURIComponent(req.params.fileName);
            if (!decodedFileName.toLowerCase().endsWith('.txt') && !decodedFileName.toLowerCase().endsWith('.md')) {
                return res.status(400).json({ error: 'Invalid file name.' });
            }
            if (typeof content !== 'string') return res.status(400).json({ error: 'Invalid request body.' });
            const filePath = path.join(AGENT_FILES_DIR, decodedFileName.replace(/\//g, path.sep));
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            res.json({ message: `Agent file '${decodedFileName}' saved successfully.` });
        } catch (error) {
            res.status(500).json({ error: 'Failed to save agent file', details: error.message });
        }
    });

    // ====== Agent 头像 ======
    // 存储路径：<AGENT_FILES_DIR>/_avatars/<alias>.<ext>
    // 上传用 base64 via JSON（轻量，无需 multer），适合头像这种小图
    const AVATAR_DIR = path.join(AGENT_FILES_DIR, '_avatars');
    const ALLOWED_AVATAR_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

    function sanitizeAlias(alias) {
        // 防路径穿越 — 仅允许字母数字中文和常见符号
        return String(alias || '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').trim();
    }

    async function findAvatarFile(alias) {
        const safe = sanitizeAlias(alias);
        if (!safe) return null;
        for (const ext of ALLOWED_AVATAR_EXT) {
            const p = path.join(AVATAR_DIR, `${safe}.${ext}`);
            try { await fs.access(p); return { path: p, ext }; } catch { /* continue */ }
        }
        return null;
    }

    // GET avatar — 返回图片字节流，找不到返回 404
    router.get('/agents/:alias/avatar', async (req, res) => {
        try {
            const hit = await findAvatarFile(req.params.alias);
            if (!hit) return res.status(404).end();
            const mime = hit.ext === 'svg' ? 'image/svg+xml'
                : hit.ext === 'jpg' ? 'image/jpeg'
                : `image/${hit.ext}`;
            res.setHeader('Content-Type', mime);
            res.setHeader('Cache-Control', 'no-cache');
            const buf = await fs.readFile(hit.path);
            res.end(buf);
        } catch (error) {
            res.status(500).json({ error: 'Failed to read avatar', details: error.message });
        }
    });

    // POST avatar — body { data: "data:image/png;base64,..." } 或 { data: "纯 base64", ext: "png" }
    router.post('/agents/:alias/avatar', async (req, res) => {
        try {
            const alias = sanitizeAlias(req.params.alias);
            if (!alias) return res.status(400).json({ error: 'Invalid alias' });
            const { data } = req.body || {};
            if (typeof data !== 'string') return res.status(400).json({ error: 'Missing image data' });

            // 解析 data URL
            let ext = (req.body.ext || '').toLowerCase().replace('.', '');
            let base64 = data;
            const m = /^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/.exec(data);
            if (m) {
                ext = m[1].toLowerCase();
                base64 = m[2];
            }
            if (ext === 'jpeg') ext = 'jpg';
            if (!ALLOWED_AVATAR_EXT.includes(ext)) {
                return res.status(400).json({ error: `Unsupported image ext: ${ext}` });
            }

            const buf = Buffer.from(base64, 'base64');
            // 大小限制：2MB
            if (buf.length > 2 * 1024 * 1024) {
                return res.status(413).json({ error: 'Avatar too large (max 2MB)' });
            }

            // 删除该 alias 之前其它扩展名的头像
            const existing = await findAvatarFile(alias);
            if (existing) { try { await fs.unlink(existing.path); } catch { /* ignore */ } }

            await fs.mkdir(AVATAR_DIR, { recursive: true });
            const target = path.join(AVATAR_DIR, `${alias}.${ext}`);
            await fs.writeFile(target, buf);
            res.json({ message: 'Avatar saved', ext, size: buf.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to save avatar', details: error.message });
        }
    });

    // DELETE avatar
    router.delete('/agents/:alias/avatar', async (req, res) => {
        try {
            const hit = await findAvatarFile(req.params.alias);
            if (!hit) return res.status(404).json({ error: 'No avatar' });
            await fs.unlink(hit.path);
            res.json({ message: 'Avatar removed' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete avatar', details: error.message });
        }
    });

    return router;
};
