#!/usr/bin/env node
/**
 * VCPtoolbox-Junior Launcher
 * 统一启动入口：同时启动主服务和管理面板进程
 */
const { spawn, fork } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SERVER_JS = path.join(ROOT, 'server.js');
const ADMIN_JS = path.join(ROOT, 'adminServer.js');
const CONFIG_FILE = path.join(ROOT, 'config.env');
const CONFIG_EXAMPLE = path.join(ROOT, 'config.env.example');

// Ensure config.env exists
if (!fs.existsSync(CONFIG_FILE)) {
    if (fs.existsSync(CONFIG_EXAMPLE)) {
        fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_FILE);
        console.log('[Launcher] config.env created from example. Please edit it with your API keys.');
        console.log(`[Launcher] Config location: ${CONFIG_FILE}`);
        console.log('[Launcher] Starting with default config...\n');
    } else {
        console.error('[Launcher] ERROR: config.env.example not found!');
        process.exit(1);
    }
}

console.log('╔══════════════════════════════════════════════╗');
console.log('║       VCPtoolbox-Junior Starting...         ║');
console.log('╚══════════════════════════════════════════════╝\n');

// Start main server
const server = fork(SERVER_JS, [], { cwd: ROOT, stdio: 'inherit' });
server.on('error', (err) => {
    console.error('[Launcher] Main server error:', err.message);
});

// Start admin server (delayed to avoid port race)
setTimeout(() => {
    const admin = fork(ADMIN_JS, [], { cwd: ROOT, stdio: 'inherit' });
    admin.on('error', (err) => {
        console.error('[Launcher] Admin server error:', err.message);
    });

    // Handle shutdown
    const shutdown = () => {
        console.log('\n[Launcher] Shutting down...');
        server.kill('SIGTERM');
        admin.kill('SIGTERM');
        setTimeout(() => process.exit(0), 2000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}, 2000);

server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
        console.error(`[Launcher] Main server exited with code ${code}`);
        process.exit(code);
    }
});
