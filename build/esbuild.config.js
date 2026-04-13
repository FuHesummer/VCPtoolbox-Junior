#!/usr/bin/env node
/**
 * esbuild bundler config for VCPtoolbox-Junior
 *
 * Bundles all JS source + npm dependencies into a single file,
 * excluding native modules (.node) and ESM-only modules.
 *
 * Output: dist/server.bundle.js
 * Usage: node build/esbuild.config.js
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Native modules that cannot be bundled (contain .node binaries)
const NATIVE_EXTERNALS = [
    'better-sqlite3',
    'hnswlib-node',
    '@node-rs/jieba',
    '@napi-rs/canvas',
    'fsevents',     // macOS-only native module
    'node-fetch',   // ESM-only, must stay external for dynamic import()
];

// Also treat rust-vexus-lite as external (loaded from relative path)
// Plugin system uses dynamic require() so plugins stay on disk

async function build() {
    const outfile = path.join(ROOT, 'dist', 'server.bundle.js');

    console.log('📦 Bundling with esbuild...');
    console.log(`   Externals: ${NATIVE_EXTERNALS.join(', ')}`);

    const result = await esbuild.build({
        entryPoints: [path.join(ROOT, 'server.js')],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        outfile,

        // Keep native modules external — they'll be copied alongside
        external: [
            ...NATIVE_EXTERNALS,
            // Patterns for our own native module
            './rust-vexus-lite/*',
            '../rust-vexus-lite/*',
        ],

        // Don't bundle Node.js built-ins
        // (esbuild handles this automatically with platform: 'node')

        // Source map for debugging (optional, can remove for prod)
        sourcemap: false,

        // Minify for smaller output
        minify: true,

        // Keep class/function names for error messages
        keepNames: true,

        // Handle __dirname/__filename for bundled code
        define: {
            '__bundled': 'true',
        },

        // Banner: restore __dirname for the bundle entry
        banner: {
            js: [
                '// VCPtoolbox-Junior — bundled with esbuild',
                '// Native modules loaded from node_modules/ alongside this file',
                '',
            ].join('\n'),
        },

        // Log level
        logLevel: 'info',
    });

    const stat = fs.statSync(outfile);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`✅ Bundle: dist/server.bundle.js (${sizeMB} MB)`);

    if (result.errors.length > 0) {
        console.error('❌ Build errors:', result.errors);
        process.exit(1);
    }

    if (result.warnings.length > 0) {
        console.warn(`⚠️  ${result.warnings.length} warnings`);
    }
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
