// routes/admin/sarPrompts.js
// [模型专属指令] 配置管理：通过 sarPromptManager 读写 sarprompt.json
// 占位符 {{SarPromptN}} 在消息处理时按当前模型 ID 匹配注入
const express = require('express');
const sarPromptManager = require('../../modules/sarPromptManager.js');

module.exports = function (options) {
    const router = express.Router();

    // GET /sar-prompts → 当前所有配对
    // 兼容前端格式：返回 { success, items: [{index, models, prompt}] }
    router.get('/sar-prompts', (req, res) => {
        try {
            const prompts = sarPromptManager.getAllPrompts();
            const items = prompts.map((g, i) => {
                const numMatch = g.promptKey && g.promptKey.match(/\d+$/);
                return {
                    index: numMatch ? parseInt(numMatch[0], 10) : (i + 1),
                    models: g.models || [],
                    prompt: g.content || '',
                };
            });
            res.json({ success: true, items });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // POST /sar-prompts → 整体保存
    // 接收 body.items: [{index, models, prompt}]
    router.post('/sar-prompts', async (req, res) => {
        try {
            const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
            if (!items) {
                return res.status(400).json({ success: false, error: 'body 需包含 items 数组' });
            }

            const seen = new Set();
            for (const it of items) {
                const idx = parseInt(it.index, 10);
                if (!Number.isFinite(idx) || idx < 1) {
                    return res.status(400).json({ success: false, error: `非法 index: ${it.index}` });
                }
                if (seen.has(idx)) {
                    return res.status(400).json({ success: false, error: `index ${idx} 重复` });
                }
                seen.add(idx);
            }

            // 转换为 sarPromptManager 格式
            const newPrompts = items
                .sort((a, b) => a.index - b.index)
                .map(it => ({
                    promptKey: `SarPrompt${it.index}`,
                    models: Array.isArray(it.models) ? it.models.filter(Boolean) : [],
                    content: String(it.prompt || ''),
                }));

            await sarPromptManager.updateAllPrompts(newPrompts);

            res.json({
                success: true,
                message: '已保存（无需重启，热更新生效）',
                count: newPrompts.length,
            });
        } catch (e) {
            res.status(500).json({ success: false, error: '保存失败: ' + e.message });
        }
    });

    return router;
};
