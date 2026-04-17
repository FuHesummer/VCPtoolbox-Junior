/**
 * updateChecker.js
 * Unified update check endpoint for both backend and panel.
 * Uses raw.githubusercontent.com (no API quota) + GH_PROXY support.
 */
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKEND_REPO = 'FuHesummer/VCPtoolbox-Junior';
const PANEL_REPO = 'FuHesummer/VCPtoolbox-Junior-Panel';

const VCP_ROOT = process.env.VCP_ROOT || path.join(__dirname, '..', '..');
const PANEL_DIR = path.join(VCP_ROOT, 'AdminPanel');
const PANEL_VERSION_FILE = path.join(PANEL_DIR, '.panel-version');

// In-memory cache: check at most once every 30 min
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'VCPtoolbox-Junior-UpdateChecker' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                fetchUrl(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function buildUrl(repo, filePath) {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${filePath}`;
    const ghProxy = process.env.GH_PROXY || '';
    return ghProxy ? `${ghProxy}/${rawUrl}` : rawUrl;
}

function getLocalBackendVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(VCP_ROOT, 'package.json'), 'utf-8'));
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function getLocalPanelVersion() {
    try {
        const data = JSON.parse(fs.readFileSync(PANEL_VERSION_FILE, 'utf-8'));
        return data.tag || data.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

// Fetch latest GitHub release tag for a repo (uses API, cached)
async function fetchLatestRelease(repo) {
    const ghProxy = process.env.GH_PROXY || '';
    // Try GitHub API first (works better for release tags)
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const url = ghProxy ? `${ghProxy}/${apiUrl}` : apiUrl;
    try {
        const data = JSON.parse(await fetchUrl(url));
        return { tag: data.tag_name, name: data.name, url: data.html_url, publishedAt: data.published_at };
    } catch {
        // Fallback: fetch package.json from main branch
        try {
            const pkgData = JSON.parse(await fetchUrl(buildUrl(repo, 'package.json')));
            return { tag: `v${pkgData.version}`, name: pkgData.version, url: `https://github.com/${repo}`, publishedAt: null };
        } catch {
            return null;
        }
    }
}

async function checkUpdates() {
    const now = Date.now();
    if (cache && (now - cacheTime) < CACHE_TTL) return cache;

    const localBackend = getLocalBackendVersion();
    const localPanel = getLocalPanelVersion();

    const [backendRelease, panelRelease] = await Promise.allSettled([
        fetchLatestRelease(BACKEND_REPO),
        fetchLatestRelease(PANEL_REPO)
    ]);

    const backend = backendRelease.status === 'fulfilled' ? backendRelease.value : null;
    const panel = panelRelease.status === 'fulfilled' ? panelRelease.value : null;

    const result = {
        backend: {
            current: localBackend,
            latest: backend ? backend.tag : null,
            name: backend ? backend.name : null,
            updateAvailable: backend ? (backend.tag !== `v${localBackend}` && backend.tag !== localBackend) : false,
            releaseUrl: backend ? backend.url : null,
            publishedAt: backend ? backend.publishedAt : null
        },
        panel: {
            current: localPanel,
            latest: panel ? panel.tag : null,
            name: panel ? panel.name : null,
            updateAvailable: panel ? (panel.tag !== localPanel) : false,
            releaseUrl: panel ? panel.url : null,
            publishedAt: panel ? panel.publishedAt : null
        },
        checkedAt: new Date().toISOString()
    };

    cache = result;
    cacheTime = now;
    return result;
}

module.exports = function () {
    const router = express.Router();

    router.get('/check-updates', async (req, res) => {
        try {
            const result = await checkUpdates();
            res.json(result);
        } catch (err) {
            console.error('[UpdateChecker] Error:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // Force refresh (ignore cache)
    router.post('/check-updates', async (req, res) => {
        try {
            cache = null;
            cacheTime = 0;
            const result = await checkUpdates();
            res.json(result);
        } catch (err) {
            console.error('[UpdateChecker] Error:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // Execute backend update: download latest release + restart
    router.post('/execute-update', async (req, res) => {
        const { spawn } = require('child_process');
        const scriptPath = path.join(VCP_ROOT, 'scripts', 'install.sh');
        const hasScript = fs.existsSync(scriptPath);

        // SSE stream for progress
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

        try {
            // Strategy 1: install.sh exists (Linux deploy) → run update mode
            if (hasScript) {
                send({ step: 'start', message: 'Running install.sh update...' });
                const proc = spawn('bash', [scriptPath, '--update'], {
                    cwd: VCP_ROOT,
                    env: { ...process.env, NONINTERACTIVE: '1' }
                });
                proc.stdout.on('data', d => send({ step: 'progress', message: d.toString().trim() }));
                proc.stderr.on('data', d => send({ step: 'progress', message: d.toString().trim() }));
                proc.on('close', code => {
                    send({ step: code === 0 ? 'done' : 'error', message: code === 0 ? 'Update complete. Restart required.' : `Exit code ${code}` });
                    res.end();
                });
                return;
            }

            // Strategy 2: No install.sh → download latest release asset via GitHub API
            send({ step: 'start', message: 'Downloading latest release...' });
            const releaseInfo = await fetchLatestRelease(BACKEND_REPO);
            if (!releaseInfo) {
                send({ step: 'error', message: 'Failed to fetch release info' });
                res.end();
                return;
            }

            send({ step: 'progress', message: `Latest: ${releaseInfo.tag} — ${releaseInfo.name || ''}` });
            send({ step: 'done', message: `Found ${releaseInfo.tag}. Use install.sh or Docker to update. Release: ${releaseInfo.url}` });
            res.end();
        } catch (err) {
            send({ step: 'error', message: err.message });
            res.end();
        }
    });

    return router;
};
