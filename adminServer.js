// adminServer.js
// 独立后台管理面板进程，监听 PORT+1
// 目的：将 AdminPanel 与聊天主链解耦，避免主进程 SSE stall 时后台面板一起卡顿
const express = require('express');
const dotenv = require('dotenv');
dotenv.config({ path: 'config.env' });

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const http = require('http');
const basicAuth = require('basic-auth');
const cors = require('cors');

const MAIN_PORT = parseInt(process.env.PORT) || 3000;
const ADMIN_PORT = MAIN_PORT + 1;
const DEBUG_MODE = (process.env.DebugMode || 'False').toLowerCase() === 'true';

const ADMIN_USERNAME = process.env.AdminUsername;
const ADMIN_PASSWORD = process.env.AdminPassword;

// ============================================================
// 登录防暴力破解（改进版：cookie 过期不计入 + 私有 IP 豁免）
// ============================================================
const loginAttempts = new Map();
const tempBlocks = new Map();
const noCredentialAccess = new Map();
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_NO_CREDENTIAL_REQUESTS = 100;
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000;
const TEMP_BLOCK_DURATION = 30 * 60 * 1000;
const NO_CREDENTIAL_BLOCK_DURATION = 15 * 60 * 1000;

// ============================================================
// Express App
// ============================================================
const app = express();
app.set('trust proxy', true);
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '300mb' }));
app.use(express.urlencoded({ limit: '300mb', extended: true }));
app.use(express.text({ limit: '300mb', type: 'text/plain' }));

