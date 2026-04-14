const express = require('express');
const fs = require('fs').promises;
const path = require('path');

module.exports = function(options) {
    const router = express.Router();
    const { dailyNoteRootPath, vectorDBManager } = options;

    router.get('/rag-tags', async (req, res) => {
        const ragTagsPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin', 'RAGDiaryPlugin', 'rag_tags.json');
        try {
            const content = await fs.readFile(ragTagsPath, 'utf-8');
            res.json(JSON.parse(content));
        } catch (error) {
            if (error.code === 'ENOENT') res.json({});
            else res.status(500).json({ error: 'Failed' });
        }
    });

    router.post('/rag-tags', async (req, res) => {
        const ragTagsPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin', 'RAGDiaryPlugin', 'rag_tags.json');
        try {
            await fs.writeFile(ragTagsPath, JSON.stringify(req.body, null, 2), 'utf-8');
            res.json({ message: 'Saved' });
        } catch (error) { res.status(500).json({ error: 'Failed' }); }
    });

    router.get('/rag-params', async (req, res) => {
        const ragParamsPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'modules', 'rag_params.json');
        try {
            const content = await fs.readFile(ragParamsPath, 'utf-8');
            res.json(JSON.parse(content));
        } catch (error) { res.status(500).json({ error: 'Failed' }); }
    });

    router.post('/rag-params', async (req, res) => {
        const ragParamsPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'modules', 'rag_params.json');
        try {
            await fs.writeFile(ragParamsPath, JSON.stringify(req.body, null, 2), 'utf-8');
            res.json({ message: 'Saved' });
        } catch (error) { res.status(500).json({ error: 'Failed' }); }
    });

    router.get('/semantic-groups', async (req, res) => {
        const editFilePath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin', 'RAGDiaryPlugin', 'semantic_groups.edit.json');
        const mainFilePath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin', 'RAGDiaryPlugin', 'semantic_groups.json');
        try {
            const content = await fs.readFile(editFilePath, 'utf-8').catch(() => fs.readFile(mainFilePath, 'utf-8'));
            res.json(JSON.parse(content));
        } catch (error) { res.json({ config: {}, groups: {} }); }
    });

    router.post('/semantic-groups', async (req, res) => {
        const editFilePath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin', 'RAGDiaryPlugin', 'semantic_groups.edit.json');
        try {
            await fs.writeFile(editFilePath, JSON.stringify(req.body, null, 2), 'utf-8');
            res.json({ message: 'Saved' });
        } catch (error) { res.status(500).json({ error: 'Failed' }); }
    });

    router.get('/thinking-chains', async (req, res) => {
        const chainsPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin', 'RAGDiaryPlugin', 'meta_thinking_chains.json');
        try {
            const content = await fs.readFile(chainsPath, 'utf-8');
            res.json(JSON.parse(content));
        } catch (error) { res.status(500).json({ error: 'Failed' }); }
    });

    router.post('/thinking-chains', async (req, res) => {
        const chainsPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin', 'RAGDiaryPlugin', 'meta_thinking_chains.json');
        try {
            await fs.writeFile(chainsPath, JSON.stringify(req.body, null, 2), 'utf-8');
            res.json({ message: 'Saved' });
        } catch (error) { res.status(500).json({ error: 'Failed' }); }
    });

    // 扫描思维簇目录（以"簇"结尾的子目录）
    // Junior: 思维簇统一放在 thinking/ 目录；同时兼容 dailyNoteRootPath (= knowledge/) 以防用户放在老位置
    router.get('/available-clusters', async (req, res) => {
        const THINKING_ROOT = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'thinking');
        const names = new Set();
        const scan = async (root) => {
            try {
                const entries = await fs.readdir(root, { withFileTypes: true });
                for (const e of entries) {
                    if (e.isDirectory() && e.name.endsWith('簇')) names.add(e.name);
                }
            } catch (_) { /* 目录不存在就跳过 */ }
        };
        await scan(THINKING_ROOT);
        if (dailyNoteRootPath && dailyNoteRootPath !== THINKING_ROOT) {
            await scan(dailyNoteRootPath);
        }
        res.json({ clusters: Array.from(names).sort() });
    });

    router.get('/vectordb-status', (req, res) => {
        if (vectorDBManager && typeof vectorDBManager.getHealthStatus === 'function') {
            res.json({ success: true, status: vectorDBManager.getHealthStatus() });
        } else res.status(503).json({ error: 'Unavailable' });
    });

    return router;
};
