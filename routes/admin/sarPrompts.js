// routes/admin/sarPrompts.js
// [模型专属指令] 配置管理：解析 config.env 中的 SarModelN / SarPromptN 配对
// 占位符 {{SarPromptN}} 在消息处理时按当前模型 ID 匹配注入
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config.env');

// ============================================================
// 解析：从 config.env 文本抽取 SarModelN / SarPromptN 对
// ============================================================
function parseSarPairs(envText) {
    const lines = envText.split(/\r?\n/);
    const models = new Map();   // index -> string array
    const prompts = new Map();  // index -> string

    for (const line of lines) {
        // 跳过注释
        if (/^\s*#/.test(line)) continue;

        // 匹配 SarModelN = ...
        const modelMatch = line.match(/^\s*SarModel(\d+)\s*=\s*(.*)$/);
        if (modelMatch) {
            const idx = parseInt(modelMatch[1], 10);
            const raw = stripQuotes(modelMatch[2].trim());
            const list = raw.split(',').map(s => s.trim()).filter(Boolean);
            models.set(idx, list);
            continue;
        }

        // 匹配 SarPromptN = ...
        const promptMatch = line.match(/^\s*SarPrompt(\d+)\s*=\s*(.*)$/);
        if (promptMatch) {
            const idx = parseInt(promptMatch[1], 10);
            prompts.set(idx, stripQuotes(promptMatch[2].trim()));
        }
    }

    // 合并：所有有 model 或 prompt 的 index 都纳入
    const allIndexes = new Set([...models.keys(), ...prompts.keys()]);
    const items = [];
    for (const idx of [...allIndexes].sort((a, b) => a - b)) {
        items.push({
            index: idx,
            models: models.get(idx) || [],
            prompt: prompts.get(idx) || '',
        });
    }
    return items;
}

function stripQuotes(s) {
    if (!s) return '';
    // dotenv 约定：整体被 " 或 ' 包裹时去掉
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

// ============================================================
// 写回：重新生成 Sar* 行并替换 config.env 对应区段
// 策略：找到"[模型专属指令]"注释节，用新内容替换该节内的 Sar* 行（保留注释框）
// 若找不到节 → 追加到文件末尾并加节标题
// ============================================================
function rewriteSarBlock(envText, items) {
    const lines = envText.split(/\r?\n/);

    // 找"[模型专属指令]"节开始/结束位置
    // 开始：含 "[模型专属指令]" 的行（注释行）
    // 结束：下一个 "# ============================================================\n# [..." 节 或 文件末尾
    let sectionStart = -1;
    let sectionEnd = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('[模型专属指令]')) {
            sectionStart = i;
            // 向上找该节的 ==== 框上沿（通常是前一行）
            while (sectionStart > 0 && /^#\s*=+/.test(lines[sectionStart - 1])) {
                sectionStart--;
            }
            break;
        }
    }

    if (sectionStart === -1) {
        // 没找到节 → 附加到末尾
        const appended = envText.trimEnd() + '\n\n' + buildSarSection(items) + '\n';
        return appended;
    }

    // 向下找结束：下一个 "# ===" 节的 ==== 框上沿（非当前节）
    for (let i = sectionStart + 1; i < lines.length; i++) {
        // 跳过紧跟在 sectionStart 之后的 ====、[xxx]、"SarModelN 指定模型 ID..."等注释
        if (/^#\s*=+/.test(lines[i]) && i > sectionStart + 2) {
            sectionEnd = i;
            break;
        }
    }
    if (sectionEnd === -1) sectionEnd = lines.length;

    // 替换 [sectionStart, sectionEnd) 区间为新内容
    const newBlock = buildSarSection(items);
    const before = lines.slice(0, sectionStart).join('\n');
    const after = lines.slice(sectionEnd).join('\n');

    return (before ? before + '\n' : '') + newBlock + '\n\n' + after;
}

function buildSarSection(items) {
    const lines = [];
    lines.push('# ============================================================');
    lines.push('# [模型专属指令] 为不同 AI 模型定制不同的行为');
    lines.push('# ============================================================');
    lines.push('# SarModelN 指定模型 ID（逗号分隔），SarPromptN 定义该模型匹配时追加的指令');
    lines.push('# 在 system prompt 里写 {{SarPromptN}} 占位符，运行时按模型匹配注入。');
    lines.push('');

    // 按 index 升序
    const sorted = [...items].sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const item of sorted) {
        const idx = parseInt(item.index, 10);
        if (!Number.isFinite(idx) || idx < 1) continue;
        const models = Array.isArray(item.models) ? item.models.filter(Boolean) : [];
        const prompt = String(item.prompt || '');
        lines.push(`# SarModel${idx}: 模型匹配列表 ${idx}`);
        lines.push(`SarModel${idx}=${models.join(',')}`);
        lines.push(`# SarPrompt${idx}: 匹配 SarModel${idx} 时追加的系统提示词`);
        lines.push(`SarPrompt${idx}=${quoteValue(prompt)}`);
    }
    return lines.join('\n');
}

// 值包装：含空格/特殊字符用双引号包裹
// 若内容含双引号则转成中文引号，避免破坏 dotenv 解析
function quoteValue(v) {
    if (!v) return '';
    const safe = v.replace(/"/g, '\u201d');  // " → ” (防 dotenv 解析破坏)
    return `"${safe}"`;
}

// ============================================================
// Router
// ============================================================
module.exports = function (options) {
    const { pluginManager, triggerRestart } = options || {};
    const router = express.Router();

    // GET /sar-prompts → 当前所有配对
    router.get('/sar-prompts', async (req, res) => {
        try {
            const envText = await fs.readFile(CONFIG_PATH, 'utf-8');
            const items = parseSarPairs(envText);
            res.json({ success: true, items });
        } catch (e) {
            res.status(500).json({ success: false, error: '读取 config.env 失败: ' + e.message });
        }
    });

    // POST /sar-prompts → 整体保存（writeFile-style：body.items 为完整列表）
    // 可选 query: ?restart=1 保存后触发主服务重启让新配置生效
    router.post('/sar-prompts', async (req, res) => {
        try {
            const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
            if (!items) {
                return res.status(400).json({ success: false, error: 'body 需包含 items 数组' });
            }
            // 基础校验
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
                if (!Array.isArray(it.models)) {
                    return res.status(400).json({ success: false, error: `index ${idx} 的 models 必须是数组` });
                }
                if (typeof it.prompt !== 'string') {
                    return res.status(400).json({ success: false, error: `index ${idx} 的 prompt 必须是字符串` });
                }
            }

            // 读旧 → 改 → 写新
            const oldText = await fs.readFile(CONFIG_PATH, 'utf-8');
            const newText = rewriteSarBlock(oldText, items);
            await fs.writeFile(CONFIG_PATH, newText, 'utf-8');

            // 可选：通知主服务重启让新 Sar* 配置生效
            const shouldRestart = String(req.query.restart || '').toLowerCase() === '1' ||
                                  String(req.query.restart || '').toLowerCase() === 'true';
            if (shouldRestart && typeof triggerRestart === 'function') {
                setTimeout(() => triggerRestart(1), 500);
            }

            res.json({
                success: true,
                message: shouldRestart ? '已保存，主服务将在 500ms 后重启' : '已保存，重启主服务后新配置生效',
                count: items.length,
            });
        } catch (e) {
            res.status(500).json({ success: false, error: '保存失败: ' + e.message });
        }
    });

    return router;
};