// ============================================================
// Admin Authentication Middleware (从 server.js 复制并精简)
// ============================================================
const adminAuth = (req, res, next) => {
    // 登录页 + 静态资源白名单（精确路径）
    const publicPaths = [
        '/AdminPanel',                // Vue SPA 根路径
        '/AdminPanel/',
        '/AdminPanel/login',          // Vue Router 登录路径
        '/AdminPanel/index.html',     // SPA 入口
        '/AdminPanel/VCPLogo2.png',
        '/AdminPanel/favicon.ico',
    ];
    // 前缀白名单（Vite 打包资源 + 插件基座）
    const publicPrefixes = [
        '/AdminPanel/assets/',
        '/plugin-shell/',
    ];

    const isVerifyEndpoint = req.path === '/admin_api/verify-login';

    const readOnlyDashboardPaths = [
        '/admin_api/system-monitor',
        '/admin_api/newapi-monitor',
        '/admin_api/server-log',
        '/admin_api/user-auth-code',
        '/admin_api/weather'
    ];
    const isReadOnlyPath = readOnlyDashboardPaths.some(p => req.path.startsWith(p));

    if (publicPaths.includes(req.path) || publicPrefixes.some(p => req.path.startsWith(p))) {
        return next();
    }

    // IP 提取：优先 X-Forwarded-For / X-Real-IP，再 fallback req.ip
    let clientIp = req.headers['x-real-ip']
        || (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : null)
        || req.ip;
    if (clientIp && clientIp.startsWith('::ffff:')) {
        clientIp = clientIp.slice(7);
    }

    // 私有/回环 IP 永不封禁（反代、本地访问）
    const isPrivateIp = clientIp === '127.0.0.1' || clientIp === '::1'
        || clientIp.startsWith('10.') || clientIp.startsWith('172.')
        || clientIp.startsWith('192.168.') || clientIp === 'localhost';

    // 检查管理员凭据是否已配置
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        console.error('[AdminServer] AdminUsername or AdminPassword not set in config.env.');
        if (req.path.startsWith('/admin_api') || (req.headers.accept && req.headers.accept.includes('application/json'))) {
            return res.status(503).json({ error: 'Admin credentials not configured.' });
        }
        return res.status(503).send('<h1>503</h1><p>Admin credentials not configured.</p>');
    }

    // 检查 IP 是否被临时封禁（私有 IP 豁免，只读接口豁免）
    if (!isPrivateIp) {
        const blockInfo = tempBlocks.get(clientIp);
        if (blockInfo && Date.now() < blockInfo.expires && !isReadOnlyPath) {
            const timeLeft = Math.ceil((blockInfo.expires - Date.now()) / 1000 / 60);
            res.setHeader('Retry-After', Math.ceil((blockInfo.expires - Date.now()) / 1000));
            return res.status(429).json({
                error: 'Too Many Requests',
                message: `您的IP已被暂时封禁。请在 ${timeLeft} 分钟后重试。`
            });
        }
    }

    // 获取凭据（优先 Header，其次 Cookie）
    let credentials = basicAuth(req);
    if (!credentials && req.headers.cookie) {
        const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
            const [key, value] = cookie.trim().split('=');
            acc[key] = value;
            return acc;
        }, {});

        if (cookies.admin_auth) {
            try {
                const authValue = decodeURIComponent(cookies.admin_auth);
                if (authValue.startsWith('Basic ')) {
                    const base64Credentials = authValue.substring(6);
                    const decodedCredentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
                    const [name, pass] = decodedCredentials.split(':');
                    if (name && pass) credentials = { name, pass };
                }
            } catch (e) {
                // ignore
            }
        }
    }

    // 验证凭据
    if (!credentials || credentials.name !== ADMIN_USERNAME || credentials.pass !== ADMIN_PASSWORD) {
        // 封禁计数（私有 IP 豁免）
        if (clientIp && !isPrivateIp && !isReadOnlyPath) {
            const isActiveLoginAttempt = !!credentials;
            if (isActiveLoginAttempt) {
                const now = Date.now();
                let attemptInfo = loginAttempts.get(clientIp) || { count: 0, firstAttempt: now };
                if (now - attemptInfo.firstAttempt > LOGIN_ATTEMPT_WINDOW) {
                    attemptInfo = { count: 0, firstAttempt: now };
                }
                attemptInfo.count++;
                if (attemptInfo.count >= MAX_LOGIN_ATTEMPTS) {
                    tempBlocks.set(clientIp, { expires: now + TEMP_BLOCK_DURATION });
                    loginAttempts.delete(clientIp);
                } else {
                    loginAttempts.set(clientIp, attemptInfo);
                }
            } else {
                const now = Date.now();
                let accessInfo = noCredentialAccess.get(clientIp) || { count: 0, firstAccess: now };
                if (now - accessInfo.firstAccess > LOGIN_ATTEMPT_WINDOW) {
                    accessInfo = { count: 0, firstAccess: now };
                }
                accessInfo.count++;
                if (accessInfo.count >= MAX_NO_CREDENTIAL_REQUESTS) {
                    tempBlocks.set(clientIp, { expires: now + NO_CREDENTIAL_BLOCK_DURATION });
                    noCredentialAccess.delete(clientIp);
                } else {
                    noCredentialAccess.set(clientIp, accessInfo);
                }
            }
        }

        if (isVerifyEndpoint || req.path.startsWith('/admin_api') ||
            (req.headers.accept && req.headers.accept.includes('application/json'))) {
            return res.status(401).json({ error: 'Unauthorized' });
        } else if (req.path.startsWith('/AdminPanel')) {
            return res.redirect('/AdminPanel/login');
        } else {
            res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
            return res.status(401).send('<h1>401 Unauthorized</h1>');
        }
    }

    // 认证成功
    if (clientIp) loginAttempts.delete(clientIp);
    return next();
};

app.use(adminAuth);

