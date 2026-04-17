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

// Modules that cannot be bundled — native binaries, WASM, or ESM-only
// These are resolved at runtime via Module.createRequire() for SEA compatibility
const NATIVE_EXTERNALS = [
    'better-sqlite3',
    'hnswlib-node',
    '@node-rs/jieba',
    '@napi-rs/canvas',
    'fsevents',
    'node-fetch',
    '@dqbd/tiktoken',  // loads tiktoken_bg.wasm via __dirname
];

/**
 * SEA-compatible native module plugin.
 *
 * In Node.js SEA mode, the built-in `require` (embedderRequire) can only
 * load built-in modules. npm packages like better-sqlite3 need a real
 * require created via Module.createRequire().
 *
 * This plugin intercepts imports of native/external modules at build time
 * and replaces them with a shim that uses createRequire at runtime.
 * Works in both normal Node.js and SEA mode.
 */
const seaNativePlugin = {
    name: 'sea-native-resolver',
    setup(build) {
        // Build regex matching all native externals
        const escaped = NATIVE_EXTERNALS
            .map(m => m.replace(/[.*+?^${}()|[\]\\/@]/g, '\\$&'));
        const nativePattern = new RegExp(
            '^(' + escaped.join('|') + ')(/.*)?$'
        );

        // Intercept native module imports → virtual shim
        build.onResolve({ filter: nativePattern }, (args) => ({
            path: args.path,
            namespace: 'sea-native',
        }));

        // Intercept rust-vexus-lite (relative paths from various source files)
        build.onResolve({ filter: /[./]*rust-vexus-lite/ }, (args) => ({
            path: './rust-vexus-lite',
            namespace: 'sea-native',
        }));

        // Generate shim code that uses Module.createRequire()
        build.onLoad({ filter: /.*/, namespace: 'sea-native' }, (args) => ({
            contents: [
                'var _m = require("module");',
                'var _r = _m.createRequire(__filename || process.execPath);',
                `module.exports = _r(${JSON.stringify(args.path)});`,
            ].join('\n'),
            loader: 'js',
        }));
    },
};

async function build() {
    fs.mkdirSync(DIST, { recursive: true });

    // Write combined entry point (temp file, cleaned up after build)
    const entryFile = path.join(__dirname, '_combined-entry.js');
    fs.writeFileSync(entryFile, [
        '// VCPtoolbox-Junior — combined entry (server + admin, single process)',
        '',
        '// 🔑 SEA 兼容：__dirname 在 SEA 里是虚拟路径，必须用 cwd 作为项目根',
        '// pm2 的 exec_cwd 和用户 cd 到安装目录后的 cwd 都是正确的项目根',
        "process.env.VCP_ROOT = process.env.VCP_ROOT || process.cwd();",
        '',
        '// 🔑 让 Node.js 原生 http/https 自动读 HTTPS_PROXY / HTTP_PROXY 环境变量',
        '// Node.js 默认不走系统代理，global-agent bootstrap 会 patch http/https 模块',
        "if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {",
        "    try { require('global-agent/bootstrap'); } catch(e) { console.warn('[Proxy] global-agent 未加载:', e.message); }",
        "}",
        '',
        '// 🔑 CRITICAL: dotenv 必须最先加载',
        '// esbuild bundle 把所有模块合并，模块级代码按依赖顺序执行；',
        '// panelUpdater.js 有模块级 const PANEL_DISABLED = process.env.PANEL_RELEASE_URL===disabled，',
        '// 若 dotenv.config 在 server.js 模块级且晚于 panelUpdater 初始化，',
        '// PANEL_DISABLED 会被误判为 false → adminServer 的 ensurePanel 去下载',
        '// GitHub Release 超时 → app.listen 永不触发 → AdminPanel HTTP 000。',
        "require('dotenv').config({ path: 'config.env' });",
        '',
        "require('../server.js');",
        'setTimeout(() => {',
        "    console.log('[Combined] ⏳ Loading adminServer...');",
        '    try {',
        "        require('../adminServer.js');",
        "        console.log('[Combined] ✅ adminServer.js require 完成（IIFE 已调度，等待 app.listen）');",
        '    } catch (e) {',
        "        console.error('[Combined] ❌ Admin server require 失败:', e.message);",
        '        console.error(e.stack);',
        '    }',
        '}, 3000);',
        "process.on('unhandledRejection', (reason, p) => {",
        "    console.error('[Combined] ❌ unhandledRejection:', reason && reason.message ? reason.message : reason);",
        "    if (reason && reason.stack) console.error(reason.stack);",
        '});',
    ].join('\n'));

    // SEA dynamic require patch:
    // esbuild plugin handles static requires (e.g. require("better-sqlite3")).
    // But dynamic requires with variable paths (e.g. require(modulePath) in
    // Plugin.js and adminPanelRoutes.js) are left as-is by esbuild. In SEA
    // mode these hit embedderRequire which only handles builtins.
    // This banner patches require to fallback to createRequire for those.
    const SEA_BANNER = [
        ';(function(){',
        'var _M=require("module");',
        'if(_M.createRequire){',
        'var _O=require,_C=_M.createRequire(__filename||process.execPath);',
        'require=function(i){try{return _O(i)}catch(e){',
        'if(e.code==="ERR_UNKNOWN_BUILTIN_MODULE")return _C(i);throw e}};',
        '}',
        '})();',
    ].join('');

    console.log('📦 Bundling server + admin into single bundle...');
    await esbuild.build({
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        // pm2: optional, try/catch in system.js; its dep tree breaks esbuild
        external: ['pm2'],
        plugins: [seaNativePlugin],
        sourcemap: false,
        minify: true,
        keepNames: true,
        logLevel: 'info',
        entryPoints: [entryFile],
        outfile: path.join(DIST, 'vcp.bundle.js'),
        banner: { js: SEA_BANNER },
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
