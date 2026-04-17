const express = require('express');
const fs = require('fs').promises;
const path = require('path');

module.exports = function(options) {
    const router = express.Router();
    const { pluginManager } = options;

    // POST to restart the server
    // 支持两种模式：
    //   pm2 模式：process.exit(1) → pm2 检测 exit code 自动拉起
    //   裸跑模式：spawn 自己 → 新进程接管 → 旧进程退出
    router.post('/server/restart', async (req, res) => {
        const isInPM2 = ('PM2_HOME' in process.env) || ('pm_id' in process.env);
        res.json({ message: isInPM2
            ? '重启命令已接纳，pm2 将自动重启服务。'
            : '重启命令已接纳，正在启动新进程...'
        });

        setTimeout(() => {
            console.log(`[Restart] 模式: ${isInPM2 ? 'pm2' : '裸跑 spawn'}，500ms 后执行`);

            if (!isInPM2) {
                // 裸跑模式：spawn 新进程替代自己（SEA exe 或 node server.js）
                try {
                    const { spawn } = require('child_process');
                    const child = spawn(process.execPath, process.argv.slice(1), {
                        cwd: process.cwd(),
                        stdio: 'inherit',
                        detached: true,
                        env: process.env
                    });
                    child.unref();
                    console.log(`[Restart] 新进程已 spawn (PID ${child.pid})，旧进程退出`);
                } catch (e) {
                    console.error('[Restart] spawn 失败:', e.message);
                }
            }

            // 无论哪种模式，都 exit（pm2 会拉起；裸跑新进程已接管）
            setTimeout(() => process.exit(1), 1000).unref();
        }, 500);
    });

    // 验证登录端点
    router.post('/verify-login', (req, res) => {
        if (req.headers.authorization) {
            const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
            const cookieOptions = [
                `admin_auth=${encodeURIComponent(req.headers.authorization)}`,
                'Path=/',
                'HttpOnly',
                'SameSite=Strict',
                'Max-Age=86400'
            ];

            if (isSecure) {
                cookieOptions.push('Secure');
            }

            res.setHeader('Set-Cookie', cookieOptions.join('; '));
        }

        res.status(200).json({
            status: 'success',
            message: 'Authentication successful'
        });
    });

    // 登出端点
    router.post('/logout', (req, res) => {
        res.setHeader('Set-Cookie', 'admin_auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        res.status(200).json({ status: 'success', message: 'Logged out' });
    });

    // 检查认证状态端点
    router.get('/check-auth', (req, res) => {
        res.status(200).json({ authenticated: true });
    });

    return router;
};
