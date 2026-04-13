/**
 * docker-sync.js
 * Reads docker-persist.json and syncs /opt/defaults → data/ volume → app symlinks.
 *
 * Sync modes:
 *   (none)  — pure user data, create empty dir/file if missing
 *   "merge" — copy new files from image defaults, never overwrite existing
 *   "plugin" — smart plugin sync: version comparison, preserve .block state & caches
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_DIR = '/usr/src/app';
const DATA_DIR = path.join(APP_DIR, 'data');
const DEFAULTS_DIR = '/opt/defaults';
const PERSIST_JSON = path.join(APP_DIR, 'docker-persist.json');

// ---------- helpers ----------

function mkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function exists(p) {
    try { fs.statSync(p); return true; } catch { return false; }
}

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function copyRecursive(src, dst) {
    if (!exists(src)) return;
    if (isDir(src)) {
        mkdirp(dst);
        for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dst, entry));
        }
    } else {
        fs.copyFileSync(src, dst);
    }
}

/** Copy only files that don't exist in dst */
function mergeDir(src, dst) {
    if (!isDir(src)) return;
    mkdirp(dst);
    for (const entry of fs.readdirSync(src)) {
        const s = path.join(src, entry);
        const d = path.join(dst, entry);
        if (isDir(s)) {
            mergeDir(s, d);
        } else if (!exists(d)) {
            fs.copyFileSync(s, d);
        }
    }
}

/** Extract version from plugin-manifest.json */
function getPluginVersion(manifestPath) {
    try {
        const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return data.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

/** Compare semver: returns true if a > b */
function versionGt(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return true;
        if ((pa[i] || 0) < (pb[i] || 0)) return false;
    }
    return false;
}

// Cache/state patterns to preserve during plugin upgrade
const KEEP_PATTERNS = [
    /^node_modules$/,
    /^config\.env$/,
    /^state$/,
    /^log$/,
    /^generated_lists$/,
    /^semantic_vectors$/,
    /^database$/,
    /_cache\.(json|md|txt)$/,
    /\.bin$/,
];

function shouldKeep(filename) {
    return KEEP_PATTERNS.some(re => re.test(filename));
}

// ---------- sync logic ----------

function syncPlugin(defaultsPlugin, dataPlugin) {
    // For each plugin in image defaults
    const defaultPlugins = isDir(defaultsPlugin) ? fs.readdirSync(defaultsPlugin) : [];

    mkdirp(dataPlugin);

    for (const pluginName of defaultPlugins) {
        const src = path.join(defaultsPlugin, pluginName);
        const dst = path.join(dataPlugin, pluginName);

        if (!isDir(src)) continue;

        // Case 1: new plugin, user doesn't have it
        if (!exists(dst)) {
            console.log(`  [NEW] ${pluginName}`);
            copyRecursive(src, dst);
            continue;
        }

        // Case 2: exists — check version
        const srcManifest = path.join(src, 'plugin-manifest.json');
        if (!exists(srcManifest)) continue;

        // User may have disabled it (.block)
        const dstManifest = path.join(dst, 'plugin-manifest.json');
        const dstManifestBlock = path.join(dst, 'plugin-manifest.json.block');
        const userWasBlocked = !exists(dstManifest) && exists(dstManifestBlock);
        const activeManifest = userWasBlocked ? dstManifestBlock : dstManifest;

        if (!exists(activeManifest)) {
            // No manifest at all — repair
            console.log(`  [REPAIR] ${pluginName}`);
            copyRecursive(src, dst);
            continue;
        }

        const srcVer = getPluginVersion(srcManifest);
        const dstVer = getPluginVersion(activeManifest);

        if (!versionGt(srcVer, dstVer)) continue;

        console.log(`  [UPDATE] ${pluginName}: ${dstVer} -> ${srcVer}`);

        // Save user state files
        const savedState = {};
        const entries = fs.readdirSync(dst);
        for (const entry of entries) {
            if (shouldKeep(entry)) {
                const p = path.join(dst, entry);
                const tmpDir = fs.mkdtempSync('/tmp/vcp-plugin-');
                const tmpPath = path.join(tmpDir, entry);
                copyRecursive(p, tmpPath);
                savedState[entry] = tmpPath;
            }
        }

        // Replace with image version
        fs.rmSync(dst, { recursive: true, force: true });
        copyRecursive(src, dst);

        // Restore user state
        for (const [entry, tmpPath] of Object.entries(savedState)) {
            const target = path.join(dst, entry);
            fs.rmSync(target, { recursive: true, force: true });
            copyRecursive(tmpPath, target);
            // Clean tmp
            fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });
        }

        // Restore block state
        if (userWasBlocked) {
            const m = path.join(dst, 'plugin-manifest.json');
            const b = path.join(dst, 'plugin-manifest.json.block');
            if (exists(m)) fs.renameSync(m, b);
        }
    }

    // Auto npm install for plugins missing node_modules
    const userPlugins = fs.readdirSync(dataPlugin);
    for (const pluginName of userPlugins) {
        const pluginDir = path.join(dataPlugin, pluginName);
        const pkgJson = path.join(pluginDir, 'package.json');
        const nodeModules = path.join(pluginDir, 'node_modules');
        if (exists(pkgJson) && !exists(nodeModules)) {
            console.log(`  [DEPS] ${pluginName}`);
            try {
                execSync('npm install --production --legacy-peer-deps', {
                    cwd: pluginDir, stdio: 'pipe', timeout: 60000,
                });
            } catch (e) {
                console.warn(`  [WARN] npm install failed for ${pluginName}: ${e.message}`);
            }
        }
    }
}