// ============================================================
// 静态面板挂载（ADMIN_PANEL_SOURCE 可配置，支持多面板切换）
// 按优先级查找候选目录，第一个有效的挂到 /AdminPanel/*
//
// 🔑 注意：此函数必须在 ensurePanel() 下载完成后才能调用，
// 否则首次启动时 panelUpdater 下载的目录还没文件，candidates 全 miss → fallback。
// ============================================================
let mountedPanelPath = null;
function mountAdminPanel() {
    const configured = (process.env.ADMIN_PANEL_SOURCE || '').trim();
    const candidates = [];

    // 1. 用户明确配置的路径（可绝对可相对）
    // SEA 兼容：相对路径基于 VCP_ROOT 而非 __dirname
    const resolveBase = process.env.VCP_ROOT || process.cwd();
    if (configured) {
        candidates.push({
            path: path.isAbsolute(configured) ? configured : path.resolve(resolveBase, configured),
            source: 'ADMIN_PANEL_SOURCE',
        });
    }
    // 2. panelUpdater 下载目录（运行时从 Panel Release 拉到这里）
    //    路径与 modules/panelUpdater.js 的 PANEL_DIR 保持一致
    candidates.push({
        path: path.join(process.env.VCP_ROOT || __dirname, 'AdminPanel'),
        source: 'panelUpdater download',
    });
    // 3. 独立面板仓库的 dist（开发模式：sibling git clone + npm run build）
    candidates.push({
        path: path.resolve(resolveBase, '..', 'VCPtoolbox-Junior-Panel', 'dist'),
        source: 'sibling repo',
    });
    // 4. symlink AdminPanel-Vue/dist（本地 open 的 symlink 指向独立仓库，跟 #3 殊途同归）
    candidates.push({
        path: path.join(resolveBase, 'AdminPanel-Vue', 'dist'),
        source: 'local symlink',
    });

    for (const c of candidates) {
        try {
            const indexPath = path.join(c.path, 'index.html');
            if (fsSync.existsSync(c.path) && fsSync.existsSync(indexPath)) {
                app.use('/AdminPanel', express.static(c.path));
                // SPA history fallback：未命中静态资源的 /AdminPanel/* 路径全部返回 index.html
                // Vue Router 接管客户端路由（/AdminPanel/login、/dashboard 等）
                app.get(/^\/AdminPanel(\/.*)?$/, (req, res) => {
                    res.sendFile(indexPath);
                });
                mountedPanelPath = c.path;
                console.log(`[AdminServer] 面板已挂载: ${c.path} (来源: ${c.source}) + SPA fallback`);
                return;
            }
        } catch (_) { /* ignore */ }
    }

    // 所有候选都失败 → 挂一个提示页
    // 🔑 Express 5 + path-to-regexp v8 不再支持 '/AdminPanel*' 裸通配符语法
    // 必须用正则或 '/AdminPanel/{*rest}' 命名通配符
    app.get(/^\/AdminPanel(\/.*)?$/, (req, res) => {
        res.status(503).set('Content-Type', 'text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>管理面板未配置</title>
<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 20px;background:#faf5f7;color:#3d2c3e;line-height:1.7;}
h1{color:#b91c5c;}code{background:#fff;padding:2px 7px;border-radius:4px;border:1px solid rgba(212,116,142,0.2);}
pre{background:#fff;padding:14px;border-radius:8px;border:1px solid rgba(212,116,142,0.2);overflow-x:auto;}</style></head>
<body><h1>⚠️ 管理面板未配置</h1>
<p>adminServer 未能找到任何可挂载的面板目录。请在 <code>config.env</code> 里配置 <code>ADMIN_PANEL_SOURCE</code>：</p>
<pre># 示例 A：指向同级独立面板仓库（推荐）
ADMIN_PANEL_SOURCE=../VCPtoolbox-Junior-Panel/dist

# 示例 B：从 Release 解压到 data/panel
ADMIN_PANEL_SOURCE=data/panel

# 示例 C：绝对路径
ADMIN_PANEL_SOURCE=/opt/my-custom-panel/dist</pre>
<p>配置后重启 adminServer 即可。详见 <a href="https://github.com/lioensky/VCPToolBox-Junior">Junior 文档</a>。</p>
</body></html>`);
    });
    console.warn('[AdminServer] ⚠ 未找到任何面板目录。/AdminPanel/* 将返回 503 提示页。候选:\n' +
        candidates.map(c => `  - ${c.source}: ${c.path}`).join('\n'));
}

// 默认路由：访问根路径重定向到 AdminPanel
app.get('/', (req, res) => {
    res.redirect('/AdminPanel/index.html');
});

// ============================================================
// 路由分类：本地处理 vs 代理到主进程
// ============================================================

// --- 本地独立处理的模块 ---
// 这些模块仅依赖文件 I/O 和轻量单例，不需要主进程运行态

// SEA 兼容：__dirname 在 SEA 里是虚拟路径，用 VCP_ROOT（server.js 早期设置）
const VCP_ROOT = process.env.VCP_ROOT || process.cwd();

const dailyNoteRootPath = process.env.KNOWLEDGEBASE_ROOT_PATH || path.join(VCP_ROOT, 'knowledge');

// Agent 目录
let AGENT_DIR;
const agentConfigPath = process.env.AGENT_DIR_PATH;
if (!agentConfigPath || typeof agentConfigPath !== 'string' || agentConfigPath.trim() === '') {
    AGENT_DIR = path.join(VCP_ROOT, 'Agent');
} else {
    const normalizedPath = path.normalize(agentConfigPath.trim());
    AGENT_DIR = path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(VCP_ROOT, normalizedPath);
}

// TVStxt 目录
let TVS_DIR;
const tvsConfigPath = process.env.TVSTXT_DIR_PATH;
if (!tvsConfigPath || typeof tvsConfigPath !== 'string' || tvsConfigPath.trim() === '') {
    TVS_DIR = path.join(VCP_ROOT, 'TVStxt');
} else {
    const normalizedPath = path.normalize(tvsConfigPath.trim());
    TVS_DIR = path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(VCP_ROOT, normalizedPath);
}

const localAdminRouter = express.Router();

// 本地可独立运行的模块列表（必须与 localAdminModules 的 key 完全一致）
const localModules = [
    'system',          // PM2/系统资源/认证码/天气/热榜
    'logs',            // 服务器日志读取
    'server',          // 登录/登出/认证状态
    'config',          // config.env / toolApprovalConfig 读写
    'rag',             // RAG 标签/参数/语义组/思维链（文件读写）
    'toolbox',         // Toolbox 映射与文件管理
    'agents',          // Agent 映射与文件管理
    'tvs',             // TVS 变量文件管理
    'schedules',       // 日程管理
    'dailyNotes',      // 日记知识库文件管理
    'dashboardLayout', // 仪表盘布局
    'panelRegistry',   // 面板注册表
    'sarPrompts',      // 模型专属指令
    'migration',       // 迁移向导
    'placeholderRegistry', // 占位符注册表
    'maintenance',     // 运维中心（spawn 维护脚本）
    'updateChecker',   // 后端+面板版本更新检测
];

// 日志路径获取函数（本地计算，不依赖主进程 logger 实例）
// SEA 兼容：用 VCP_ROOT 而非 __dirname
function getCurrentServerLogPath() {
    return path.join(process.env.VCP_ROOT || process.cwd(), 'DebugLog', 'ServerLog.txt');
}

// 轻量 mock pluginManager — 仅为本地 admin 模块提供安全的 no-op 方法
// 例如 config.js 保存后会调用 pluginManager.loadPlugins()
// 在独立后台进程里，这个调用不应该真正执行插件加载，只记录一条日志
const mockPluginManager = {
    plugins: new Map(),
    loadPlugins: async () => {
        console.log('[AdminServer] pluginManager.loadPlugins() called in admin process — skipped (use reload-notify to trigger main process reload).');
    },
    hotReloadPluginsAndOrder: async () => {
        console.log('[AdminServer] pluginManager.hotReloadPluginsAndOrder() called in admin process — proxying to main process is recommended.');
        return [];
    },
    getPreprocessorOrder: () => [],
    getPlugin: () => null,
    getServiceModule: () => null,
    getAllPlaceholderValues: () => new Map(),
    getIndividualPluginDescriptions: () => new Map(),
    getPlaceholderValue: (key) => `[Placeholder ${key} not available in admin process]`,
    getResolvedPluginConfigValue: () => undefined,
};

const localOptions = {
    DEBUG_MODE,
    dailyNoteRootPath,
    pluginManager: mockPluginManager,
    getCurrentServerLogPath,
    vectorDBManager: null,      // vectordb-status 会返回 503，由代理路径覆盖
    agentDirPath: AGENT_DIR,
    cachedEmojiLists: new Map(),
    tvsDirPath: TVS_DIR,
    triggerRestart: (code = 1) => {
        console.log(`[AdminServer] Restarting admin process (exit code: ${code})...`);
        setTimeout(() => process.exit(code), 500);
    }
};

// Static requires — esbuild needs string literals to bundle these modules.
// DO NOT convert back to dynamic require(path.join(...)) — breaks SEA/bundling.
const localAdminModules = {
    system:            require('./routes/admin/system'),
    logs:              require('./routes/admin/logs'),
    server:            require('./routes/admin/server'),
    config:            require('./routes/admin/config'),
    rag:               require('./routes/admin/rag'),
    toolbox:           require('./routes/admin/toolbox'),
    agents:            require('./routes/admin/agents'),
    tvs:               require('./routes/admin/tvs'),
    schedules:         require('./routes/admin/schedules'),
    dailyNotes:        require('./routes/admin/dailyNotes'),
    dashboardLayout:   require('./routes/admin/dashboardLayout'),
    panelRegistry:     require('./routes/admin/panelRegistry'),
    sarPrompts:        require('./routes/admin/sarPrompts'),
    migration:         require('./routes/admin/migration'),
    placeholderRegistry: require('./routes/admin/placeholderRegistry'),
    maintenance:       require('./routes/admin/maintenance'),
    updateChecker:     require('./routes/admin/updateChecker'),
};

for (const [moduleName, moduleFactory] of Object.entries(localAdminModules)) {
    try {
        const routeHandler = moduleFactory(localOptions);
        localAdminRouter.use('/', routeHandler);
        if (DEBUG_MODE) console.log(`[AdminServer] Mounted local module: ${moduleName}`);
    } catch (error) {
        console.error(`[AdminServer] Failed to load local module "${moduleName}":`, error.message);
    }
}

// ============================================================
// 🔑 关键覆盖：重启主服务（必须在本地路由之前挂载）
// 本地 routes/admin/server.js 的 /server/restart 会 process.exit(1) 杀死当前进程
// 在独立后台进程里，这个行为需要被重定向为"通知主进程重启"
// ============================================================
app.post('/admin_api/server/restart', async (req, res) => {
    console.log('[AdminServer] Restart request received — forwarding to main process...');
    res.json({ message: '正在通知主服务重启。管理面板将保持运行。' });

    // 通过 HTTP 请求通知主进程自行重启
    setTimeout(() => {
        const restartReq = http.request(
            `http://127.0.0.1:${MAIN_PORT}/admin_api/server/restart`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || '',
                    'Cookie': req.headers.cookie || ''
                },
                timeout: 5000
            },
            (restartRes) => {
                console.log(`[AdminServer] Main process restart response: ${restartRes.statusCode}`);
            }
        );
        restartReq.on('error', (err) => {
            // 预期会出错：主进程收到后会执行 process.exit(1)，连接会断
            console.log(`[AdminServer] Main process restart signal sent (connection closed as expected: ${err.code || err.message})`);
        });
        restartReq.write('{}');
        restartReq.end();
    }, 300);
});

