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
const PLUGIN_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..'), 'Plugin');
const STORE_CACHE_FILE = path.join(PLUGIN_DIR, '.store-cache.json');
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
const STALE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h stale fallback on error

// In-memory tree cache — shared between listRemote() and install()
let _treeCache = null;
let _treeCacheTime = 0;
const TREE_CACHE_TTL = 10 * 60 * 1000; // 10 min in-memory
const TREE_CACHE_FILE = path.join(PLUGIN_DIR, '.tree-cache.json');
const TREE_FILE_TTL = 24 * 60 * 60 * 1000; // 24h file cache

/**
 * Get repo file tree — zero GitHub API calls.
 * Priority: memory cache → file cache → tarball download (codeload.github.com, no API quota)
 * Falls back to GitHub API only as last resort.
 */
async function getRepoTree() {
    const now = Date.now();

    // 1. In-memory cache
    if (_treeCache && (now - _treeCacheTime) < TREE_CACHE_TTL) {
        return _treeCache;
    }

    // 2. File cache (24h)
    try {
        const data = JSON.parse(await fs.readFile(TREE_CACHE_FILE, 'utf-8'));
        if (data.tree && data.tree.tree && (now - data.timestamp) < TREE_FILE_TTL) {
            _treeCache = data.tree;
            _treeCacheTime = now;
            return data.tree;
        }
    } catch { /* no file cache */ }

    // 3. Download tarball from codeload.github.com (NOT rate-limited like API)
    try {
        console.log('[PluginStore] Fetching repo tarball to build file tree (no API quota cost)...');
        const tree = await buildTreeFromTarball();
        _treeCache = tree;
        _treeCacheTime = now;
        await fs.writeFile(TREE_CACHE_FILE, JSON.stringify({ timestamp: now, tree }), 'utf-8').catch(() => {});
        console.log(`[PluginStore] Tree built from tarball: ${tree.tree.length} entries`);
        return tree;
    } catch (tarErr) {
        console.warn(`[PluginStore] Tarball fetch failed: ${tarErr.message}`);
    }

    // 4. Last resort: GitHub API (may 403)
    try {
        const tree = await githubApi(`/repos/${REPO}/git/trees/main?recursive=1`);
        if (tree && tree.tree) {
            _treeCache = tree;
            _treeCacheTime = now;
            await fs.writeFile(TREE_CACHE_FILE, JSON.stringify({ timestamp: now, tree }), 'utf-8').catch(() => {});
            return tree;
        }
    } catch (apiErr) {
        console.warn(`[PluginStore] Tree API also failed: ${apiErr.message}`);
    }

    throw new Error('无法获取插件仓库文件列表。请检查网络连接。');
}

/**
 * Download repo tarball and parse file entries from tar headers.
 * Uses codeload.github.com which has no API rate limits.
 * Only parses tar headers for file paths — doesn't extract content.
 */
function buildTreeFromTarball() {
    const zlib = require('zlib');
    return new Promise((resolve, reject) => {
        const url = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`;
        https.get(url, { headers: { 'User-Agent': 'VCPtoolbox-Junior-PluginStore' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                https.get(res.headers.location, (res2) => {
                    parseTarStream(res2, resolve, reject);
                }).on('error', reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Tarball download failed: ${res.statusCode}`));
                return;
            }
            parseTarStream(res, resolve, reject);
        }).on('error', reject);
    });
}

