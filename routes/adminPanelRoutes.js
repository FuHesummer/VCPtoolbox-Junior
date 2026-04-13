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
        system:         require('./admin/system'),
        logs:           require('./admin/logs'),
        config:         require('./admin/config'),
        plugins:        require('./admin/plugins'),
        server:         require('./admin/server'),
        toolbox:        require('./admin/toolbox'),
        agents:         require('./admin/agents'),
        tvs:            require('./admin/tvs'),
        placeholders:   require('./admin/placeholders'),
        schedules:      require('./admin/schedules'),
        rag:            require('./admin/rag'),
        toolListEditor: require('./admin/toolListEditor'),
        pluginStore:    require('./admin/pluginStore'),
        dailyNotes:     require('./admin/dailyNotes'),
    };

    for (const [moduleName, moduleFactory] of Object.entries(adminModules)) {
        try {
            const routeHandler = moduleFactory(options);
            adminApiRouter.use('/', routeHandler);
        } catch (error) {
            console.error(`[AdminPanelRoutes] Failed to load module "${moduleName}":`, error);
        }
    }

    return adminApiRouter;
};