// 当前挂载的面板路径（adminServer 独占知识，不走反代）
app.get('/admin_api/panel/current', (req, res) => {
    res.json({
        success: true,
        mounted: mountedPanelPath,
        source: process.env.ADMIN_PANEL_SOURCE || null,
        fallbackUsed: !process.env.ADMIN_PANEL_SOURCE && mountedPanelPath !== null,
    });
});

app.use('/admin_api', localAdminRouter);

// 🖼️ 图床 / 文件床请求代理（给 AdminPanel 显示缩略图用）
// 主服务的 ImageServer / FileServer 处理 /pw=<Image_Key>/images/* 和 /pw=<File_Key>/files/*
// adminServer 本身不处理这些路径，需要透传给主服务
app.use((req, res, next) => {
    if (!/^\/pw=[^/]+\/(images|files)\//.test(req.path)) return next();
    const queryString = require('url').parse(req.url).search || '';
    const targetUrl = `http://127.0.0.1:${MAIN_PORT}${req.path}${queryString}`;
    const proxyOptions = {
        method: req.method,
        headers: { ...req.headers },
        timeout: 30000,
    };
    delete proxyOptions.headers['host'];
    delete proxyOptions.headers['content-length'];
    const proxyReq = http.request(targetUrl, proxyOptions, (proxyRes) => {
        res.status(proxyRes.statusCode);
        for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) res.setHeader(k, v);
        }
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
        if (!res.headersSent) {
            res.status(502).send(`Image/File proxy error: ${err.message}`);
        }
    });
    req.pipe(proxyReq);
});

