/**
 * pluginStore.js
 * 插件商店 - 负责从远程仓库下载、检测和更新插件
 *
 * 功能：
 * 1. 获取远程插件列表
 * 2. 下载/安装插件到 Plugin/
 * 3. 检测已安装插件是否需要更新
 * 4. 卸载插件
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_REPO = 'FuHesummer/VCPtoolbox-Junior-Plugins';
const REPO = process.env.PLUGIN_STORE_REPO || DEFAULT_REPO;
const PLUGIN_DIR = path.join(__dirname, '..', 'Plugin');
const STORE_CACHE_FILE = path.join(PLUGIN_DIR, '.store-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Get remote plugin list from GitHub repo
 * @returns {Promise<Array>} List of available plugins with metadata
 */
async function listRemote() {
    // Check cache first
    const cached = await readCache();
    if (cached) return cached;

    const contents = await githubApi(`/repos/${REPO}/contents`);
    if (!Array.isArray(contents)) {
        throw new Error('Failed to fetch plugin list from remote');
    }

    const plugins = [];
    for (const item of contents) {
        if (item.type !== 'dir') continue;
        if (item.name === '.github' || item.name.startsWith('.')) continue;

        // Try to fetch manifest
        let manifest = null;
        try {
            manifest = await fetchManifest(item.name);
        } catch {
            // No manifest, skip
            continue;
        }

        plugins.push({
            name: item.name,
            displayName: manifest.displayName || item.name,
            version: manifest.version || '0.0.0',
            description: manifest.description || '',
            pluginType: manifest.pluginType || 'unknown',
            sha: item.sha
        });
    }

    // Save cache
    await writeCache(plugins);
    return plugins;
}

/**
 * Get list of locally installed plugins with version info
 * @returns {Promise<Array>}
 */
async function listInstalled() {
    const installed = [];
    try {
        const dirs = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            const manifestPath = path.join(PLUGIN_DIR, dir.name, 'plugin-manifest.json');
            const blockedPath = manifestPath + '.block';

            let manifest = null;
            try {
                const content = await fs.readFile(manifestPath, 'utf-8');
                manifest = JSON.parse(content);
            } catch {
                try {
                    const content = await fs.readFile(blockedPath, 'utf-8');
                    manifest = JSON.parse(content);
                } catch { continue; }
            }

            installed.push({
                name: dir.name,
                displayName: manifest.displayName || manifest.name || dir.name,
                version: manifest.version || '0.0.0',
                pluginType: manifest.pluginType || 'unknown',
                enabled: fsSync.existsSync(manifestPath)
            });
        }
    } catch { /* Plugin dir might not exist */ }
    return installed;
}

/**
 * Check which installed plugins have updates available
 * @returns {Promise<Array>} Plugins with available updates
 */
async function checkUpdates() {
    const [remote, local] = await Promise.all([listRemote(), listInstalled()]);
    const updates = [];

    for (const installed of local) {
        const remotePlugin = remote.find(r => r.name === installed.name);
        if (!remotePlugin) continue;

        if (compareVersions(remotePlugin.version, installed.version) > 0) {
            updates.push({
                name: installed.name,
                currentVersion: installed.version,
                latestVersion: remotePlugin.version,
                displayName: installed.displayName
            });
        }
    }

    return updates;
}

// Files that should never be overwritten during update (user data)
const PROTECTED_FILES = ['config.env', 'state/', 'data/', 'cache/'];

/**
 * Download and install a plugin from remote
 * @param {string} pluginName - Plugin directory name
 * @param {object} options - { force: false }
 * @returns {Promise<{success: boolean, message: string, configChanges: Array|null}>}
 */
async function install(pluginName, options = {}) {
    const { force = false } = options;
    const targetDir = path.join(PLUGIN_DIR, pluginName);
    const isUpdate = fsSync.existsSync(targetDir);

    // Check if already installed (and not forcing)
    if (isUpdate && !force) {
        return { success: false, message: `Plugin '${pluginName}' already installed. Use force=true to update.` };
    }

    // Read existing config.env before update (to preserve it)
    let existingConfig = null;
    const configPath = path.join(targetDir, 'config.env');
    if (isUpdate) {
        try {
            existingConfig = await fs.readFile(configPath, 'utf-8');
        } catch { /* no existing config */ }
    }

    // Get file tree from GitHub
    const tree = await githubApi(`/repos/${REPO}/git/trees/main?recursive=1`);
    if (!tree || !tree.tree) {
        throw new Error('Failed to fetch repository tree');
    }

    // Filter files for this plugin
    const prefix = `${pluginName}/`;
    const pluginFiles = tree.tree.filter(f => f.path.startsWith(prefix) && f.type === 'blob');

    if (pluginFiles.length === 0) {
        return { success: false, message: `Plugin '${pluginName}' not found in remote store.` };
    }

    // Create plugin directory
    await fs.mkdir(targetDir, { recursive: true });

    // Download each file
    let downloaded = 0;
    let newExampleConfig = null;

    for (const file of pluginFiles) {
        const relativePath = file.path.substring(prefix.length);
        const destPath = path.join(targetDir, relativePath);

        // Skip protected files during updates
        if (isUpdate && isProtectedFile(relativePath)) {
            continue;
        }

        // Create subdirectories
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        // Download file content
        const blob = await githubApi(`/repos/${REPO}/git/blobs/${file.sha}`);
        if (blob && blob.content) {
            const content = Buffer.from(blob.content, blob.encoding || 'base64');
            await fs.writeFile(destPath, content);
            downloaded++;

            // Capture new example config for comparison
            if (relativePath === 'config.env.example') {
                newExampleConfig = content.toString('utf-8');
            }
        }
    }

    // Restore protected config.env
    if (isUpdate && existingConfig) {
        await fs.writeFile(configPath, existingConfig, 'utf-8');
    }

    // Detect config changes (new/renamed keys)
    let configChanges = null;
    if (isUpdate && existingConfig && newExampleConfig) {
        configChanges = detectConfigChanges(existingConfig, newExampleConfig);
    }

    let message = isUpdate
        ? `Plugin '${pluginName}' updated successfully (${downloaded} files, config.env preserved).`
        : `Plugin '${pluginName}' installed successfully (${downloaded} files).`;

    if (configChanges && configChanges.length > 0) {
        message += ` ⚠️ ${configChanges.length} new config key(s) detected.`;
    }

    return { success: true, message, configChanges };
}

