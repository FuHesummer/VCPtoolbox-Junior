#!/usr/bin/env node
/**
 * esbuild bundler for VCPtoolbox-Junior
 *
 * Produces a single combined bundle:
 *   dist/vcp.bundle.js — server + admin in one process
 *
 * Usage: node build/esbuild.config.js
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Native modules that cannot be bundled (contain .node binaries)
const NATIVE_EXTERNALS = [
    'better-sqlite3',
    'hnswlib-node',
    '@node-rs/jieba',
    '@napi-rs/canvas',
    'fsevents',
    'node-fetch',
];

// SEA compatibility banner:
// In SEA mode, the built-in `require` (embedderRequire) can only load
// Node.js built-in modules. External npm packages like better-sqlite3
// need Module.createRequire() to resolve from node_modules/.
// This banner patches `require` so externals work in both normal and SEA mode.
const SEA_REQUIRE_BANNER = [
    '// SEA require patch — enables node_modules resolution in embedded mode',
    ';var _seaM=require("module");',
    'if(_seaM.createRequire){',
    '  var _seaOrig=require,',
    '      _seaCR=_seaM.createRequire(__filename||process.execPath);',
    '  require=function(id){',
    '    try{return _seaOrig(id)}',
    '    catch(e){if(e.code==="ERR_UNKNOWN_BUILTIN_MODULE")return _seaCR(id);throw e}',
    '  };',
    '}',
].join('');

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

    // Write combined entry point (temp file, cleaned up after build)
    // server.js self-starts on require; adminServer.js starts 3s later
    const entryFile = path.join(__dirname, '_combined-entry.js');
    fs.writeFileSync(entryFile, [
        '// VCPtoolbox-Junior — combined entry (server + admin, single process)',
        "require('../server.js');",
        'setTimeout(() => {',
        "    try { require('../adminServer.js'); }",
        "    catch (e) { console.error('[Combined] Admin server failed:', e.message); }",
        '}, 3000);',
    ].join('\n'));

    console.log('📦 Bundling server + admin into single bundle...');
    await esbuild.build({
        ...SHARED_OPTIONS,
        entryPoints: [entryFile],
        outfile: path.join(DIST, 'vcp.bundle.js'),
        banner: { js: SEA_REQUIRE_BANNER },
    });

    // Cleanup temp entry
    try { fs.unlinkSync(entryFile); } catch {}

    // Report size
    const bundlePath = path.join(DIST, 'vcp.bundle.js');
    if (fs.existsSync(bundlePath)) {
        const mb = (fs.statSync(bundlePath).size / 1024 / 1024).toFixed(2);
        console.log(`\n✅ Build complete: vcp.bundle.js — ${mb} MB`);
    }
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
