#!/usr/bin/env node
/**
 * esbuild bundler for VCPtoolbox-Junior
 *
 * Produces 3 files:
 *   dist/launcher.bundle.js  — SEA entry: startup + fork admin
 *   dist/server.bundle.js    — main server (forked by launcher)
 *   dist/admin.bundle.js     — admin panel server (forked by launcher)
 *
 * Usage: node build/esbuild.config.js
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Native modules that cannot be bundled
const NATIVE_EXTERNALS = [
    'better-sqlite3',
    'hnswlib-node',
    '@node-rs/jieba',
    '@napi-rs/canvas',
    'fsevents',
    'node-fetch',
];

const SHARED_OPTIONS = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: [
        ...NATIVE_EXTERNALS,
        './rust-vexus-lite/*',
        '../rust-vexus-lite/*',
    ],
    sourcemap: false,
    minify: true,
    keepNames: true,
    logLevel: 'info',
};

async function build() {
    fs.mkdirSync(DIST, { recursive: true });

    // 1. Bundle server.js
    console.log('📦 [1/3] Bundling server.js...');
    await esbuild.build({
        ...SHARED_OPTIONS,
        entryPoints: [path.join(ROOT, 'server.js')],
        outfile: path.join(DIST, 'server.bundle.js'),
        banner: { js: '// VCPtoolbox-Junior server bundle' },
    });

    // 2. Bundle adminServer.js
    console.log('📦 [2/3] Bundling adminServer.js...');
    await esbuild.build({
        ...SHARED_OPTIONS,
        entryPoints: [path.join(ROOT, 'adminServer.js')],
        outfile: path.join(DIST, 'admin.bundle.js'),
        banner: { js: '// VCPtoolbox-Junior admin panel bundle' },
    });

    // 3. Write launcher (thin wrapper, no bundle needed)
    console.log('📦 [3/3] Writing launcher...');
    const launcherCode = `#!/usr/bin/env node
// VCPtoolbox-Junior Launcher — SEA entry point
// Starts server.bundle.js + admin.bundle.js as child processes
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve paths relative to the executable location
const EXE_DIR = path.dirname(process.execPath);
const ROOT = EXE_DIR; // In packaged mode, exe sits in the root

const SERVER_BUNDLE = path.join(ROOT, 'server.bundle.js');
const ADMIN_BUNDLE = path.join(ROOT, 'admin.bundle.js');
const CONFIG_FILE = path.join(ROOT, 'config.env');
const CONFIG_EXAMPLE = path.join(ROOT, 'config.env.example');

// Auto-create config.env from example on first run
if (!fs.existsSync(CONFIG_FILE) && fs.existsSync(CONFIG_EXAMPLE)) {
    fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_FILE);
    console.log('[Launcher] config.env created from example. Please edit it.');
}

// Load config for port display
try { require('dotenv').config({ path: CONFIG_FILE }); } catch {}
const PORT = parseInt(process.env.PORT) || 6005;
const ADMIN_PORT = PORT + 1;

console.log('');
console.log('  VCPtoolbox-Junior');
console.log('  ─────────────────────────────────');
console.log('  Main Server : http://localhost:' + PORT);
console.log('  Admin Panel : http://localhost:' + ADMIN_PORT + '/AdminPanel/');
console.log('  ─────────────────────────────────');
console.log('');

let server = null;
let admin = null;

const shutdown = () => {
    console.log('\\n[Launcher] Shutting down...');
    if (server) server.kill('SIGTERM');
    if (admin) admin.kill('SIGTERM');
    setTimeout(() => process.exit(0), 3000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start main server
if (fs.existsSync(SERVER_BUNDLE)) {
    server = fork(SERVER_BUNDLE, [], { cwd: ROOT, stdio: 'inherit' });
    server.on('error', (e) => console.error('[Launcher] Server error:', e.message));
    server.on('exit', (code) => {
        if (code && code !== 0) { console.error('[Launcher] Server exited:', code); process.exit(code); }
    });
} else {
    console.error('[Launcher] server.bundle.js not found at', SERVER_BUNDLE);
    process.exit(1);
}

// Start admin panel (delayed)
setTimeout(() => {
    if (fs.existsSync(ADMIN_BUNDLE)) {
        admin = fork(ADMIN_BUNDLE, [], { cwd: ROOT, stdio: 'inherit' });
        admin.on('error', (e) => console.error('[Launcher] Admin error:', e.message));
        admin.on('exit', (code) => {
            if (code && code !== 0) console.warn('[Launcher] Admin exited:', code);
        });
    } else {
        console.warn('[Launcher] admin.bundle.js not found, admin panel disabled');
    }
}, 3000);
`;

    fs.writeFileSync(path.join(DIST, 'launcher.bundle.js'), launcherCode);

    // Report sizes
    console.log('\n✅ Build complete:');
    for (const f of ['server.bundle.js', 'admin.bundle.js', 'launcher.bundle.js']) {
        const fp = path.join(DIST, f);
        if (fs.existsSync(fp)) {
            const mb = (fs.statSync(fp).size / 1024 / 1024).toFixed(2);
            console.log(`   ${f.padEnd(25)} ${mb} MB`);
        }
    }
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