// ---------- main ----------

function main() {
    if (!exists(PERSIST_JSON)) {
        console.log('[sync] docker-persist.json not found, skipping.');
        return;
    }

    const config = JSON.parse(fs.readFileSync(PERSIST_JSON, 'utf8'));
    const paths = config.paths || [];

    console.log(`[sync] Syncing ${paths.length} persistent paths...`);

    for (const entry of paths) {
        const { path: relPath, type, init, sync } = entry;
        const appPath = path.join(APP_DIR, relPath);
        const dataPath = path.join(DATA_DIR, relPath);
        const defaultPath = path.join(DEFAULTS_DIR, relPath);

        // Step 1: ensure data/ has content
        if (type === 'dir') {
            if (!exists(dataPath)) {
                if (sync === 'plugin' || sync === 'merge') {
                    // First run: copy from image defaults
                    if (exists(defaultPath)) {
                        console.log(`  [INIT] ${relPath} (from defaults)`);
                        copyRecursive(defaultPath, dataPath);
                    } else {
                        mkdirp(dataPath);
                    }
                } else {
                    mkdirp(dataPath);
                }
            } else if (sync === 'plugin') {
                // Existing data — smart plugin sync
                syncPlugin(defaultPath, dataPath);
            } else if (sync === 'merge') {
                // Existing data — merge new files only
                if (exists(defaultPath)) {
                    mergeDir(defaultPath, dataPath);
                }
            }
        } else if (type === 'file') {
            if (!exists(dataPath)) {
                mkdirp(path.dirname(dataPath));
                if (init && exists(path.join(APP_DIR, init))) {
                    // Copy from specified init file
                    console.log(`  [INIT] ${relPath} (from ${init})`);
                    fs.copyFileSync(path.join(APP_DIR, init), dataPath);
                } else if (sync === 'merge' && exists(defaultPath)) {
                    console.log(`  [INIT] ${relPath} (from defaults)`);
                    fs.copyFileSync(defaultPath, dataPath);
                }
                // else: file doesn't exist yet, will be created by app at runtime
            }
        }

        // Step 2: remove image original and create symlink
        // (skip if already a symlink pointing to the right place)
        try {
            const linkTarget = fs.readlinkSync(appPath);
            if (linkTarget === dataPath) continue; // already correct
        } catch {
            // not a symlink, proceed
        }

        // Remove original from image layer
        if (exists(appPath)) {
            fs.rmSync(appPath, { recursive: true, force: true });
        }

        // Symlink app path -> data path
        if (exists(dataPath)) {
            fs.symlinkSync(dataPath, appPath);
        }
    }

    console.log('[sync] Done.');
}

main();
