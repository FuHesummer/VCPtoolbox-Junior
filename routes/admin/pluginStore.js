const express = require('express');

module.exports = function(options) {
    const router = express.Router();
    const store = require('../../modules/pluginStore');
    const pluginManager = options?.pluginManager;

    // GET /plugin-store/remote - List available plugins from remote
    router.get('/plugin-store/remote', async (req, res) => {
        try {
            const plugins = await store.listRemote();
            res.json({ status: 'success', plugins });
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    });

    // GET /plugin-store/installed - List locally installed plugins
    router.get('/plugin-store/installed', async (req, res) => {
        try {
            const plugins = await store.listInstalled();
            res.json({ status: 'success', plugins });
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    });

    // GET /plugin-store/updates - Check for available updates
    router.get('/plugin-store/updates', async (req, res) => {
        try {
            const updates = await store.checkUpdates();
            res.json({ status: 'success', updates });
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    });

    // GET /plugin-store/resolve-deps/:name - 解析某插件的插件间依赖，返回 missing/already/notFound
    router.get('/plugin-store/resolve-deps/:name', async (req, res) => {
        try {
            const { name } = req.params;
            const result = await store.resolveDependencies(name);
            res.json({ status: 'success', ...result });
        } catch (error) {
            const code = error.code === 'PLUGIN_NOT_IN_STORE' ? 404 : 500;
            res.status(code).json({ status: 'error', code: error.code || null, message: error.message });
        }
    });

    // POST /plugin-store/install/:name - Install a plugin
    router.post('/plugin-store/install/:name', async (req, res) => {
        try {
            const { name } = req.params;
            const { force } = req.body || {};
            const result = await store.install(name, { force: !!force });
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // POST /plugin-store/update/:name - Update a plugin
    router.post('/plugin-store/update/:name', async (req, res) => {
        try {
            const { name } = req.params;
            const result = await store.update(name);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // POST /plugin-store/uninstall/:name - Uninstall a plugin
    router.post('/plugin-store/uninstall/:name', async (req, res) => {
        try {
            const { name } = req.params;
            // 协议钩子：卸载前让插件把 TVS 文件还原回自己的 tvs/ 目录（保留用户最新版本）
            // 这样即使 store.uninstall 删除整个插件目录，再次安装时用户数据也不会丢
            if (pluginManager && typeof pluginManager._unregisterPluginTvsVariables === 'function') {
                try { await pluginManager._unregisterPluginTvsVariables(name, 'uninstall'); }
                catch (e) { console.warn(`[pluginStore route] TVS 还原失败（继续卸载）: ${e.message}`); }
            }
            const result = await store.uninstall(name);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
};