function parseTarStream(stream, resolve, reject) {
    const zlib = require('zlib');
    const gunzip = zlib.createGunzip();
    const entries = [];
    let buffer = Buffer.alloc(0);
    let prefixToStrip = ''; // e.g. "VCPtoolbox-Junior-Plugins-main/"

    gunzip.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        // Parse tar 512-byte blocks
        while (buffer.length >= 512) {
            const header = buffer.subarray(0, 512);
            // Check for zero block (end of archive)
            if (header.every(b => b === 0)) {
                buffer = buffer.subarray(512);
                continue;
            }
            // Extract filename from tar header (bytes 0-99)
            let name = header.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
            // USTAR prefix (bytes 345-499)
            const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0+$/, '');
            if (prefix) name = prefix + '/' + name;

            // Extract size from header (bytes 124-135, octal)
            const sizeStr = header.subarray(124, 136).toString('utf-8').replace(/\0+$/, '').trim();
            const size = parseInt(sizeStr, 8) || 0;

            // Type flag (byte 156): '0' or '\0' = regular file, '5' = directory
            const typeFlag = header[156];
            const isFile = typeFlag === 48 || typeFlag === 0; // '0' or NUL

            // Auto-detect and strip the root directory prefix
            if (!prefixToStrip && name.includes('/')) {
                prefixToStrip = name.split('/')[0] + '/';
            }

            const relativePath = name.startsWith(prefixToStrip) ? name.substring(prefixToStrip.length) : name;

            if (isFile && relativePath && !relativePath.endsWith('/')) {
                entries.push({ path: relativePath, type: 'blob', size });
            }

            // Skip past header + file content (padded to 512-byte boundary)
            const dataBlocks = Math.ceil(size / 512);
            const totalBytes = 512 + dataBlocks * 512;
            if (buffer.length < totalBytes) {
                // Need more data, wait for next chunk
                break;
            }
            buffer = buffer.subarray(totalBytes);
        }
    });

    gunzip.on('end', () => {
        resolve({ tree: entries });
    });

    gunzip.on('error', reject);
    stream.pipe(gunzip);
}

/**
 * Get remote plugin list from GitHub repo.
 * Uses Git Tree API to fetch all manifests in a single call (saves API quota).
 * @returns {Promise<Array>} List of available plugins with metadata
 */
async function listRemote() {
    // Check cache first
    const cached = await readCache();
    if (cached) return cached;

    try {
        // Single API call (cached 10min): get entire repo tree
        const tree = await getRepoTree();

        // Find all manifest files: <PluginName>/plugin-manifest.json(.block)
        const manifestFiles = tree.tree.filter(f =>
            f.type === 'blob' &&
            /^[^/]+\/plugin-manifest\.json(\.block)?$/.test(f.path) &&
            !f.path.startsWith('.')
        );

        // Deduplicate: prefer active manifest over .block
        const pluginManifests = new Map();
        for (const f of manifestFiles) {
            const pluginName = f.path.split('/')[0];
            const isBlocked = f.path.endsWith('.block');
            if (!pluginManifests.has(pluginName) || !isBlocked) {
                pluginManifests.set(pluginName, f);
            }
        }

        // Fetch manifest contents via raw.githubusercontent.com (no API quota cost)
        const plugins = [];
        const entries = Array.from(pluginManifests.entries());
        const results = await Promise.allSettled(
            entries.map(async ([pluginName, file]) => {
                const raw = await fetchRaw(file.path);
                const manifest = JSON.parse(raw);
                return {
                    name: pluginName,
                    displayName: manifest.displayName || manifest.name || pluginName,
                    version: manifest.version || '0.0.0',
                    description: manifest.description || '',
                    pluginType: manifest.pluginType || 'unknown',
                    // 插件间依赖声明（详见 docs/PLUGIN_PROTOCOL.md "插件间依赖"）
                    requires: Array.isArray(manifest.requires) ? manifest.requires : [],
                    sha: file.sha
                };
            })
        );
        for (const r of results) {
            if (r.status === 'fulfilled') plugins.push(r.value);
        }

        // Save cache
        await writeCache(plugins);
        return plugins;
    } catch (err) {
        // On error (403 rate limit, network issue): try stale cache
        const stale = await readCache(true);
        if (stale) {
            console.warn(`[PluginStore] GitHub API failed (${err.message}), using stale cache`);
            return stale;
        }
        throw err;
    }
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

    // Get file tree from GitHub (uses shared in-memory cache)
    const tree = await getRepoTree();

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

        // Download file content via raw.githubusercontent.com (no API quota cost)
        try {
            const rawContent = await fetchRawBuffer(file.path);
            await fs.writeFile(destPath, rawContent);
            downloaded++;

            // Capture new example config for comparison
            if (relativePath === 'config.env.example') {
                newExampleConfig = rawContent.toString('utf-8');
            }
        } catch (dlErr) {
            console.warn(`[PluginStore] Failed to download ${file.path}: ${dlErr.message}`);
        }
    }

    // Auto-merge config: use migrations if available, fallback to fuzzy merge
    let configChanges = [];
    if (isUpdate && existingConfig) {
        // Try to load config-migrations.json (already downloaded locally)
        let migrationsContent = null;
        const localMigPath = path.join(targetDir, 'config-migrations.json');
        try {
            migrationsContent = JSON.parse(await fs.readFile(localMigPath, 'utf-8'));
        } catch { /* no local migrations */ }

        // Get current installed version
        let currentVersion = '0.0.0';
        try {
            const oldManifest = path.join(targetDir, 'plugin-manifest.json');
            const oldBlocked = oldManifest + '.block';
            let mf = null;
            try { mf = JSON.parse(await fs.readFile(oldManifest, 'utf-8')); } catch {
                try { mf = JSON.parse(await fs.readFile(oldBlocked, 'utf-8')); } catch {}
            }
            if (mf && mf.version) currentVersion = mf.version;
        } catch {}

        if (migrationsContent) {
            // Use explicit migrations
            const migrated = applyMigrations(existingConfig, migrationsContent, currentVersion);
            await fs.writeFile(configPath, migrated.content, 'utf-8');
            configChanges = migrated.changes;
        } else if (newExampleConfig) {
            // Fallback: fuzzy merge with example
            const merged = mergeConfig(existingConfig, newExampleConfig);
            await fs.writeFile(configPath, merged.content, 'utf-8');
            configChanges = merged.changes;
        } else {
            // No migrations, no example — just restore user config
            await fs.writeFile(configPath, existingConfig, 'utf-8');
        }
    }

    // Auto-install npm dependencies if plugin has package.json
    const pluginPkgPath = path.join(targetDir, 'package.json');
    if (fsSync.existsSync(pluginPkgPath)) {
        try {
            console.log(`[PluginStore] Installing npm dependencies for "${pluginName}"...`);
            const { execSync } = require('child_process');
            execSync('npm install --production --legacy-peer-deps', {
                cwd: targetDir,
                stdio: 'pipe',
                timeout: 120000,
            });
            console.log(`[PluginStore] Dependencies installed for "${pluginName}".`);
        } catch (e) {
            console.error(`[PluginStore] Failed to install dependencies for "${pluginName}":`, e.message);
        }
    }

    let message = isUpdate
        ? `Plugin '${pluginName}' updated (${downloaded} files).`
        : `Plugin '${pluginName}' installed (${downloaded} files).`;

    if (configChanges.length > 0) {
        const added = configChanges.filter(c => c.type === 'added').length;
        const renamed = configChanges.filter(c => c.type === 'renamed').length;
        const removed = configChanges.filter(c => c.type === 'removed').length;
        if (added) message += ` +${added} config(s) added.`;
        if (renamed) message += ` ${renamed} config(s) renamed.`;
        if (removed) message += ` ${removed} config(s) removed.`;
    }

    return { success: true, message, configChanges };
}

