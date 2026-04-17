// routes/admin/panelRegistry.js
// 管理面板注册表 API — 列出可选面板，前端未来可做切换 UI
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// SEA 兼容：__dirname 在 SEA 里是虚拟路径
const REGISTRY_FILE = path.join(process.env.VCP_ROOT || path.resolve(__dirname, '..', '..'), 'data', 'panel-registry.json');

const DEFAULT_REGISTRY = {
    version: 1,
    description: '默认 registry（data/panel-registry.json 不存在时的回退）',
    panels: [
        {
            id: 'official',
            name: 'VCPtoolbox-Junior Panel (官方)',
            description: 'Vue 3 官方重构版',
            repo: 'https://github.com/lioensky/VCPtoolbox-Junior-Panel',
            maintainer: 'VCPtoolbox-Junior Core Team',
            featured: true,
        },
    ],
};

module.exports = function (options) {
    const router = express.Router();

    // 列出所有注册面板
    router.get('/panel-registry', async (req, res) => {
        try {
            const txt = await fs.readFile(REGISTRY_FILE, 'utf8');
            const data = JSON.parse(txt);
            res.json({ success: true, ...data });
        } catch (e) {
            if (e.code === 'ENOENT') {
                return res.json({ success: true, ...DEFAULT_REGISTRY });
            }
            res.status(500).json({ success: false, error: '读取注册表失败: ' + e.message });
        }
    });

    // 保存 registry（writeFile-style：body 即文件内容）
    router.post('/panel-registry', async (req, res) => {
        try {
            const body = req.body;
            if (!body || typeof body !== 'object' || !Array.isArray(body.panels)) {
                return res.status(400).json({ success: false, error: 'Registry 结构非法，需 { version, panels: [...] }' });
            }
            await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
            await fs.writeFile(REGISTRY_FILE, JSON.stringify(body, null, 2), 'utf8');
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: '保存失败: ' + e.message });
        }
    });

    return router;
};
