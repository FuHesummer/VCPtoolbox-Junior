const express = require('express');

module.exports = function(options) {
    const router = express.Router();
    const store = require('../../modules/pluginStore');

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
            const result = await store.uninstall(name);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
};