/**
 * Check if a file path is protected (should not be overwritten)
 */
function isProtectedFile(relativePath) {
    for (const pattern of PROTECTED_FILES) {
        if (pattern.endsWith('/')) {
            if (relativePath.startsWith(pattern)) return true;
        } else {
            if (relativePath === pattern) return true;
        }
    }
    return false;
}

/**
 * Compare user's config.env with new config.env.example to detect changes
 * @returns {Array} List of { key, type: 'new'|'removed', description }
 */
function detectConfigChanges(userConfig, exampleConfig) {
    const userKeys = parseEnvKeys(userConfig);
    const exampleKeys = parseEnvKeys(exampleConfig);
    const changes = [];

    // Keys in example but not in user's config = new keys to add
    for (const key of exampleKeys) {
        if (!userKeys.has(key)) {
            changes.push({ key, type: 'new', description: `New config key '${key}' available in this version` });
        }
    }

    // Keys in user's config but not in example = potentially removed/renamed
    for (const key of userKeys) {
        if (!exampleKeys.has(key)) {
            changes.push({ key, type: 'removed', description: `Config key '${key}' no longer in example (may be renamed)` });
        }
    }

    return changes;
}

/**
 * Parse env file content and extract key names (ignore comments and empty lines)
 */
function parseEnvKeys(content) {
    const keys = new Set();
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (match) keys.add(match[1]);
    }
    return keys;
}

/**
 * Remove an installed plugin
 * @param {string} pluginName
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function uninstall(pluginName) {
    const targetDir = path.join(PLUGIN_DIR, pluginName);
    if (!fsSync.existsSync(targetDir)) {
        return { success: false, message: `Plugin '${pluginName}' is not installed.` };
    }

    await fs.rm(targetDir, { recursive: true });
    return { success: true, message: `Plugin '${pluginName}' removed.` };
}

/**
 * Update a plugin to latest version
 * @param {string} pluginName
 */
async function update(pluginName) {
    return install(pluginName, { force: true });
}

// ========================
// Internal helpers
// ========================

async function fetchManifest(pluginName) {
    // Try active manifest first, then blocked
    let content;
    try {
        content = await githubApi(`/repos/${REPO}/contents/${pluginName}/plugin-manifest.json`);
    } catch {
        content = await githubApi(`/repos/${REPO}/contents/${pluginName}/plugin-manifest.json.block`);
    }

    if (content && content.content) {
        return JSON.parse(Buffer.from(content.content, 'base64').toString('utf-8'));
    }
    throw new Error('Manifest not found');
}

function githubApi(endpoint) {
    return new Promise((resolve, reject) => {
        const url = `https://api.github.com${endpoint}`;
        const options = {
            headers: {
                'User-Agent': 'VCPtoolbox-Junior-PluginStore',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        // Add auth token if available
        if (process.env.GITHUB_TOKEN) {
            options.headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
        }

        https.get(url, options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                https.get(res.headers.location, options, (res2) => {
                    collectBody(res2).then(b => resolve(JSON.parse(b))).catch(reject);
                }).on('error', reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`GitHub API ${res.statusCode}: ${endpoint}`));
                return;
            }
            collectBody(res).then(b => resolve(JSON.parse(b))).catch(reject);
        }).on('error', reject);
    });
}

function collectBody(res) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
    });
}

async function readCache() {
    try {
        const data = JSON.parse(await fs.readFile(STORE_CACHE_FILE, 'utf-8'));
        if (Date.now() - data.timestamp < CACHE_TTL) {
            return data.plugins;
        }
    } catch { /* no cache */ }
    return null;
}

async function writeCache(plugins) {
    try {
        await fs.writeFile(STORE_CACHE_FILE, JSON.stringify({
            timestamp: Date.now(),
            plugins
        }), 'utf-8');
    } catch { /* write failure is non-fatal */ }
}

function compareVersions(a, b) {
    const pa = (a || '0.0.0').split('.').map(Number);
    const pb = (b || '0.0.0').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return 1;
        if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
}

module.exports = {
    listRemote,
    listInstalled,
    checkUpdates,
    install,
    uninstall,
    update
};
