/**
 * placeholderRegistry route
 *
 * 暴露 /admin_api/placeholder-registry 端点，返回 VCPtoolbox-Junior-Plugins 仓库
 * 维护的「占位符 → 插件」映射表，AdminPanel PromptEditor 用它识别未装插件
 * 提供的占位符，给用户友好提示「此变量来自 XXX 插件」+ 一键安装修复。
 *
 * 数据源优先级：
 *   1. Plugin/.placeholder-registry-cache.json — 本地缓存（24h TTL）
 *   2. raw.githubusercontent.com/<REPO>/main/placeholder-registry.json — 远程拉取
 *   3. data/placeholder-registry-cache.json — 过期缓存兜底（离线场景）
 *
 * 提供两个端点：
 *   GET  /placeholder-registry          — 返回 registry（走缓存）
 *   POST /placeholder-registry/refresh  — 强制从远程拉取新副本
 */
const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const https = require('https');

const DEFAULT_REPO = 'FuHesummer/VCPtoolbox-Junior-Plugins';
const REPO = process.env.PLUGIN_STORE_REPO || DEFAULT_REPO;
const VCP_ROOT = process.env.VCP_ROOT || path.join(__dirname, '..', '..');
const CACHE_FILE = path.join(VCP_ROOT, 'data', 'placeholder-registry-cache.json');
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4h

let memCache = null;
let memCacheTime = 0;

function fetchRemote() {
    return new Promise((resolve, reject) => {
        const url = `https://raw.githubusercontent.com/${REPO}/main/placeholder-registry.json`;
        const req = https.get(url, { headers: { 'User-Agent': 'VCPtoolbox-Junior-PlaceholderRegistry' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                https.get(res.headers.location, (res2) => {
                    collectJson(res2).then(resolve).catch(reject);
                }).on('error', reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Remote registry fetch ${res.statusCode}`));
                return;
            }
            collectJson(res).then(resolve).catch(reject);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(new Error('Registry fetch timeout')); });
    });
}

function collectJson(res) {
    return new Promise((resolve, reject) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
        res.on('error', reject);
    });
}

async function readCacheFile() {
    try {
        const content = await fsp.readFile(CACHE_FILE, 'utf-8');
        return JSON.parse(content);
    } catch { return null; }
}

async function writeCacheFile(data) {
    try {
        await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
        await fsp.writeFile(CACHE_FILE, JSON.stringify(data), 'utf-8');
    } catch (e) {
        console.warn(`[placeholderRegistry] 缓存写入失败: ${e.message}`);
    }
}

/**
 * 开发环境辅助：检测本体仓库相邻位置是否有插件仓库（sibling 目录），
 * 有则直接读其 placeholder-registry.json。适用于 push 前本地开发场景。
 */
async function readSiblingRepo() {
    const candidates = [
        path.join(VCP_ROOT, '..', 'VCPtoolbox-Junior-Plugins', 'placeholder-registry.json'),
        path.join(VCP_ROOT, '..', 'VCPtoolbox-junior-plugins', 'placeholder-registry.json'),
    ];
    for (const p of candidates) {
        try {
            const content = await fsp.readFile(p, 'utf-8');
            return JSON.parse(content);
        } catch { /* 继续下一个候选 */ }
    }
    return null;
}

async function getRegistry({ forceRefresh = false } = {}) {
    const now = Date.now();

    // 1. 内存缓存
    if (!forceRefresh && memCache && (now - memCacheTime) < CACHE_TTL) {
        return { registry: memCache, source: 'memory' };
    }

    // 2. 开发环境：相邻插件仓库副本（最新，无需等远程 push）
    // forceRefresh=true 时仍然优先走 sibling-repo —— 因为本地刚 regenerate 的数据比远程更新
    const sibling = await readSiblingRepo();
    if (sibling) {
        memCache = sibling;
        memCacheTime = now;
        return { registry: sibling, source: 'sibling-repo' };
    }

    // 3. 文件缓存（新鲜的话直接用）
    if (!forceRefresh) {
        try {
            const stat = await fsp.stat(CACHE_FILE);
            if ((now - stat.mtimeMs) < CACHE_TTL) {
                const data = await readCacheFile();
                if (data) {
                    memCache = data;
                    memCacheTime = now;
                    return { registry: data, source: 'file-fresh' };
                }
            }
        } catch { /* 无文件，继续 */ }
    }

    // 4. 远程拉取
    try {
        const remote = await fetchRemote();
        memCache = remote;
        memCacheTime = now;
        await writeCacheFile(remote);
        return { registry: remote, source: 'remote' };
    } catch (remoteErr) {
        // 5. 远程失败 → 退回过期文件缓存
        const stale = await readCacheFile();
        if (stale) {
            memCache = stale;
            memCacheTime = now;
            return { registry: stale, source: 'file-stale', warning: remoteErr.message };
        }
        throw remoteErr;
    }
}

module.exports = function() {
    const router = express.Router();

    // GET /placeholder-registry — 返回 registry（走缓存）
    router.get('/placeholder-registry', async (req, res) => {
        try {
            const result = await getRegistry();
            res.json({
                success: true,
                source: result.source,
                warning: result.warning || null,
                data: result.registry,
            });
        } catch (error) {
            res.status(503).json({
                success: false,
                error: error.message,
                hint: '无法获取 placeholder-registry。请检查网络或运行插件仓库的 scripts/build-placeholder-registry.js 生成本地副本后重试。',
            });
        }
    });

    // POST /placeholder-registry/refresh — 强制拉新
    router.post('/placeholder-registry/refresh', async (req, res) => {
        try {
            const result = await getRegistry({ forceRefresh: true });
            res.json({
                success: true,
                source: result.source,
                pluginCount: Object.keys(result.registry?.plugins || {}).length,
                patternRuleCount: (result.registry?.patternRules || []).length,
                version: result.registry?.version || null,
                generatedAt: result.registry?.generatedAt || null,
            });
        } catch (error) {
            res.status(503).json({ success: false, error: error.message });
        }
    });

    return router;
};