/**
 * Apply explicit config migrations from config-migrations.json
 * Executes all migration steps from currentVersion to latest, in order.
 *
 * config-migrations.json format:
 * {
 *   "2.0.0": {
 *     "renames": { "OLD_KEY": "NEW_KEY" },
 *     "added": { "NEW_VAR": "default_value" },
 *     "removed": ["DEPRECATED_VAR"]
 *   }
 * }
 *
 * @param {string} userConfig - Current config.env content
 * @param {object} migrations - Parsed config-migrations.json
 * @param {string} currentVersion - User's currently installed version
 * @returns {{ content: string, changes: Array }}
 */
function applyMigrations(userConfig, migrations, currentVersion) {
    const changes = [];
    let lines = userConfig.split('\n');

    // Sort migration versions and filter those > currentVersion
    const versions = Object.keys(migrations)
        .filter(v => compareVersions(v, currentVersion) > 0)
        .sort((a, b) => compareVersions(a, b));

    for (const version of versions) {
        const step = migrations[version];

        // Handle renames
        if (step.renames) {
            for (const [oldKey, newKey] of Object.entries(step.renames)) {
                lines = lines.map(line => {
                    const match = line.match(new RegExp(`^${escapeRegex(oldKey)}(\\s*=)(.*)`));
                    if (match) {
                        changes.push({ type: 'renamed', oldKey, newKey, version });
                        return `${newKey}${match[1]}${match[2]}`;
                    }
                    return line;
                });
            }
        }

        // Handle removals
        if (step.removed && Array.isArray(step.removed)) {
            for (const key of step.removed) {
                const before = lines.length;
                lines = lines.filter(line => {
                    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
                    return !(match && match[1] === key);
                });
                if (lines.length < before) {
                    changes.push({ type: 'removed', key, version });
                }
            }
        }

        // Handle additions
        if (step.added) {
            const existingKeys = new Set();
            for (const line of lines) {
                const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
                if (match) existingKeys.add(match[1]);
            }

            const toAdd = [];
            for (const [key, defaultValue] of Object.entries(step.added)) {
                if (!existingKeys.has(key)) {
                    toAdd.push({ key, defaultValue });
                    changes.push({ type: 'added', key, defaultValue, version });
                }
            }

            if (toAdd.length > 0) {
                lines.push('');
                lines.push(`# --- Config added in v${version} ---`);
                for (const { key, defaultValue } of toAdd) {
                    lines.push(`${key}=${defaultValue}`);
                }
            }
        }
    }

    return { content: lines.join('\n'), changes };
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * Merge user config with new example config:
 * - Preserve all user values
 * - Append new keys from example (with default values)
 * - Auto-rename keys (detect by similarity: same prefix or same value)
 *
 * @returns {{ content: string, changes: Array }}
 */
function mergeConfig(userConfig, exampleConfig) {
    const changes = [];
    const userEntries = parseEnvEntries(userConfig);
    const exampleEntries = parseEnvEntries(exampleConfig);

    const userKeys = new Map(userEntries.filter(e => e.key).map(e => [e.key, e]));
    const exampleKeys = new Map(exampleEntries.filter(e => e.key).map(e => [e.key, e]));

    // Detect renames: keys in user but not in example, paired with keys in example but not in user
    const removedKeys = [...userKeys.keys()].filter(k => !exampleKeys.has(k));
    const addedKeys = [...exampleKeys.keys()].filter(k => !userKeys.has(k));

    const renameMap = new Map(); // oldKey -> newKey
    for (const oldKey of removedKeys) {
        const bestMatch = findRenameCandidate(oldKey, addedKeys, userKeys.get(oldKey).value, exampleKeys);
        if (bestMatch) {
            renameMap.set(oldKey, bestMatch);
            changes.push({
                type: 'renamed',
                oldKey,
                newKey: bestMatch,
                description: `'${oldKey}' → '${bestMatch}' (auto-renamed)`
            });
        }
    }

    // Build merged content: start with user's config, apply renames, then append new keys
    const lines = userConfig.split('\n');
    const resultLines = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            resultLines.push(line);
            continue;
        }
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)/);
        if (match) {
            const key = match[1];
            const value = match[2];
            if (renameMap.has(key)) {
                // Auto-rename: replace key name, keep user's value
                const newKey = renameMap.get(key);
                resultLines.push(`${newKey}=${value}`);
            } else {
                resultLines.push(line);
            }
        } else {
            resultLines.push(line);
        }
    }

    // Append truly new keys (not rename targets) at the end
    const renamedTargets = new Set(renameMap.values());
    const trulyNewKeys = addedKeys.filter(k => !renamedTargets.has(k));

    if (trulyNewKeys.length > 0) {
        resultLines.push('');
        resultLines.push('# --- New config keys (auto-added on update) ---');
        for (const key of trulyNewKeys) {
            const entry = exampleKeys.get(key);
            resultLines.push(`${key}=${entry.value}`);
            changes.push({
                type: 'added',
                key,
                defaultValue: entry.value,
                description: `New key '${key}' added with default value`
            });
        }
    }

    return { content: resultLines.join('\n'), changes };
}

