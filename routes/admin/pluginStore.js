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

    // POST /plugin-store/install/:name - Install a plugin + 热加载到 PluginManager
    router.post('/plugin-store/install/:name', async (req, res) => {
        try {
            const { name } = req.params;
            const { force } = req.body || {};
            const result = await store.install(name, { force: !!force });

            // 协议钩子：安装完成后调 _registerSinglePlugin，让 {{VCPAllTools}} /
            // placeholders / messagePreprocessors / serviceModules 立即包含新插件，
            // 用户无需重启主服务。对称于 uninstall 路径的 _unregisterSinglePlugin。
            if (result?.success && pluginManager && typeof pluginManager._registerSinglePlugin === 'function') {
                try {
                    const reg = await pluginManager._registerSinglePlugin(name);
                    if (reg.ok) {
                        result.hotLoaded = true;
                        result.registered = reg.registered;
                    } else if (reg.reason !== 'already-registered') {
                        console.warn(`[pluginStore route] 热加载 ${name} 失败: ${reg.reason}`);
                        result.hotLoaded = false;
                        result.hotLoadReason = reg.reason;
                    }
                } catch (e) {
                    console.warn(`[pluginStore route] 热加载 ${name} 异常（安装已完成，需重启主服务）: ${e.message}`);
                    result.hotLoaded = false;
                    result.hotLoadReason = e.message;
                }
            }

            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // POST /plugin-store/update/:name - Update a plugin + 热重载（先卸再装）
    router.post('/plugin-store/update/:name', async (req, res) => {
        try {
            const { name } = req.params;

            // 更新前反注册旧版本（避免 require 缓存命中旧模块）
            if (pluginManager) {
                if (typeof pluginManager._unregisterPluginTvsVariables === 'function') {
                    try { await pluginManager._unregisterPluginTvsVariables(name, 'update'); }
                    catch (e) { console.warn(`[pluginStore route] update TVS 还原失败（继续）: ${e.message}`); }
                }
                if (typeof pluginManager._unregisterPluginEnvContributions === 'function') {
                    try { await pluginManager._unregisterPluginEnvContributions(name); }
                    catch (e) { console.warn(`[pluginStore route] update env 反注册失败（继续）: ${e.message}`); }
                }
                if (typeof pluginManager._unregisterSinglePlugin === 'function') {
                    try { await pluginManager._unregisterSinglePlugin(name); }
                    catch (e) { console.warn(`[pluginStore route] update 主注册表反注册失败（继续）: ${e.message}`); }
                }
            }

            const result = await store.update(name);

            // 更新完成后重新加载
            if (result?.success && pluginManager && typeof pluginManager._registerSinglePlugin === 'function') {
                try {
                    const reg = await pluginManager._registerSinglePlugin(name);
                    result.hotLoaded = reg.ok;
                    if (!reg.ok) result.hotLoadReason = reg.reason;
                } catch (e) {
                    console.warn(`[pluginStore route] update 热加载 ${name} 异常: ${e.message}`);
                    result.hotLoaded = false;
                    result.hotLoadReason = e.message;
                }
            }

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
            // 协议钩子：反向清理 envContributions（append-csv 移除、default 保留用户改动）
            // 同步 data/plugin-env-registry.json，防止残留字段污染 config.env
            if (pluginManager && typeof pluginManager._unregisterPluginEnvContributions === 'function') {
                try { await pluginManager._unregisterPluginEnvContributions(name); }
                catch (e) { console.warn(`[pluginStore route] envContributions 反注册失败（继续卸载）: ${e.message}`); }
            }
            // 主注册表清理：从 PluginManager 内存移除本插件（plugins/messagePreprocessors/
            // serviceModules/staticPlaceholderValues/scheduledJobs/adminRouterCache），
            // 并重建 VCP 工具描述。避免 /admin_api/plugins 等接口残留已卸载的插件。
            if (pluginManager && typeof pluginManager._unregisterSinglePlugin === 'function') {
                try { await pluginManager._unregisterSinglePlugin(name); }
                catch (e) { console.warn(`[pluginStore route] 主注册表反注册失败（继续卸载）: ${e.message}`); }
            }
            const result = await store.uninstall(name);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
};
