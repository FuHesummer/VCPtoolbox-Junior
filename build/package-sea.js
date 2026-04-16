#!/usr/bin/env node
/**
 * VCPtoolbox-Junior — Single Executable Application (SEA) Packager
 *
 * Builds a single-exe distributable:
 * 1. esbuild bundles server+admin → dist/vcp.bundle.js
 * 2. Node.js SEA generates blob → dist/sea-prep.blob
 * 3. Copies node binary and injects blob → dist/VCPtoolbox[.exe]
 * 4. Copies native modules + user dirs
 * 5. Compresses to archive
 *
 * Usage: node build/package-sea.js [platform] [arch]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const NODE_VERSION = '22.16.0';

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;

const EXE_NAME = platform === 'win32' ? 'VCPtoolbox.exe' : 'VCPtoolbox';

// External modules: native binaries, WASM, ESM, unbundleable packages
const NATIVE_MODULES = [
    'better-sqlite3',
    'hnswlib-node',
    '@node-rs/jieba',
    '@napi-rs/canvas',
    '@dqbd/tiktoken',   // WASM dependency (tiktoken_bg.wasm)
    // node-fetch is ESM-only, cannot be bundled into CJS
    'node-fetch',
    'data-uri-to-buffer',
    'fetch-blob',
    'formdata-polyfill',
    'node-domexception',
    'web-streams-polyfill',
];

// User-facing directories to include
// 注意：AdminPanel 解耦后不在本体，由 prepareAdminPanel() 独立处理
// Plugin/ 只复制本体 13 个内置核心；仓库扩展插件由 preparePlugins() 合并
const USER_DIRS = [
    'Agent',
    'Plugin',
    'knowledge',
    'thinking',
    'TVStxt',
    'image',
    'scripts',
    'python',
    'VCPTimedContacts',
    // Core modules/routes must exist on disk — plugins require them at runtime
    // e.g. RAGDiaryPlugin requires ../../modules/TextChunker.js
    'modules',
    'routes',
];

const USER_FILES = [
    'config.env.example',
    'maintain.js',
    'agent_map.json',
    'plugin-ui-prefs.json',
    'docker-persist.json',
    'LICENSE',
    'README.md',
];

// 预置的 data/ 目录文件（首次启动避免 ENOENT）
const DATA_SEED_FILES = [
    'panel-registry.json',
    'dashboardLayout.json',
    'dashboard-bubbles.json',
];

// 预创建的 data/ 子目录
const DATA_SEED_DIRS = [
    'maintenance-logs',
];

async function main() {
    console.log(`\n🔨 SEA Packaging: VCPtoolbox-Junior for ${platform}-${arch}\n`);

    const packageName = `vcp-junior-${platform}-${arch}`;
    const outputDir = path.join(DIST_DIR, packageName);

    // Clean
    if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    // ===== Step 1: esbuild bundle =====
    console.log('📦 Step 1/5: Bundling JS with esbuild...');
    execSync('node build/esbuild.config.js', { cwd: ROOT, stdio: 'inherit' });
    const bundlePath = path.join(DIST_DIR, 'vcp.bundle.js');
    if (!fs.existsSync(bundlePath)) throw new Error('vcp.bundle.js not found');
    const bundleSize = (fs.statSync(bundlePath).size / 1024 / 1024).toFixed(2);
    console.log(`   Bundle: ${bundleSize} MB\n`);

    // ===== Step 2: Download Node.js for target platform =====
    console.log(`⬇️  Step 2/5: Downloading Node.js v${NODE_VERSION} for ${platform}-${arch}...`);
    const nodeDir = path.join(DIST_DIR, '_node_tmp');
    if (fs.existsSync(nodeDir)) fs.rmSync(nodeDir, { recursive: true });
    fs.mkdirSync(nodeDir, { recursive: true });

    const ext = platform === 'win32' ? 'zip' : 'tar.gz';
    const platName = platform === 'win32' ? 'win' : platform;
    const nodeUrl = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platName}-${arch}.${ext}`;
    const nodeArchive = path.join(nodeDir, `node.${ext}`);

    await downloadFile(nodeUrl, nodeArchive);

    // Extract
    if (platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${nodeArchive}' -DestinationPath '${nodeDir}' -Force"`, { stdio: 'pipe' });
    } else {
        execSync(`tar -xzf "${nodeArchive}" -C "${nodeDir}" --strip-components=1`, { stdio: 'pipe' });
    }

    // Find the node binary
    let nodeBin;
    if (platform === 'win32') {
        const extracted = fs.readdirSync(nodeDir).find(d => d.startsWith('node-'));
        nodeBin = path.join(nodeDir, extracted || '', 'node.exe');
    } else {
        nodeBin = path.join(nodeDir, 'bin', 'node');
    }
    if (!fs.existsSync(nodeBin)) throw new Error(`Node binary not found: ${nodeBin}`);
    console.log(`   Node binary: ${nodeBin}\n`);

    // ===== Step 3: Create SEA blob & inject =====
    console.log('💉 Step 3/5: Creating SEA blob & injecting into binary...');

    const isCrossBuild = platform !== process.platform || arch !== process.arch;

    if (isCrossBuild) {
        // Cross-build: ship node binary + bundle + start script
        console.log('   ⚠️  Cross-build detected — shipping as node binary + bundle');
        const exePath = path.join(outputDir, EXE_NAME);
        fs.copyFileSync(nodeBin, exePath);

        // Copy the bundle alongside
        fs.copyFileSync(bundlePath, path.join(outputDir, 'vcp.bundle.js'));

        if (platform === 'win32') {
            fs.writeFileSync(path.join(outputDir, 'start.bat'),
                '@echo off\r\ntitle VCPtoolbox-Junior\r\n"%~dp0VCPtoolbox.exe" "%~dp0vcp.bundle.js"\r\npause\r\n');
        } else {
            fs.writeFileSync(path.join(outputDir, 'start.sh'),
                '#!/bin/bash\nDIR="$(cd "$(dirname "$0")" && pwd)"\nchmod +x "$DIR/VCPtoolbox"\nexec "$DIR/VCPtoolbox" "$DIR/vcp.bundle.js" "$@"\n',
                { mode: 0o755 });
        }
    } else {
        // Native build: use Node.js SEA
        // Use the DOWNLOADED node binary to generate blob (version match guaranteed)
        execSync(`"${nodeBin}" --experimental-sea-config build/sea-config.json`, {
            cwd: ROOT,
            stdio: 'inherit',
        });

        const blobPath = path.join(DIST_DIR, 'sea-prep.blob');
        if (!fs.existsSync(blobPath)) throw new Error('SEA blob not found');

        // Copy downloaded node binary to output
        const exePath = path.join(outputDir, EXE_NAME);
        fs.copyFileSync(nodeBin, exePath);

        // Remove signature (macOS)
        if (platform === 'darwin') {
            try { execSync(`codesign --remove-signature "${exePath}"`, { stdio: 'pipe' }); } catch {}
        }

        // Inject blob using postject
        const postjectArgs = [
            `"${exePath}"`,
            'NODE_SEA_BLOB',
            `"${blobPath}"`,
            '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        ];
        if (platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
        if (platform === 'linux') postjectArgs.push('--overwrite');

        execSync(`npx postject ${postjectArgs.join(' ')}`, { cwd: ROOT, stdio: 'inherit' });

        // Re-sign (macOS)
        if (platform === 'darwin') {
            try { execSync(`codesign --sign - "${exePath}"`, { stdio: 'pipe' }); } catch {}
        }

        // Make executable (unix)
        if (platform !== 'win32') {
            fs.chmodSync(exePath, 0o755);
        }

        console.log(`   ✅ SEA binary: ${EXE_NAME}\n`);
    }

    // ===== Step 4: Copy node_modules + user dirs =====
    console.log('📁 Step 4/5: Copying node_modules & user files...');

    // Copy production node_modules（剔除 devDep 顶层包）
    // Core modules (modules/TextChunker.js etc.) are loaded from disk by plugins
    // via relative paths and require npm packages (dotenv, express, etc.).
    // These can't be resolved from the bundle, only from node_modules on disk.
    // Plugin package.json handles plugin-specific deps independently.
    const nmSrc = path.join(ROOT, 'node_modules');
    if (fs.existsSync(nmSrc)) {
        console.log('   Copying node_modules (production only)...');
        await copyProductionNodeModules(nmSrc, path.join(outputDir, 'node_modules'));
    }

    // rust-vexus-lite
    const vexusSrc = path.join(ROOT, 'rust-vexus-lite');
    if (fs.existsSync(vexusSrc)) {
        await copyRecursive(vexusSrc, path.join(outputDir, 'rust-vexus-lite'), [
            'target', 'src', '.cargo', 'Cargo.toml', 'Cargo.lock', 'build.rs',
        ]);
    }

    // User directories
    for (const dir of USER_DIRS) {
        const src = path.join(ROOT, dir);
        if (fs.existsSync(src)) {
            await copyRecursive(src, path.join(outputDir, dir), [
                'node_modules', '.git', '__pycache__', '.sqlite', 'VectorStore',
            ]);
        }
    }

    // User files
    for (const file of USER_FILES) {
        const src = path.join(ROOT, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(outputDir, file));
        }
    }

    // AdminPanel（方案 C 解耦后从独立仓库注入）
    await prepareAdminPanel(outputDir);

    // Plugins（合并插件仓库的扩展插件到本体 Plugin/）
    await preparePlugins(outputDir);

    // data/ 骨架（预置 panel-registry.json 等避免首启 ENOENT）
    await prepareDataDir(outputDir);

    // ===== Step 5: Create archive =====
    console.log('📦 Step 5/5: Creating distributable archive...');
    if (platform === 'win32') {
        const zipName = `${packageName}.zip`;
        const zipPath = path.join(DIST_DIR, zipName);
        try {
            const sevenZip = process.env['ProgramFiles']
                ? `"${process.env['ProgramFiles']}\\7-Zip\\7z.exe"` : '7z';
            execSync(`${sevenZip} a -mx=3 "${zipPath}" "${outputDir}\\*"`, { stdio: 'pipe' });
        } catch {
            execSync(`powershell -Command "Compress-Archive -Path '${outputDir}/*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'pipe' });
        }
        console.log(`\n✅ Built: dist/${zipName}`);
    } else {
        const tarName = `${packageName}.tar.gz`;
        execSync(`tar -czf "${path.join(DIST_DIR, tarName)}" -C "${DIST_DIR}" "${packageName}"`, { stdio: 'pipe' });
        console.log(`\n✅ Built: dist/${tarName}`);
    }

    // Cleanup temp
    fs.rmSync(nodeDir, { recursive: true, force: true });
    fs.rmSync(path.join(DIST_DIR, 'sea-prep.blob'), { force: true });

    console.log('\n🎉 Done!\n');
    console.log(`Output structure:`);
    console.log(`  ${packageName}/`);
    console.log(`  ├── ${EXE_NAME}          # Single executable (Node.js + all JS)`);
    console.log(`  ├── node_modules/        # Only native .node addons`);
    console.log(`  ├── rust-vexus-lite/     # Rust vector engine`);
    console.log(`  ├── config.env.example`);
    console.log(`  ├── AdminPanel/`);
    console.log(`  ├── Agent/`);
    console.log(`  ├── Plugin/`);
    console.log(`  └── knowledge/`);
}

/**
 * Copy a native module + all its transitive npm dependencies.
 * Recursively resolves package.json "dependencies" to ensure nothing is missing.
 */
