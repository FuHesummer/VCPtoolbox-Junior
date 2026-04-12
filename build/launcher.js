#!/usr/bin/env node
/**
 * VCPtoolbox-Junior Launcher
 * 统一启动入口：同时启动主服务和管理面板进程
 */
const { fork } = require('child_process');
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

// Load config to display ports
require('dotenv').config({ path: CONFIG_FILE });
const PORT = parseInt(process.env.PORT) || 6005;
const ADMIN_PORT = PORT + 1;

console.log('╔══════════════════════════════════════════════════╗');
console.log('║         VCPtoolbox-Junior Starting...           ║');
console.log('╠═════════════���════════════════════════════��═══════╣');
console.log(`║  Main Server  : http://localhost:${PORT}             ║`);
console.log(`║  Admin Panel  : http://localhost:${ADMIN_PORT}/AdminPanel/  ║`);
console.log('╚══════════���════════════════════════════���══════════╝\n');

let server = null;
let admin = null;

// Graceful shutdown handler
const shutdown = () => {
    console.log('\n[Launcher] Shutting down...');
    if (server) server.kill('SIGTERM');
    if (admin) admin.kill('SIGTERM');
    setTimeout(() => process.exit(0), 3000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start main server
server = fork(SERVER_JS, [], { cwd: ROOT, stdio: 'inherit' });
server.on('error', (err) => {
    console.error('[Launcher] Main server error:', err.message);
});
server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
        console.error(`[Launcher] Main server exited with code ${code}`);
        process.exit(code);
    }
});

// Start admin server (delayed to let main server bind port first)
setTimeout(() => {
    admin = fork(ADMIN_JS, [], { cwd: ROOT, stdio: 'inherit' });
    admin.on('error', (err) => {
        console.error('[Launcher] Admin panel error:', err.message);
    });
    admin.on('exit', (code) => {
        if (code !== 0 && code !== null) {
            console.warn(`[Launcher] Admin panel exited with code ${code} (non-fatal)`);
        }
    });
}, 3000);
