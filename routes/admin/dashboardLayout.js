// 仪表盘卡片布局持久化 API
// writeFile-style 约定：POST body 直接是布局数组（不包装）
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const FILE_NAME = 'dashboard-layout.json';

module.exports = function () {
    const router = express.Router();

    function getFilePath() {
        const root = process.env.VCP_ROOT || path.join(__dirname, '..', '..');
        return path.join(root, FILE_NAME);
    }

    // GET /dashboard-layout - 获取布局
    router.get('/dashboard-layout', async (req, res) => {
        const filePath = getFilePath();
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            const layouts = Array.isArray(data) ? data : (Array.isArray(data.layouts) ? data.layouts : []);
            res.json({ success: true, layouts });
        } catch (err) {
            if (err.code === 'ENOENT') {
                // 首次使用，返回空数组，前端按默认顺序展示
                return res.json({ success: true, layouts: [] });
            }
            console.error('[DashboardLayout] 读取失败:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /dashboard-layout - 保存布局（全量覆盖）
    // body 结构：[{ id, order, size, visible }, ...]
    router.post('/dashboard-layout', async (req, res) => {
        const filePath = getFilePath();
        const body = req.body;

        if (!Array.isArray(body)) {
            return res.status(400).json({
                success: false,
                error: '请求体必须是布局数组',
            });
        }

        const ALLOWED_SIZES = new Set(['sm', 'md', 'lg', 'xl']);
        const sanitized = [];
        for (const raw of body) {
            if (!raw || typeof raw !== 'object') continue;
            if (typeof raw.id !== 'string' || !raw.id) continue;
            const item = {
                id: raw.id,
                order: Number.isFinite(raw.order) ? Number(raw.order) : 0,
                size: ALLOWED_SIZES.has(raw.size) ? raw.size : 'md',
                visible: raw.visible !== false, // 默认 true
            };
            sanitized.push(item);
        }

        try {
            await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf-8');
            res.json({ success: true, count: sanitized.length });
        } catch (err) {
            console.error('[DashboardLayout] 保存失败:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
