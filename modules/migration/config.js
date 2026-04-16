// modules/migration/config.js
// config.env 字段级 diff + merge
// 解析 KEY=value 保留注释/空行；产出 diff 供前端决策；apply 时保留原文布局
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT } = require('./utils');

const JUNIOR_ENV = path.join(PROJECT_ROOT, 'config.env');
const JUNIOR_ENV_EXAMPLE = path.join(PROJECT_ROOT, 'config.env.example');

// 简单解析 env 文本：key → { value, lineNum }（仅记录最后一次）
function parseEnv(text) {
    const map = {};
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m) {
            map[m[1]] = {
                value: m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'),
                lineNum: i + 1,
                rawLine: line,
            };
        }
    }
    return map;
}

/**
 * 产出 diff：
 * - addedFromSource：仅上游有（建议新增）
 * - conflicts：两边都有但值不同
 * - sameValue：两边都有且值相等
 * - juniorOnly：仅 Junior 有（保留，不在 UI 展示）
 */
async function diffConfigEnv(sourceRoot) {
    // 优先 config.env，fallback 到 config.env.example（仓库 clone 场景常见）
    let sourceEnvPath = path.join(sourceRoot, 'config.env');
    let usedExample = false;
    if (!fs.existsSync(sourceEnvPath)) {
        sourceEnvPath = path.join(sourceRoot, 'config.env.example');
        usedExample = true;
    }
    if (!fs.existsSync(sourceEnvPath)) {
        return { available: false, reason: '上游 config.env / config.env.example 均不存在' };
    }
    const srcText = await fsp.readFile(sourceEnvPath, 'utf8');
    const juniorPath = fs.existsSync(JUNIOR_ENV) ? JUNIOR_ENV : JUNIOR_ENV_EXAMPLE;
    const junText = fs.existsSync(juniorPath) ? await fsp.readFile(juniorPath, 'utf8') : '';

    const srcMap = parseEnv(srcText);
    const junMap = parseEnv(junText);

    const addedFromSource = [];
    const conflicts = [];
    const sameValue = [];
    const juniorOnly = [];

    for (const key of Object.keys(srcMap)) {
        if (!(key in junMap)) {
            addedFromSource.push({
                key,
                sourceValue: srcMap[key].value,
                sourceLineNum: srcMap[key].lineNum,
            });
        } else if (srcMap[key].value !== junMap[key].value) {
            conflicts.push({
                key,
                sourceValue: srcMap[key].value,
                juniorValue: junMap[key].value,
                sourceLineNum: srcMap[key].lineNum,
                juniorLineNum: junMap[key].lineNum,
            });
        } else {
            sameValue.push({ key, value: srcMap[key].value });
        }
    }
    for (const key of Object.keys(junMap)) {
        if (!(key in srcMap)) {
            juniorOnly.push({ key, juniorValue: junMap[key].value });
        }
    }

    return {
        available: true,
        sourceFile: path.basename(sourceEnvPath),
        sourceUsedExample: usedExample,
        juniorSource: path.relative(PROJECT_ROOT, juniorPath),
        addedFromSource,
        conflicts,
        sameValue,
        juniorOnly,
        summary: {
            add: addedFromSource.length,
            conflict: conflicts.length,
            same: sameValue.length,
            juniorOnly: juniorOnly.length,
        },
    };
}

/**
 * 应用 merge decisions
 * decisions = {
 *   add: { KEY: true | false }  // true = 写入；false = 跳过
 *   conflicts: { KEY: 'use_upstream' | 'use_junior' | { custom: '...' } }
 * }
 * 策略：以 Junior config.env 原文为底，保留注释/空行/布局
 * - conflict 选 use_upstream：替换原有行的值
 * - conflict 选 use_junior：不动
 * - conflict 选 custom：替换为自定义值
 * - add=true：追加到文件末尾（带一行注释 # [migrated from upstream]）
 */
async function applyMerge(sourceRoot, decisions, emitter) {
    const sourceEnvPath = path.join(sourceRoot, 'config.env');
    const srcText = await fsp.readFile(sourceEnvPath, 'utf8');
    const srcMap = parseEnv(srcText);

    // Junior 底本：优先 config.env，不存在则用 example 作为起点
    let juniorText;
    let usedExample = false;
    if (fs.existsSync(JUNIOR_ENV)) {
        juniorText = await fsp.readFile(JUNIOR_ENV, 'utf8');
    } else if (fs.existsSync(JUNIOR_ENV_EXAMPLE)) {
        juniorText = await fsp.readFile(JUNIOR_ENV_EXAMPLE, 'utf8');
        usedExample = true;
    } else {
        juniorText = '';
    }

    const junMap = parseEnv(juniorText);
    const lines = juniorText.split(/\r?\n/);

    const applied = { replaced: [], added: [], skipped: [] };

    // 1. 处理 conflicts（就地替换）
    const conflictDecisions = decisions.conflicts || {};
    for (const key of Object.keys(conflictDecisions)) {
        const dec = conflictDecisions[key];
        if (!junMap[key]) continue;
        if (dec === 'use_junior') {
            applied.skipped.push({ key, reason: 'keep junior' });
            continue;
        }
        let newValue;
        if (dec === 'use_upstream') {
            newValue = srcMap[key]?.value ?? '';
        } else if (dec && typeof dec === 'object' && 'custom' in dec) {
            newValue = dec.custom;
        } else {
            applied.skipped.push({ key, reason: 'unknown decision' });
            continue;
        }
        const idx = junMap[key].lineNum - 1;
        lines[idx] = rewriteLine(lines[idx], key, newValue);
        applied.replaced.push({ key, newValue });
    }

    // 2. 处理 add（追加到末尾）
    const addDecisions = decisions.add || {};
    const toAdd = Object.keys(addDecisions).filter(k => addDecisions[k] === true);
    if (toAdd.length > 0) {
        if (lines[lines.length - 1] !== '') lines.push('');
        lines.push('# ===== migrated from upstream =====');
        for (const key of toAdd) {
            if (!srcMap[key]) continue;
            lines.push(`${key}=${quoteValue(srcMap[key].value)}`);
            applied.added.push({ key, value: srcMap[key].value });
        }
        lines.push('');
    }

    // 写回 config.env
    const outText = lines.join('\n');
    await fsp.writeFile(JUNIOR_ENV, outText, 'utf8');

    emit(emitter, 'progress', 'config',
        `config.env merge 完成（替换 ${applied.replaced.length}，新增 ${applied.added.length}，跳过 ${applied.skipped.length}）${usedExample ? '（基于 example 生成）' : ''}`);

    return { ...applied, outputPath: JUNIOR_ENV, usedExample };
}

// 重写一行 KEY=... 的值，保留原有引号风格（如果原值被引号包）
function rewriteLine(originalLine, key, newValue) {
    const m = originalLine.match(/^(\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(["']?)(.*?)\2\s*$/);
    if (m) {
        return `${m[1]}${m[2]}${newValue}${m[2]}`;
    }
    return `${key}=${quoteValue(newValue)}`;
}

// 如果值含空格/特殊字符，用引号包起来（中文双引号避开 dotenv 转义问题）
function quoteValue(v) {
    if (v === '' || /^[A-Za-z0-9_\-.\/:@]+$/.test(v)) return v;
    // 替换英文 " 为中文 "（与 Junior Sar* 节一致的处理）
    const safe = String(v).replace(/"/g, '"');
    return `"${safe}"`;
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = { diffConfigEnv, applyMerge, parseEnv };
