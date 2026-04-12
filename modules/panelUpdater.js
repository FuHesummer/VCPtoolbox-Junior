/**
 * panelUpdater.js
 * AdminPanel 自动更新器
 *
 * 从 GitHub Releases 拉取最新的管理面板资源到本地 AdminPanel/ 目录。
 * 支持：版本检查、增量更新、离线模式（本地已有则直接用）。
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const PANEL_REPO = 'FuHesummer/VCPtoolbox-Junior-Panel';
const RELEASE_API_URL = `https://api.github.com/repos/${PANEL_REPO}/releases/latest`;
const PANEL_DIR = path.join(__dirname, '..', 'AdminPanel');
const VERSION_FILE = path.join(PANEL_DIR, '.panel-version');
const UPDATE_CHECK_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours

let lastCheckTime = 0;

/**
 * Ensure AdminPanel directory exists with latest version
 * @param {object} options - { force: false, silent: false }
 */
async function ensurePanel(options = {}) {
    const { force = false, silent = false } = options;

    // Check if panel already exists
    const panelExists = fsSync.existsSync(path.join(PANEL_DIR, 'index.html'));

    if (panelExists && !force) {
        // Panel exists, check for updates in background (non-blocking)
        const now = Date.now();
        if (now - lastCheckTime > UPDATE_CHECK_INTERVAL) {
            lastCheckTime = now;
            checkForUpdate(silent).catch(err => {
                if (!silent) console.warn('[PanelUpdater] Background update check failed:', err.message);
            });
        }
        return true;
    }

    // Panel doesn't exist, must download
    if (!silent) console.log('[PanelUpdater] AdminPanel not found locally, downloading...');
    try {
        await downloadLatestRelease(silent);
        return true;
    } catch (err) {
        console.error('[PanelUpdater] Failed to download AdminPanel:', err.message);
        return false;
    }
}

/**
 * Check if a newer version is available and update if so
 */
async function checkForUpdate(silent = false) {
    try {
        const currentVersion = await getCurrentVersion();
        const latestRelease = await fetchLatestRelease();

        if (!latestRelease || !latestRelease.tag_name) return;

        if (currentVersion === latestRelease.tag_name) {
            if (!silent) console.log(`[PanelUpdater] Panel is up to date (${currentVersion})`);
            return;
        }

        if (!silent) console.log(`[PanelUpdater] New version available: ${latestRelease.tag_name} (current: ${currentVersion || 'none'})`);
        await downloadRelease(latestRelease, silent);
    } catch (err) {
        if (!silent) console.warn('[PanelUpdater] Update check failed:', err.message);
    }
}

/**
 * Download the latest release
 */
async function downloadLatestRelease(silent = false) {
    const release = await fetchLatestRelease();
    if (!release) throw new Error('Could not fetch latest release info');
    await downloadRelease(release, silent);
}

/**
 * Download and extract a specific release
 */
async function downloadRelease(release, silent = false) {
    // Find the zip asset
    const zipAsset = release.assets?.find(a => a.name.endsWith('.zip'));
    if (!zipAsset) {
        throw new Error(`No zip asset found in release ${release.tag_name}`);
    }

    if (!silent) console.log(`[PanelUpdater] Downloading ${zipAsset.name} (${(zipAsset.size / 1024 / 1024).toFixed(1)}MB)...`);

    const zipBuffer = await downloadFile(zipAsset.browser_download_url);

    // Extract zip to AdminPanel/
    await fs.mkdir(PANEL_DIR, { recursive: true });

    // Use Node.js built-in or PowerShell to extract
    const tempZipPath = path.join(PANEL_DIR, '_temp_panel.zip');
    await fs.writeFile(tempZipPath, zipBuffer);

    try {
        const { execSync } = require('child_process');
        if (process.platform === 'win32') {
            execSync(`powershell -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${PANEL_DIR}' -Force"`, { stdio: 'pipe' });
        } else {
            execSync(`unzip -o "${tempZipPath}" -d "${PANEL_DIR}"`, { stdio: 'pipe' });
        }
    } finally {
        await fs.unlink(tempZipPath).catch(() => {});
    }

    // Save version info
    await fs.writeFile(VERSION_FILE, release.tag_name, 'utf-8');
    if (!silent) console.log(`[PanelUpdater] AdminPanel ${release.tag_name} installed successfully.`);
}

/**
 * Fetch latest release info from GitHub API
 */
function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'VCPtoolbox-Junior-PanelUpdater',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        https.get(RELEASE_API_URL, options, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // Follow redirect
                https.get(res.headers.location, options, (res2) => {
                    collectBody(res2).then(body => resolve(JSON.parse(body))).catch(reject);
                }).on('error', reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`GitHub API returned ${res.statusCode}`));
                return;
            }
            collectBody(res).then(body => resolve(JSON.parse(body))).catch(reject);
        }).on('error', reject);
    });
}

/**
 * Download a file following redirects
 */
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const options = {
            headers: {
                'User-Agent': 'VCPtoolbox-Junior-PanelUpdater',
                'Accept': 'application/octet-stream'
            }
        };

        client.get(url, options, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                downloadFile(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Download failed with status ${res.statusCode}`));
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Get current installed version
 */
async function getCurrentVersion() {
    try {
        return (await fs.readFile(VERSION_FILE, 'utf-8')).trim();
    } catch {
        return null;
    }
}

/**
 * Collect response body as string
 */
function collectBody(res) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
    });
}

module.exports = { ensurePanel, checkForUpdate, downloadLatestRelease };