const _copiedModules = new Set();

async function copyNativeModule(moduleName, destNodeModules) {
    if (_copiedModules.has(moduleName)) return;
    _copiedModules.add(moduleName);

    const srcDir = path.join(ROOT, 'node_modules', moduleName);
    if (!fs.existsSync(srcDir)) return;

    const destDir = path.join(destNodeModules, moduleName);
    if (fs.existsSync(destDir)) return; // already copied

    await copyRecursive(srcDir, destDir, [
        '.github', 'test', 'tests', 'docs', 'example', 'examples',
        'benchmark', '.eslintrc', '.prettierrc', 'CHANGELOG', 'CONTRIBUTING',
        '.travis.yml', 'appveyor.yml', 'Makefile',
    ]);

    // For scoped packages, also copy platform-specific sub-packages
    if (moduleName.startsWith('@')) {
        const scope = moduleName.split('/')[0];
        const scopeDir = path.join(ROOT, 'node_modules', scope);
        if (fs.existsSync(scopeDir)) {
            for (const entry of fs.readdirSync(scopeDir)) {
                const entryDir = path.join(scopeDir, entry);
                if (fs.statSync(entryDir).isDirectory() && hasNodeFile(entryDir)) {
                    const destEntry = path.join(destNodeModules, scope, entry);
                    if (!fs.existsSync(destEntry)) {
                        await copyRecursive(entryDir, destEntry, [
                            '.github', 'test', 'tests', 'docs',
                        ]);
                    }
                }
            }
        }
    }

    // Recursively copy production dependencies
    const pkgPath = path.join(srcDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = Object.keys(pkg.dependencies || {});
            for (const dep of deps) {
                await copyNativeModule(dep, destNodeModules);
            }
        } catch {}
    }
}

