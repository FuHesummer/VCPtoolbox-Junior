#!/usr/bin/env node
/**
 * 将 config.env.example 的注释结构应用到 config.env，保留 config.env 的真实 value。
 *
 * 用法：node scripts/sync-env-structure.js
 *   - 默认写入 config.env.new 预览，需加 --apply 才覆盖原文件
 *   - 若 config.env 缺少某 key，用 .example 的默认值补齐并给出提示
 *   - 若 config.env 有 .example 没有的 key，末尾追加并给出警告
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const EXAMPLE_PATH = path.join(ROOT, 'config.env.example')
const ACTUAL_PATH = path.join(ROOT, 'config.env')
const OUTPUT_PATH = process.argv.includes('--apply') ? ACTUAL_PATH : path.join(ROOT, 'config.env.new')

/**
 * 解析 .env 文件为按行条目（含多行单引号处理）
 * 返回条目数组：每项 { kind: 'comment'|'blank'|'entry', raw, key?, valueRaw?, spanLines? }
 */
function parseEntries(content) {
    const lines = content.split(/\r?\n/)
    const entries = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()

        if (trimmed === '') {
            entries.push({ kind: 'blank', raw: line })
            i++
            continue
        }
        if (trimmed.startsWith('#')) {
            entries.push({ kind: 'comment', raw: line })
            i++
            continue
        }

        const eq = line.indexOf('=')
        if (eq === -1) {
            // 格式错误行当注释处理（不应出现在规范化后的 example 里）
            entries.push({ kind: 'comment', raw: line })
            i++
            continue
        }

        const key = line.slice(0, eq).trim()
        const rest = line.slice(eq + 1)

        // 检测多行单引号值（以 ' 开头且未在同行闭合）
        if (rest.trim().startsWith("'") && !isSingleQuotedSingleLine(rest)) {
            const rawLines = [line]
            i++
            while (i < lines.length) {
                rawLines.push(lines[i])
                if (lines[i].trim().endsWith("'")) {
                    i++
                    break
                }
                i++
            }
            entries.push({ kind: 'entry', key, raw: rawLines.join('\n'), multiline: true })
            continue
        }

        entries.push({ kind: 'entry', key, raw: line, multiline: false })
        i++
    }

    return entries
}

function isSingleQuotedSingleLine(valueRest) {
    const trimmed = valueRest.trim()
    if (!trimmed.startsWith("'")) return false
    // 单行闭合：以 ' 结尾 且 至少含两个 '
    return trimmed.endsWith("'") && trimmed.length >= 2
}

function main() {
    const exampleContent = fs.readFileSync(EXAMPLE_PATH, 'utf-8')
    const actualContent = fs.readFileSync(ACTUAL_PATH, 'utf-8')

    const exampleEntries = parseEntries(exampleContent)
    const actualEntries = parseEntries(actualContent)

    // 构建 config.env 的 key → entry 映射
    const actualMap = new Map()
    for (const e of actualEntries) {
        if (e.kind === 'entry') actualMap.set(e.key, e)
    }

    const usedKeys = new Set()
    const outputLines = []

    for (const e of exampleEntries) {
        if (e.kind !== 'entry') {
            outputLines.push(e.raw)
            continue
        }
        const actual = actualMap.get(e.key)
        if (actual) {
            outputLines.push(actual.raw)
            usedKeys.add(e.key)
        } else {
            // config.env 里没有这个 key — 用 example 的默认值并标记
            outputLines.push(e.raw)
            console.warn(`[sync-env] ⚠ config.env 缺少 key: ${e.key}（已用 .example 默认值填充）`)
        }
    }

    // 找出 config.env 里多出的 key（.example 没有）
    const extraEntries = []
    for (const e of actualEntries) {
        if (e.kind === 'entry' && !usedKeys.has(e.key)) extraEntries.push(e)
    }
    if (extraEntries.length) {
        outputLines.push('')
        outputLines.push('# ============================================================')
        outputLines.push('# [自定义扩展] 以下字段未在 config.env.example 中定义')
        outputLines.push('# ============================================================')
        outputLines.push('')
        for (const e of extraEntries) {
            outputLines.push(`# ${e.key}: （自定义 — 请补充说明）`)
            outputLines.push(e.raw)
        }
        console.warn(`[sync-env] ⚠ config.env 多出 ${extraEntries.length} 个 key（已追加到末尾）:`)
        for (const e of extraEntries) console.warn(`           - ${e.key}`)
    }

    const out = outputLines.join('\n')
    fs.writeFileSync(OUTPUT_PATH, out, 'utf-8')

    const mode = process.argv.includes('--apply') ? 'APPLIED' : 'PREVIEW'
    console.log(`✅ [sync-env] ${mode}: ${path.relative(ROOT, OUTPUT_PATH)}`)
    console.log(`   Example keys: ${exampleEntries.filter(e => e.kind === 'entry').length}`)
    console.log(`   Actual keys: ${actualEntries.filter(e => e.kind === 'entry').length}`)
    console.log(`   Matched: ${usedKeys.size}`)
    if (extraEntries.length) console.log(`   Extras appended: ${extraEntries.length}`)
    if (!process.argv.includes('--apply')) {
        console.log('\n   👉 确认无误后执行 `node scripts/sync-env-structure.js --apply` 覆盖原 config.env')
    }
}

main()
