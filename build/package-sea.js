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
const USER_DIRS = [
    'AdminPanel',
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
    'LICENSE',
    'README.md',
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

    // ===== Step 4: Copy native modules + user dirs =====
    console.log('📁 Step 4/5: Copying native modules & user files...');

    // Native modules: copy .node files
    const nativeDir = path.join(outputDir, 'node_modules');
    for (const mod of NATIVE_MODULES) {
        await copyNativeModule(mod, nativeDir);
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
 * Copy a native module — full package (JS + .node binaries)
 * Excludes source code, tests, and docs to minimize size
 */
async function copyNativeModule(moduleName, destNodeModules) {
    const srcDir = path.join(ROOT, 'node_modules', moduleName);
    if (!fs.existsSync(srcDir)) return;

    const destDir = path.join(destNodeModules, moduleName);
    // Copy the entire module, excluding dev files only
    // NOTE: do NOT exclude 'src' — many packages (node-fetch) have their code there
    await copyRecursive(srcDir, destDir, [
        '.github', 'test', 'tests', 'docs', 'example', 'examples',
        'benchmark', '.eslintrc', '.prettierrc', 'CHANGELOG', 'CONTRIBUTING',
        '.travis.yml', 'appveyor.yml', 'binding.gyp', 'Makefile',
    ]);

    // For scoped packages like @node-rs/jieba, also copy platform-specific packages
    if (moduleName.startsWith('@')) {
        const scope = moduleName.split('/')[0];
        const scopeDir = path.join(ROOT, 'node_modules', scope);
        if (fs.existsSync(scopeDir)) {
            for (const entry of fs.readdirSync(scopeDir)) {
                const entryDir = path.join(scopeDir, entry);
                if (fs.statSync(entryDir).isDirectory() && hasNodeFile(entryDir)) {
                    const destEntry = path.join(destNodeModules, scope, entry);
                    await copyRecursive(entryDir, destEntry, [
                        '.github', 'test', 'tests', 'docs',
                    ]);
                }
            }
        }
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

main().catch(err => {
    console.error('\n❌ Package failed:', err.message);
    process.exit(1);
});