/**
 * Try to find a rename candidate for a removed key among added keys.
 * Heuristics:
 * 1. Same value in both old and new → likely rename
 * 2. Similar key name (share 60%+ prefix/suffix) → likely rename
 */
function findRenameCandidate(oldKey, addedKeys, oldValue, exampleKeys) {
    // Strategy 1: exact same default value
    for (const newKey of addedKeys) {
        const newEntry = exampleKeys.get(newKey);
        if (newEntry && oldValue && newEntry.value === oldValue && oldValue.length > 0) {
            return newKey;
        }
    }

    // Strategy 2: similar key name (Levenshtein-like)
    const oldLower = oldKey.toLowerCase();
    for (const newKey of addedKeys) {
        const newLower = newKey.toLowerCase();
        // Share common prefix (at least 60% of shorter key)
        const minLen = Math.min(oldLower.length, newLower.length);
        let commonPrefix = 0;
        for (let i = 0; i < minLen; i++) {
            if (oldLower[i] === newLower[i]) commonPrefix++;
            else break;
        }
        if (commonPrefix >= minLen * 0.6 && commonPrefix >= 4) {
            return newKey;
        }

        // Share common suffix
        let commonSuffix = 0;
        for (let i = 0; i < minLen; i++) {
            if (oldLower[oldLower.length - 1 - i] === newLower[newLower.length - 1 - i]) commonSuffix++;
            else break;
        }
        if (commonSuffix >= minLen * 0.6 && commonSuffix >= 4) {
            return newKey;
        }
    }

    return null; // No match found
}