function hasNodeFile(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.endsWith('.node')) return true;
        if (e.isDirectory() && hasNodeFile(path.join(dir, e.name))) return true;
    }
    return false;
}

async function copyRecursive(src, dest, excludes = []) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            if (excludes.some(ex => entry.includes(ex))) continue;
            await copyRecursive(path.join(src, entry), path.join(dest, entry), excludes);
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const proto = url.startsWith('https') ? https : http;
        proto.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                fs.unlinkSync(destPath);
                downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                file.close();
                reject(new Error(`Download failed: ${res.statusCode}`));
                return;
            }
            const total = parseInt(res.headers['content-length'] || '0', 10);
            let downloaded = 0;
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total > 0) {
                    const pct = ((downloaded / total) * 100).toFixed(1);
                    process.stdout.write(`\r   Downloading... ${pct}%`);
                }
            });
            res.pipe(file);
            file.on('finish', () => { file.close(); console.log(''); resolve(); });
        }).on('error', (err) => { file.close(); reject(err); });
    });
}

/**
 * 复制 production-only node_modules
 * 策略：顶层 skip devDep 包 + @esbuild scope（平台二进制 scope 包）
 * 不做深度 prune —— devDep 的传递依赖可能被 prod dep 共用，保守保留
 */
async function copyProductionNodeModules(src, dest) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const devDeps = Object.keys(pkg.devDependencies || {});

    // dev 专属 scope（平台二进制包）
    const devScopes = new Set(['@esbuild']);

    const skipNames = new Set([
        ...devDeps,
        '.cache',
        '.package-lock.json',
    ]);

    fs.mkdirSync(dest, { recursive: true });
    let totalSize = 0, skippedCount = 0;

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            // 顶层散文件（如 .package-lock.json）
            if (skipNames.has(entry.name)) continue;
            fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
            continue;
        }

        if (skipNames.has(entry.name) || devScopes.has(entry.name)) {
            skippedCount++;
            continue;
        }

        await copyRecursive(path.join(src, entry.name), path.join(dest, entry.name), [
            '.cache', '__pycache__',
        ]);
    }

    console.log(`   跳过 ${skippedCount} 个 devDep 顶层包`);
}

