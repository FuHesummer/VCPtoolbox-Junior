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

    // 从文件夹的知识文件中自动提取 Tag: 行
    router.get('/extract-file-tags', async (req, res) => {
        const folder = req.query.folder;
        if (!folder) return res.status(400).json({ error: 'Missing folder parameter' });

        const VCP_ROOT = process.env.VCP_ROOT || path.join(__dirname, '..', '..');
        let dirPath;
        try {
            const { resolveNotebookPath } = require('../../modules/notebookResolver');
            dirPath = resolveNotebookPath(folder, dailyNoteRootPath);
        } catch {
            dirPath = path.join(dailyNoteRootPath || path.join(VCP_ROOT, 'knowledge'), folder);
        }

        try {
            const entries = await fs.readdir(dirPath);
            const tagCounts = new Map();

            for (const file of entries) {
                if (!file.endsWith('.txt') && !file.endsWith('.md')) continue;
                try {
                    const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const m = line.match(/^Tags?:\s*(.+)/);
                        if (!m) continue;
                        // 支持中英文逗号分隔
                        const tags = m[1].split(/[,，]/).map(t => t.trim()).filter(Boolean);
                        for (const tag of tags) {
                            // 跳过示例占位符
                            if (/^标签\d+/.test(tag) || tag.includes('「末」')) continue;
                            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                        }
                    }
                } catch { /* skip unreadable files */ }
            }

            // 按出现频率降序排列
            const sorted = [...tagCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([tag, count]) => ({ tag, count }));

            res.json({ tags: sorted, folder });
        } catch (err) {
            if (err.code === 'ENOENT') return res.json({ tags: [], folder, error: 'Folder not found' });
            res.status(500).json({ error: err.message });
        }
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