// ============================================================
// 代理到主进程的模块
// 这些模块强依赖 pluginManager / vectorDBManager 运行态
// 通过 HTTP 反向代理到主进程的 /admin_api/* 接口
// ============================================================

// 🌟 兜底代理：任何本地路由未处理的 /admin_api 请求都转发给主进程
// 这包括插件通过 registerRoutes 注册到 adminApiRouter 的动态路由
// 例如 /admin_api/vcptavern/*, /admin_api/forum/*, 等等
app.use('/admin_api', (req, res, next) => {
    // 如果响应已经被发送（由本地路由处理），则跳过
    if (res.headersSent) return;

    // 构建代理请求
    const fullPath = '/admin_api' + req.path;
    const queryString = require('url').parse(req.url).search || '';
    const targetUrl = `http://127.0.0.1:${MAIN_PORT}${fullPath}`;
    const proxyUrl = targetUrl + queryString;

    if (DEBUG_MODE) console.log(`[AdminServer Proxy] ${req.method} ${fullPath} -> ${proxyUrl}`);

    const proxyOptions = {
        method: req.method,
        headers: { ...req.headers },
        timeout: 30000,
    };

    // 移除可能干扰的 headers
    delete proxyOptions.headers['host'];
    delete proxyOptions.headers['content-length'];

    const proxyReq = http.request(proxyUrl, proxyOptions, (proxyRes) => {
        res.status(proxyRes.statusCode);
        // 复制响应头
        for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
                res.setHeader(key, value);
            }
        }
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error(`[AdminServer Proxy] Error proxying to main process: ${err.message}`);
        if (!res.headersSent) {
            res.status(502).json({
                error: 'Bad Gateway',
                message: `无法连接到主服务 (PORT ${MAIN_PORT})。主服务可能未启动或正在重启中。`,
                details: err.message
            });
        }
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
            res.status(504).json({
                error: 'Gateway Timeout',
                message: '主服务响应超时。主服务可能正在处理重负载。'
            });
        }
    });

    // 转发请求体（空 body 的 POST/PUT/DELETE 不写入，避免 JSON.stringify(undefined) 引发 TypeError）
    // 🔑 Express 已将 req.body 解析为 JS 对象，必须重新序列化为 JSON 字符串
    // 并正确设置 Content-Length（按字节计算），否则主进程收到的是双重序列化的字符串
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.body !== undefined && req.body !== null) {
            let bodyData;
            if (typeof req.body === 'string') {
                // text/plain 等已经是字符串的 body，直接透传
                bodyData = req.body;
            } else {
                bodyData = JSON.stringify(req.body);
            }
            if (bodyData !== undefined) {
                const bodyBuffer = Buffer.from(bodyData, 'utf-8');
                proxyReq.setHeader('Content-Type', req.headers['content-type'] || 'application/json');
                proxyReq.setHeader('Content-Length', bodyBuffer.length);
                proxyReq.write(bodyBuffer);
            }
        }
    }

    proxyReq.end();
});

