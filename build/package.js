#!/usr/bin/env node
/**
 * VCPtoolbox-Junior Package Script
 *
 * Builds platform-specific distributable packages.
 * Usage: node build/package.js [platform] [arch]
 *
 * Platforms: win32, linux, darwin
 * Architectures: x64, arm64
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const NODE_VERSION = '22.16.0'; // LTS

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;

// Node.js download URLs
function getNodeUrl(plat, arch) {
    const ext = plat === 'win32' ? 'zip' : 'tar.gz';
    const platName = plat === 'win32' ? 'win' : plat;
    return `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platName}-${arch}.${ext}`;
}

// Files/dirs to include in the package
const INCLUDE = [
    'server.js',
    'adminServer.js',
    'Plugin.js',
    'maintain.js',
    'config.env.example',
    'package.json',
    'package-lock.json',
    'agent_map.json',
    'modules/',
    'Plugin/',
    'routes/',
    'rust-vexus-lite/',
    'Agent/',
    'knowledge/',
    'thinking/',
    'TVStxt/',
    'scripts/',
    'python/',
    'image/',
    'docs/',
    'build/launcher.js',
    'Dockerfile',
    'docker-compose.yml',
    'LICENSE',
    'README.md',
];

// Files to exclude
const EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    'dist',
    '*.sqlite',
    'VectorStore',
    'DebugLog',
    'AdminPanel',
    '.file_cache',
];

async function main() {
    console.log(`\n📦 Packaging VCPtoolbox-Junior for ${platform}-${arch}\n`);

    const packageName = `vcp-junior-${platform}-${arch}`;
    const outputDir = path.join(DIST_DIR, packageName);

    // Clean
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // 1. Copy project files
    console.log('📁 Copying project files...');
    for (const item of INCLUDE) {
        const src = path.join(ROOT, item);
        const dest = path.join(outputDir, 'app', item);
        if (fs.existsSync(src)) {
            await copyRecursive(src, dest);
        }
    }

    // 2. Install production dependencies
    console.log('📦 Installing production dependencies...');
    execSync('npm ci --omit=dev', {
        cwd: path.join(outputDir, 'app'),
        stdio: 'pipe'
    });

    // 3. Download Node.js runtime
    console.log(`⬇️  Downloading Node.js v${NODE_VERSION} for ${platform}-${arch}...`);
    const nodeDir = path.join(outputDir, 'runtime');
    fs.mkdirSync(nodeDir, { recursive: true });

    const nodeUrl = getNodeUrl(platform, arch);
    const nodeArchive = path.join(outputDir, `node.${platform === 'win32' ? 'zip' : 'tar.gz'}`);

    await downloadFile(nodeUrl, nodeArchive);

    // Extract Node.js
    console.log('📂 Extracting Node.js runtime...');
    if (platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${nodeArchive}' -DestinationPath '${nodeDir}' -Force"`, { stdio: 'pipe' });
    } else {
        execSync(`tar -xzf "${nodeArchive}" -C "${nodeDir}" --strip-components=1`, { stdio: 'pipe' });
    }
    fs.unlinkSync(nodeArchive);

    // 4. Create launcher scripts
    console.log('🚀 Creating launcher...');
    if (platform === 'win32') {
        await createWindowsLauncher(outputDir);
    } else {
        await createUnixLauncher(outputDir, platform);
    }

    // 5. Package final archive
    console.log('📦 Creating distributable...');
    if (platform === 'win32') {
        const zipName = `${packageName}.zip`;
        execSync(`powershell -Command "Compress-Archive -Path '${outputDir}/*' -DestinationPath '${path.join(DIST_DIR, zipName)}' -Force"`, { stdio: 'pipe' });
        console.log(`\n✅ Built: dist/${zipName}`);
    } else {
        const tarName = `${packageName}.tar.gz`;
        execSync(`tar -czf "${path.join(DIST_DIR, tarName)}" -C "${DIST_DIR}" "${packageName}"`, { stdio: 'pipe' });
        console.log(`\n✅ Built: dist/${tarName}`);
    }
}

async function createWindowsLauncher(outputDir) {
    const bat = `@echo off
title VCPtoolbox-Junior
echo Starting VCPtoolbox-Junior...
set "NODE=%~dp0runtime\\node-v${NODE_VERSION}-win-${arch}\\node.exe"
set "APP=%~dp0app\\build\\launcher.js"
"%NODE%" "%APP%"
pause
`;
    fs.writeFileSync(path.join(outputDir, 'VCPtoolbox-Junior.bat'), bat);

    // Also create a simple .cmd for double-click
    fs.writeFileSync(path.join(outputDir, 'start.cmd'), bat);
}

async function createUnixLauncher(outputDir, plat) {
    const sh = `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$DIR/runtime/bin/node"
APP="$DIR/app/build/launcher.js"

if [ ! -f "$NODE" ]; then
    echo "Error: Node.js runtime not found at $NODE"
    exit 1
fi

chmod +x "$NODE"
exec "$NODE" "$APP" "$@"
`;
    const launcherPath = path.join(outputDir, 'vcp-junior');
    fs.writeFileSync(launcherPath, sh, { mode: 0o755 });
}

async function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src);
        for (const entry of entries) {
            if (EXCLUDE_PATTERNS.some(p => entry === p || entry.match(p))) continue;
            await copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const client = url.startsWith('https') ? https : http;

        client.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                file.close();
                fs.unlinkSync(destPath);
                downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => {
            fs.unlinkSync(destPath);
            reject(err);
        });
    });
}

main().catch(err => {
    console.error('❌ Build failed:', err);
    process.exit(1);
});
