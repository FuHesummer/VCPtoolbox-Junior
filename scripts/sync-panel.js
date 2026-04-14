#!/usr/bin/env node
/**
 * AdminPanel-Vue 源码同步脚本
 *
 * 用途：把主仓库 AdminPanel-Vue/ 的源码同步到 Panel 仓库 AdminPanel-Vue/
 * 不同步：node_modules/ / dist/ / *.log / .DS_Store
 *
 * 用法：
 *   node scripts/sync-panel.js                              # 默认路径 ../VCPtoolbox-Junior-Panel
 *   node scripts/sync-panel.js D:/path/to/Panel/repo        # 指定 Panel 仓库路径
 *   node scripts/sync-panel.js --dry-run                    # 只打印要做的操作，不实际写文件
 *
 * 同步策略（镜像）：
 *   1. 目标存在但源不存在 → 删除目标
 *   2. 源存在但目标不存在 → 复制源到目标
 *   3. 两边都存在但内容不同 → 覆盖目标
 *   4. 两边都存在且内容相同 → 跳过
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'AdminPanel-Vue');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const panelArg = args.find(a => !a.startsWith('--'));
const PANEL_REPO = panelArg
    ? path.resolve(panelArg)
    : path.resolve(ROOT, '..', 'VCPtoolbox-Junior-Panel');
const DST_DIR = path.join(PANEL_REPO, 'AdminPanel-Vue');

// 排除清单（glob 简版 — 前缀匹配）
const EXCLUDES = [
    'node_modules',
    'dist',
    'dist-ssr',
    '.vite',
    'coverage',
    '.nyc_output',
    '.tsbuildinfo',
    '*.log',
    '.DS_Store',
    '.env.local',
];

function isExcluded(relPath) {
    const name = path.basename(relPath);
    return EXCLUDES.some((ex) => {
        if (ex.startsWith('*.')) return name.endsWith(ex.slice(1));
        return name === ex || relPath.split(path.sep).includes(ex);
    });
}

function walk(dir, baseDir = dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(baseDir, full);
        if (isExcluded(rel)) continue;
        if (entry.isDirectory()) {
            out.push({ rel, full, isDir: true });
            out.push(...walk(full, baseDir));
        } else if (entry.isFile()) {
            out.push({ rel, full, isDir: false });
        }
    }
    return out;
}

function filesEqual(a, b) {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function main() {
    console.log(`源: ${SRC_DIR}`);
    console.log(`目标: ${DST_DIR}`);
    console.log(dryRun ? '[dry-run]' : '[real-run]');

    if (!fs.existsSync(SRC_DIR)) {
        console.error(`❌ 源目录不存在: ${SRC_DIR}`);
        process.exit(1);
    }
    if (!fs.existsSync(PANEL_REPO)) {
        console.error(`❌ Panel 仓库不存在: ${PANEL_REPO}`);
        console.error('   请 clone VCPtoolbox-Junior-Panel 到该路径，或用参数指定');
        process.exit(1);
    }

    ensureDir(DST_DIR);

    const srcList = walk(SRC_DIR);
    const dstList = walk(DST_DIR);
    const srcMap = new Map(srcList.map((e) => [e.rel, e]));
    const dstMap = new Map(dstList.map((e) => [e.rel, e]));

    let copied = 0, updated = 0, deleted = 0, skipped = 0;

    // 1. src 有 → 复制或更新
    for (const { rel, full, isDir } of srcList) {
        const target = path.join(DST_DIR, rel);
        if (isDir) {
            if (!fs.existsSync(target)) {
                if (!dryRun) ensureDir(target);
                console.log(`  + DIR  ${rel}`);
            }
            continue;
        }
        if (!fs.existsSync(target)) {
            if (!dryRun) {
                ensureDir(path.dirname(target));
                fs.copyFileSync(full, target);
            }
            console.log(`  + ADD  ${rel}`);
            copied++;
        } else if (!filesEqual(full, target)) {
            if (!dryRun) fs.copyFileSync(full, target);
            console.log(`  * UPD  ${rel}`);
            updated++;
        } else {
            skipped++;
        }
    }

    // 2. dst 有但 src 没 → 删除
    for (const { rel, full, isDir } of dstList) {
        if (srcMap.has(rel)) continue;
        if (!dryRun) {
            if (isDir) {
                if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
            } else {
                fs.unlinkSync(full);
            }
        }
        console.log(`  - DEL  ${rel}`);
        deleted++;
    }

    console.log('');
    console.log(`✅ 同步完成: +${copied} 新增  *${updated} 更新  -${deleted} 删除  (跳过 ${skipped})`);
    if (dryRun) console.log('(dry-run 模式，未实际写入)');
}

main();