/**
 * 准备 AdminPanel 目录（方案 C 解耦架构）
 *
 * 查找顺序：
 * 1. env ADMIN_PANEL_DIST_PATH（CI 注入）
 * 2. sibling repo ../VCPtoolbox-Junior-Panel/dist（并列仓库）
 * 3. 本地 AdminPanel-Vue/dist（开发者 symlink 产物）
 *
 * 找不到时警告但不失败 —— 用户可后续部署时手动挂载
 */
async function prepareAdminPanel(outputDir) {
    console.log('🎨 Preparing AdminPanel (decoupled)...');

    const candidates = [];
    const envPath = (process.env.ADMIN_PANEL_DIST_PATH || '').trim();
    if (envPath) {
        candidates.push({ path: path.resolve(envPath), source: 'env ADMIN_PANEL_DIST_PATH' });
    }
    candidates.push({
        path: path.resolve(ROOT, '..', 'VCPtoolbox-Junior-Panel', 'dist'),
        source: 'sibling repo',
    });
    candidates.push({
        path: path.join(ROOT, 'AdminPanel-Vue', 'dist'),
        source: 'local AdminPanel-Vue',
    });

    let picked = null;
    for (const c of candidates) {
        if (fs.existsSync(c.path) && fs.existsSync(path.join(c.path, 'index.html'))) {
            picked = c;
            break;
        }
    }

    if (!picked) {
        console.warn('   ⚠️  未找到 AdminPanel dist —— 产物将不含管理面板。');
        console.warn('      请在 CI 先构建 Panel 仓库，或设置 ADMIN_PANEL_DIST_PATH');
        return;
    }

    const dest = path.join(outputDir, 'AdminPanel');
    await copyRecursive(picked.path, dest, []);
    console.log(`   ✅ AdminPanel 已注入（来自 ${picked.source}）\n`);
}

