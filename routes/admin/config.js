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

    // ============ env 绑定行级操作（供 TvsEditor 使用） ============
    // 把 TVS 文件加入 config.env：追加一行 KEY=filename.txt
    router.post('/config/env-binding/add', async (req, res) => {
        const { key, value } = req.body || {};
        if (!key || typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            return res.status(400).json({ error: 'key 必须为合法的环境变量名（字母、数字、下划线，以字母或下划线开头）' });
        }
        if (typeof value !== 'string' || value.trim() === '') {
            return res.status(400).json({ error: 'value 必须为非空字符串' });
        }
        try {
            const configPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'config.env');
            let text = '';
            try { text = await fs.readFile(configPath, 'utf-8'); } catch { /* 文件不存在时新建 */ }
            const lines = text.split(/\r?\n/);

            // 检查是否已有该 key
            const keyRegex = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
            const existingIdx = lines.findIndex(l => keyRegex.test(l));

            const needQuote = /[\s#"']/.test(value);
            const q = needQuote ? '"' : '';
            const newLine = `${key}=${q}${value}${q}`;

            let action = '';
            if (existingIdx >= 0) {
                lines[existingIdx] = newLine;
                action = 'updated';
            } else {
                if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
                lines.push(newLine);
                action = 'appended';
            }
            await fs.writeFile(configPath, lines.join('\n'), 'utf-8');
            process.env[key] = value;
            res.json({ ok: true, action, key, value });
        } catch (error) {
            console.error('[env-binding/add] error:', error);
            res.status(500).json({ error: 'Failed to write config.env', details: error.message });
        }
    });

    // 删除 config.env 中的 env 绑定
    // 两种模式：
    //   A. 按 key 删除：body { key: "VarXxx" }
    //   B. 按 filename 删除：body { filename: "xxx.txt" } → 删除所有 VALUE 匹配该 filename 的行
    router.post('/config/env-binding/remove', async (req, res) => {
        const { key, filename } = req.body || {};
        if (!key && !filename) {
            return res.status(400).json({ error: '需要提供 key 或 filename 至少一个' });
        }
        try {
            const configPath = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'config.env');
            let text = '';
            try { text = await fs.readFile(configPath, 'utf-8'); } catch {
                return res.status(404).json({ error: 'config.env 不存在' });
            }
            const lines = text.split(/\r?\n/);
            const removed = [];
            const newLines = lines.filter(line => {
                const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["']?)(.*?)\2\s*$/);
                if (!m) return true;
                const [, k, , v] = m;
                if (key && k === key) { removed.push({ key: k, value: v }); return false; }
                if (filename && v === filename) { removed.push({ key: k, value: v }); return false; }
                return true;
            });
            if (removed.length === 0) {
                return res.json({ ok: true, removed: [], message: '未匹配任何行' });
            }
            await fs.writeFile(configPath, newLines.join('\n'), 'utf-8');
            for (const r of removed) delete process.env[r.key];
            res.json({ ok: true, removed });
        } catch (error) {
            console.error('[env-binding/remove] error:', error);
            res.status(500).json({ error: 'Failed to write config.env', details: error.message });
        }
    });

    // --- 获取上游 API 可用模型列表（NewAPI / OpenAI 兼容） ---
    router.get('/config/models', async (req, res) => {
        try {
            const apiUrl = process.env.API_URL;
            const apiKey = process.env.API_Key;
            if (!apiUrl || !apiKey) {
                return res.json({ models: [], error: 'API_URL or API_Key not configured' });
            }

            const { default: fetch } = await import('node-fetch');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            try {
                const response = await fetch(`${apiUrl}/v1/models`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    signal: controller.signal
                });
                clearTimeout(timeout);

                if (!response.ok) {
                    return res.json({ models: [], error: `Upstream API returned ${response.status}` });
                }

                const json = await response.json();
                const models = (json.data || [])
                    .map(m => m.id)
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b));

                res.json({ models });
            } catch (fetchError) {
                clearTimeout(timeout);
                throw fetchError;
            }
        } catch (error) {
            console.error('[AdminPanelRoutes] Error fetching models from upstream API:', error.message);
            res.json({ models: [], error: error.message });
        }
    });

    return router;
};