// ============================================================
// 特殊处理：config/main 保存后通知主进程重载
// 前端可调用此端点，在本地写完文件后额外通知主进程
// ============================================================
app.post('/admin_api/config/main/reload-notify', async (req, res) => {
    try {
        // 通知主进程重新加载插件（fire-and-forget）
        const notifyReq = http.request(
            `http://127.0.0.1:${MAIN_PORT}/admin_api/config/main`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || '',
                    'Cookie': req.headers.cookie || ''
                },
                timeout: 10000
            },
            (notifyRes) => {
                let body = '';
                notifyRes.on('data', chunk => body += chunk);
                notifyRes.on('end', () => {
                    res.json({ success: true, message: '配置已保存，主服务已通知重载。' });
                });
            }
        );
        notifyReq.on('error', (err) => {
            // 主进程可能不可达，但本地文件已保存
            res.json({ success: true, message: '配置已保存到文件，但主服务通知失败（可能需要手动重启）。', warning: err.message });
        });
        notifyReq.write(JSON.stringify(req.body));
        notifyReq.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// 启动服务器（顺序：下载 Panel Release → 挂载静态 → listen）
// 🔑 mountAdminPanel 必须在 ensurePanel 之后，否则候选目录空，走 fallback
// ============================================================
const { ensurePanel } = require('./modules/panelUpdater');

(async () => {
    await ensurePanel({ silent: false });
    mountAdminPanel();
    app.listen(ADMIN_PORT, () => {
        console.log(`[AdminServer] 管理面板独立进程已启动，监听端口 ${ADMIN_PORT}`);
        console.log(`[AdminServer] 管理面板地址: http://localhost:${ADMIN_PORT}/AdminPanel/`);
        console.log(`[AdminServer] 主服务地址: http://localhost:${MAIN_PORT}`);
        console.log(`[AdminServer] 本地处理模块: ${localModules.join(', ')}`);
        console.log(`[AdminServer] 未匹配的 /admin_api 请求将自动代理到主进程 PORT ${MAIN_PORT}`);
    });
})();