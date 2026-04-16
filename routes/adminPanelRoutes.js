const express = require('express');
const fs = require('fs').promises;
const path = require('path');

/**
 * Admin Panel API Routes
 * This file has been modularized. individual route handlers are located in ./admin/*.js
 */
module.exports = function (DEBUG_MODE, dailyNoteRootPath, pluginManager, getCurrentServerLogPath, vectorDBManager, agentDirPath, cachedEmojiLists, tvsDirPath, triggerRestart) {
    if (!agentDirPath || typeof agentDirPath !== 'string') {
        throw new Error('[AdminPanelRoutes] agentDirPath must be a non-empty string');
    }
    if (!tvsDirPath || typeof tvsDirPath !== 'string') {
        throw new Error('[AdminPanelRoutes] tvsDirPath must be a non-empty string');
    }
    if (typeof triggerRestart !== 'function') {
        console.warn('[AdminPanelRoutes] triggerRestart callback not provided or not a function. Restarts will fall back to process.exit(1).');
    }

    const adminApiRouter = express.Router();

    // Dependencies to be passed to each module
    const options = {
        DEBUG_MODE,
        dailyNoteRootPath,
        pluginManager,
        getCurrentServerLogPath,
        vectorDBManager,
        agentDirPath,
        cachedEmojiLists,
        tvsDirPath,
        triggerRestart
    };

    // Static requires — esbuild needs string literals to bundle these modules.
    // DO NOT convert back to dynamic require(path.join(...)) — breaks SEA/bundling.
    const adminModules = {
        system:            require('./admin/system'),
        logs:              require('./admin/logs'),
        config:            require('./admin/config'),
        plugins:           require('./admin/plugins'),
        server:            require('./admin/server'),
        toolbox:           require('./admin/toolbox'),
        agents:            require('./admin/agents'),
        tvs:               require('./admin/tvs'),
        placeholders:      require('./admin/placeholders'),
        schedules:         require('./admin/schedules'),
        rag:               require('./admin/rag'),
        toolListEditor:    require('./admin/toolListEditor'),
        pluginStore:       require('./admin/pluginStore'),
        dailyNotes:        require('./admin/dailyNotes'),
        newapiMonitor:     require('./admin/newapiMonitor'),
        dashboardLayout:   require('./admin/dashboardLayout'),
        maintenance:       require('./admin/maintenance'),
        panelRegistry:     require('./admin/panelRegistry'),
        sarPrompts:        require('./admin/sarPrompts'),
        migration:         require('./admin/migration'),
    };

    for (const [moduleName, moduleFactory] of Object.entries(adminModules)) {
        try {
            const routeHandler = moduleFactory(options);
            adminApiRouter.use('/', routeHandler);
        } catch (error) {
            console.error(`[AdminPanelRoutes] Failed to load module "${moduleName}":`, error);
        }
    }

    // 🔌 插件 admin API 通用路由 — "插件自带前后端" 协议的后端挂载点
    // 任何插件只要在 module.exports 暴露 pluginAdminRouter (Express.Router)，
    // 访问 /admin_api/plugins/:pluginName/api/<path> 即可分发到插件自己的处理器
    // 优点：主项目完全不感知任何特定插件（完美解耦），装即可用
    adminApiRouter.use('/plugins/:pluginName/api', (req, res, next) => {
        if (!pluginManager || typeof pluginManager.getPluginAdminRouter !== 'function') {
            return res.status(503).json({ success: false, error: 'Plugin manager unavailable' });
        }
        const pluginRouter = pluginManager.getPluginAdminRouter(req.params.pluginName);
        if (!pluginRouter) {
            return res.status(404).json({
                success: false,
                error: `Plugin '${req.params.pluginName}' not found or provides no admin API (expose module.exports.pluginAdminRouter)`,
            });
        }
        pluginRouter(req, res, next);
    });

    return adminApiRouter;
};