/**
 * 合并插件仓库到本体 Plugin/
 *
 * 本体 Plugin/ 只保留 13 个内置核心（README 定义）。
 * 插件仓库 VCPtoolbox-Junior-Plugins 提供扩展插件。
 *
 * 查找顺序：env PLUGINS_REPO_PATH > ../VCPtoolbox-Junior-Plugins
 */
async function preparePlugins(outputDir) {
    console.log('🔌 Merging extension plugins...');

    const envPath = (process.env.PLUGINS_REPO_PATH || '').trim();
    const pluginsRoot = envPath
        ? path.resolve(envPath)
        : path.resolve(ROOT, '..', 'VCPtoolbox-Junior-Plugins');

    if (!fs.existsSync(pluginsRoot)) {
        console.warn(`   ⚠️  未找到插件仓库: ${pluginsRoot}`);
        console.warn('      产物仅含 13 个内置核心插件。');
        return;
    }

    const destPluginDir = path.join(outputDir, 'Plugin');
    fs.mkdirSync(destPluginDir, { recursive: true });

    let merged = 0, skipped = 0;
    for (const entry of fs.readdirSync(pluginsRoot)) {
        const srcDir = path.join(pluginsRoot, entry);
        const stat = fs.statSync(srcDir);
        if (!stat.isDirectory()) continue;

        const manifest = path.join(srcDir, 'plugin-manifest.json');
        const manifestBlock = path.join(srcDir, 'plugin-manifest.json.block');
        if (!fs.existsSync(manifest) && !fs.existsSync(manifestBlock)) continue;

        const destDir = path.join(destPluginDir, entry);
        if (fs.existsSync(destDir)) {
            skipped++;
            continue; // 本体同名保留（核心优先）
        }

        await copyRecursive(srcDir, destDir, [
            'node_modules', '.git', '__pycache__', '.sqlite', 'VectorStore',
            'state', 'cache', '.cache',
        ]);
        merged++;
    }

    console.log(`   ✅ 合并 ${merged} 个扩展插件（跳过 ${skipped} 个与本体同名）\n`);
}

/**
 * 准备 data/ 目录骨架
 * 预置 panel-registry.json 等 JSON，避免首次启动时 writeFile-style 端点 ENOENT
 */
async function prepareDataDir(outputDir) {
    console.log('📂 Seeding data/ directory...');

    const destData = path.join(outputDir, 'data');
    fs.mkdirSync(destData, { recursive: true });

    // 种子 JSON 文件：若本体 data/ 有就复制，没有就写空结构
    const defaults = {
        'panel-registry.json': JSON.stringify({
            active: 'official',
            panels: [{
                id: 'official',
                name: 'VCPtoolbox-Junior-Panel',
                source: 'sibling repo',
                description: '官方 Vue 3 管理面板',
            }],
        }, null, 2) + '\n',
        'dashboardLayout.json': JSON.stringify({ cards: [] }, null, 2) + '\n',
        'dashboard-bubbles.json': JSON.stringify([], null, 2) + '\n',
    };

    for (const file of DATA_SEED_FILES) {
        const srcFile = path.join(ROOT, 'data', file);
        const destFile = path.join(destData, file);
        if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, destFile);
        } else if (defaults[file]) {
            fs.writeFileSync(destFile, defaults[file]);
        }
    }

    // 预创建空子目录
    for (const dir of DATA_SEED_DIRS) {
        fs.mkdirSync(path.join(destData, dir), { recursive: true });
        fs.writeFileSync(path.join(destData, dir, '.gitkeep'), '');
    }

    console.log(`   ✅ data/ 骨架已就绪\n`);
}

main().catch(err => {
    console.error('\n❌ Package failed:', err.message);
    process.exit(1);
});
