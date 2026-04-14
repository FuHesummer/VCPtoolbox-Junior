const express = require('express');
const fs = require('fs').promises;
const path = require('path');

module.exports = function(options) {
    const router = express.Router();
    const { pluginManager } = options;

    // --- Tool Approval Config API ---
    router.get('/tool-approval-config', async (req, res) => {
        const configPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'modules', 'toolApprovalConfig.json');
        try {
            const content = await fs.readFile(configPath, 'utf-8');
            res.json(JSON.parse(content));
        } catch (error) {
            if (error.code === 'ENOENT') {
                res.json({ enabled: false, timeoutMinutes: 5, approveAll: false, approvalList: [] });
            } else {
                console.error('[AdminPanelRoutes API] Error reading tool approval config:', error);
                res.status(500).json({ error: 'Failed to read tool approval config', details: error.message });
            }
        }
    });

    router.post('/tool-approval-config', async (req, res) => {
        const { config } = req.body;
        if (typeof config !== 'object' || config === null) {
            return res.status(400).json({ error: 'Invalid configuration data. Object expected.' });
        }
        const configPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'modules', 'toolApprovalConfig.json');
        try {
            await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
            res.json({ success: true, message: '工具调用审核配置已成功保存。' });
        } catch (error) {
            console.error('[AdminPanelRoutes API] Error writing tool approval config:', error);
            res.status(500).json({ error: 'Failed to write tool approval config', details: error.message });
        }
    });

    // --- 待审批任务列表（实时） ---
    // 基于 pluginManager.pendingApprovals 内存 Map，进程重启后清空
    router.get('/tool-approval-pending', (req, res) => {
        try {
            const pending = [];
            const map = pluginManager && pluginManager.pendingApprovals;
            if (map && typeof map.entries === 'function') {
                for (const [id, data] of map.entries()) {
                    pending.push({
                        requestId: id,
                        toolName: data.toolName || '?',
                        args: data.args || {},
                        maid: data.maid || null,
                        timestamp: data.timestamp || null,
                        createdAt: data.createdAt || null
                    });
                }
            }
            // 最新的在前
            pending.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            res.json({ pending });
        } catch (error) {
            console.error('[AdminPanelRoutes] Error listing pending approvals:', error);
            res.status(500).json({ error: 'Failed to list pending approvals', details: error.message });
        }
    });

    // 批准/拒绝待审批任务
    router.post('/tool-approval-pending/:requestId', (req, res) => {
        try {
            const { requestId } = req.params;
            const { approved } = req.body || {};
            if (typeof approved !== 'boolean') {
                return res.status(400).json({ error: 'Expected { approved: boolean }' });
            }
            const ok = pluginManager && typeof pluginManager.handleApprovalResponse === 'function'
                ? pluginManager.handleApprovalResponse(requestId, approved)
                : false;
            if (!ok) {
                return res.status(404).json({ success: false, error: 'Approval request not found or already resolved' });
            }
            res.json({ success: true, approved });
        } catch (error) {
            console.error('[AdminPanelRoutes] Error responding to approval:', error);
            res.status(500).json({ error: 'Failed to respond to approval', details: error.message });
        }
    });

    // --- Main Config API ---
    router.get('/config/main', async (req, res) => {
        try {
            const configPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'config.env');
            const content = await fs.readFile(configPath, 'utf-8');
            res.json({ content: content });
        } catch (error) {
            console.error('Error reading main config for admin panel:', error);
            res.status(500).json({ error: 'Failed to read main config file', details: error.message });
        }
    });

    router.get('/config/main/raw', async (req, res) => {
        try {
            const configPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'config.env');
            const content = await fs.readFile(configPath, 'utf-8');
            res.json({ content: content });
        } catch (error) {
            console.error('Error reading raw main config for admin panel:', error);
            res.status(500).json({ error: 'Failed to read raw main config file', details: error.message });
        }
    });

    router.post('/config/main', async (req, res) => {
        const { content } = req.body;
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid content format. String expected.' });
        }
        try {
            const configPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'config.env');
            await fs.writeFile(configPath, content, 'utf-8');
            await pluginManager.loadPlugins();
            res.json({ message: '主配置已成功保存并已重新加载。' });
        } catch (error) {
            console.error('Error writing main config for admin panel:', error);
            res.status(500).json({ error: 'Failed to write main config file', details: error.message });
        }
    });

    return router;
};