/**
 * Parse env file into structured entries
 */
function parseEnvEntries(content) {
    const entries = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            entries.push({ type: 'comment', raw: line });
            continue;
        }
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)/);
        if (match) {
            entries.push({ type: 'kv', key: match[1], value: match[2], raw: line });
        } else {
            entries.push({ type: 'other', raw: line });
        }
    }
    return entries;
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

/**
 * Fetch file content from raw.githubusercontent.com (no API quota cost).
 * Returns UTF-8 string.
 */
function fetchRaw(filePath) {
    return new Promise((resolve, reject) => {
        const url = `https://raw.githubusercontent.com/${REPO}/main/${filePath}`;
        https.get(url, { headers: { 'User-Agent': 'VCPtoolbox-Junior-PluginStore' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                https.get(res.headers.location, (res2) => {
                    collectBody(res2).then(resolve).catch(reject);
                }).on('error', reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Raw fetch ${res.statusCode}: ${filePath}`));
                return;
            }
            collectBody(res).then(resolve).catch(reject);
        }).on('error', reject);
    });
}

/**
 * Fetch file as Buffer from raw.githubusercontent.com (for binary files).
 */
function fetchRawBuffer(filePath) {
    return new Promise((resolve, reject) => {
        const url = `https://raw.githubusercontent.com/${REPO}/main/${filePath}`;
        https.get(url, { headers: { 'User-Agent': 'VCPtoolbox-Junior-PluginStore' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                https.get(res.headers.location, (res2) => {
                    const chunks = [];
                    res2.on('data', c => chunks.push(c));
                    res2.on('end', () => resolve(Buffer.concat(chunks)));
                    res2.on('error', reject);
                }).on('error', reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Raw fetch ${res.statusCode}: ${filePath}`));
                return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function readCache(allowStale = false) {
    try {
        const data = JSON.parse(await fs.readFile(STORE_CACHE_FILE, 'utf-8'));
        const age = Date.now() - data.timestamp;
        if (age < CACHE_TTL) {
            return data.plugins;
        }
        // Return stale cache if allowed and within stale TTL
        if (allowStale && age < STALE_CACHE_TTL) {
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

/**
 * 解析某插件的 requires 依赖，区分出已装/待装/仓库缺失三类
 * @param {string} pluginName 要安装的插件名
 * @returns {Promise<{pluginName, requires: string[], missing: Array, already: string[], notFound: string[]}>}
 *   - requires: manifest 声明的完整依赖列表
 *   - missing:  [{name, displayName}] 仓库中存在但本地未装（前端弹窗列出这部分）
 *   - already:  [name] 已装的（跳过即可）
 *   - notFound: [name] 仓库里不存在（阻塞安装并报错）
 */
async function resolveDependencies(pluginName) {
    const [remote, installed] = await Promise.all([listRemote(), listInstalled()]);
    const target = remote.find(p => p.name === pluginName);
    if (!target) {
        const err = new Error(`插件 '${pluginName}' 在商店中不存在`);
        err.code = 'PLUGIN_NOT_IN_STORE';
        throw err;
    }
    // 老缓存可能无 requires 字段，兜底成空数组
    const requires = Array.isArray(target.requires) ? target.requires : [];
    const installedNames = new Set(installed.map(p => p.name));
    const remoteByName = new Map(remote.map(p => [p.name, p]));

    const missing = [];
    const already = [];
    const notFound = [];

    for (const dep of requires) {
        if (installedNames.has(dep)) {
            already.push(dep);
        } else if (remoteByName.has(dep)) {
            const info = remoteByName.get(dep);
            missing.push({ name: dep, displayName: info.displayName, version: info.version });
        } else {
            notFound.push(dep);
        }
    }
    return { pluginName, requires, missing, already, notFound };
}

module.exports = {
    listRemote,
    listInstalled,
    checkUpdates,
    install,
    uninstall,
    update,
    resolveDependencies
};
