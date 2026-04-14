const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');

const manifestFileName = 'plugin-manifest.json';
const blockedManifestExtension = '.block';

module.exports = function(options) {
    const router = express.Router();
    const { pluginManager, DEBUG_MODE } = options;
    const PLUGIN_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin');
    const PREPROCESSOR_ORDER_FILE = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'preprocessor_order.json');

    // Helper: find plugin path and manifest by name
    async function _findPlugin(pluginName) {
        const pluginFolders = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
        for (const folder of pluginFolders) {
            if (!folder.isDirectory()) continue;
            const pluginPath = path.join(PLUGIN_DIR, folder.name);
            const manifestPath = path.join(pluginPath, manifestFileName);
            const blockedPath = manifestPath + blockedManifestExtension;

            let manifestContent = null;
            let manifestFile = null;
            try {
                manifestContent = await fs.readFile(manifestPath, 'utf-8');
                manifestFile = manifestPath;
            } catch (e) {
                if (e.code === 'ENOENT') {
                    try {
                        manifestContent = await fs.readFile(blockedPath, 'utf-8');
                        manifestFile = blockedPath;
                    } catch (_) { continue; }
                } else { continue; }
            }

            try {
                const manifest = JSON.parse(manifestContent);
                if (manifest.name === pluginName) {
                    manifest.basePath = pluginPath;
                    return { pluginPath, manifest, manifestFile };
                }
            } catch (_) { continue; }
        }
        return null;
    }

    // Helper: check if plugin has custom admin page
    async function _hasCustomAdminPage(pluginPath) {
        try {
            await fs.access(path.join(pluginPath, 'admin', 'index.html'));
            return true;
        } catch (_) { return false; }
    }

    // Helper: check if plugin has configSchema with fields
    function _hasConfigSchema(manifest) {
        return manifest.configSchema && typeof manifest.configSchema === 'object'
            && Object.keys(manifest.configSchema).length > 0;
    }

    // GET plugin list
    router.get('/plugins', async (req, res) => {
        try {
            const pluginDataMap = new Map();
            const PLUGIN_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin');

            const loadedPlugins = Array.from(pluginManager.plugins.values());
            for (const p of loadedPlugins) {
                let configEnvContent = null;
                let hasAdminPage = false;
                if (!p.isDistributed && p.basePath) {
                    try {
                        const pluginConfigPath = path.join(p.basePath, 'config.env');
                        configEnvContent = await fs.readFile(pluginConfigPath, 'utf-8');
                    } catch (envError) {
                        if (envError.code !== 'ENOENT') {
                            console.warn(`[AdminPanelRoutes] Error reading config.env for ${p.name}:`, envError);
                        }
                    }
                    // Check for custom admin page or configSchema (generic config form)
                    hasAdminPage = await _hasCustomAdminPage(p.basePath) || _hasConfigSchema(p);
                }
                pluginDataMap.set(p.name, {
                    name: p.name,
                    manifest: p,
                    enabled: true,
                    configEnvContent: configEnvContent,
                    isDistributed: p.isDistributed || false,
                    serverId: p.serverId || null,
                    hasAdminPage
                });
            }

            const pluginFolders = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
            for (const folder of pluginFolders) {
                if (folder.isDirectory()) {
                    const pluginPath = path.join(PLUGIN_DIR, folder.name);
                    const manifestPath = path.join(pluginPath, manifestFileName);
                    const blockedManifestPath = manifestPath + blockedManifestExtension;

                    try {
                        const manifestContent = await fs.readFile(blockedManifestPath, 'utf-8');
                        const manifest = JSON.parse(manifestContent);

                        if (!pluginDataMap.has(manifest.name)) {
                            let configEnvContent = null;
                            let hasAdminPage = false;
                            try {
                                const pluginConfigPath = path.join(pluginPath, 'config.env');
                                configEnvContent = await fs.readFile(pluginConfigPath, 'utf-8');
                            } catch (envError) {
                                if (envError.code !== 'ENOENT') {
                                    console.warn(`[AdminPanelRoutes] Error reading config.env for disabled plugin ${manifest.name}:`, envError);
                                }
                            }
                            // Check for custom admin page
                            hasAdminPage = await _hasCustomAdminPage(pluginPath) || _hasConfigSchema(manifest);
                            manifest.basePath = pluginPath;
                            pluginDataMap.set(manifest.name, {
                                name: manifest.name,
                                manifest: manifest,
                                enabled: false,
                                configEnvContent: configEnvContent,
                                isDistributed: false,
                                serverId: null,
                                hasAdminPage
                            });
                        }
                    } catch (error) {
                        if (error.code !== 'ENOENT') {
                            console.warn(`[AdminPanelRoutes] Error processing potential disabled plugin in ${folder.name}:`, error);
                        }
                    }
                }
            }

            const pluginDataList = Array.from(pluginDataMap.values());
            res.json(pluginDataList);
        } catch (error) {
            console.error('[AdminPanelRoutes] Error listing plugins:', error);
            res.status(500).json({ error: 'Failed to list plugins', details: error.message });
        }
    });

    // Toggle plugin status
    router.post('/plugins/:pluginName/toggle', async (req, res) => {
        const pluginName = req.params.pluginName;
        const { enable } = req.body;
        const PLUGIN_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin');

        if (typeof enable !== 'boolean') {
            return res.status(400).json({ error: 'Invalid request body. Expected { enable: boolean }.' });
        }

        try {
            const pluginFolders = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
            let targetPluginPath = null;
            let foundManifest = null;

            for (const folder of pluginFolders) {
                if (folder.isDirectory()) {
                    const potentialPluginPath = path.join(PLUGIN_DIR, folder.name);
                    const potentialManifestPath = path.join(potentialPluginPath, manifestFileName);
                    const potentialBlockedPath = potentialManifestPath + blockedManifestExtension;
                    let manifestContent = null;

                    try {
                        manifestContent = await fs.readFile(potentialManifestPath, 'utf-8');
                    } catch (err) {
                        if (err.code === 'ENOENT') {
                            try {
                                manifestContent = await fs.readFile(potentialBlockedPath, 'utf-8');
                            } catch (blockedErr) { continue; }
                        } else { continue; }
                    }

                    try {
                        const manifest = JSON.parse(manifestContent);
                        if (manifest.name === pluginName) {
                            targetPluginPath = potentialPluginPath;
                            foundManifest = manifest;
                            break;
                        }
                    } catch (parseErr) { continue; }
                }
            }

            if (!targetPluginPath || !foundManifest) {
                return res.status(404).json({ error: `Plugin '${pluginName}' not found.` });
            }

            const manifestPathToUse = path.join(targetPluginPath, manifestFileName);
            const blockedManifestPathToUse = manifestPathToUse + blockedManifestExtension;

            if (enable) {
                try {
                    await fs.rename(blockedManifestPathToUse, manifestPathToUse);
                    await pluginManager.loadPlugins();
                    res.json({ message: `插件 ${pluginName} 已启用。` });
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        try {
                            await fs.access(manifestPathToUse);
                            res.json({ message: `插件 ${pluginName} 已经是启用状态。` });
                        } catch (accessError) {
                            res.status(500).json({ error: `无法启用插件 ${pluginName}。找不到 manifest 文件。`, details: accessError.message });
                        }
                    } else {
                        console.error(`[AdminPanelRoutes] Error enabling plugin ${pluginName}:`, error);
                        res.status(500).json({ error: `启用插件 ${pluginName} 时出错`, details: error.message });
                    }
                }
            } else {
                try {
                    await fs.rename(manifestPathToUse, blockedManifestPathToUse);
                    await pluginManager.loadPlugins();
                    res.json({ message: `插件 ${pluginName} 已禁用。` });
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        try {
                            await fs.access(blockedManifestPathToUse);
                            res.json({ message: `插件 ${pluginName} 已经是禁用状态。` });
                        } catch (accessError) {
                            res.status(500).json({ error: `无法禁用插件 ${pluginName}。找不到 manifest 文件。`, details: accessError.message });
                        }
                    } else {
                        console.error(`[AdminPanelRoutes] Error disabling plugin ${pluginName}:`, error);
                        res.status(500).json({ error: `禁用插件 ${pluginName} 时出错`, details: error.message });
                    }
                }
            }
        } catch (error) {
            console.error(`[AdminPanelRoutes] Error toggling plugin ${pluginName}:`, error);
            res.status(500).json({ error: `处理插件 ${pluginName} 状态切换时出错`, details: error.message });
        }
    });

    // Update plugin description
    router.post('/plugins/:pluginName/description', async (req, res) => {
        const pluginName = req.params.pluginName;
        const { description } = req.body;
        const PLUGIN_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin');

        if (typeof description !== 'string') {
            return res.status(400).json({ error: 'Invalid request body. Expected { description: string }.' });
        }

        try {
            const pluginFolders = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
            let targetManifestPath = null;
            let manifest = null;

            for (const folder of pluginFolders) {
                if (folder.isDirectory()) {
                    const potentialPluginPath = path.join(PLUGIN_DIR, folder.name);
                    const potentialManifestPath = path.join(potentialPluginPath, manifestFileName);
                    const potentialBlockedPath = potentialManifestPath + blockedManifestExtension;
                    let currentPath = null;
                    let manifestContent = null;

                    try {
                        manifestContent = await fs.readFile(potentialManifestPath, 'utf-8');
                        currentPath = potentialManifestPath;
                    } catch (err) {
                        if (err.code === 'ENOENT') {
                            try {
                                manifestContent = await fs.readFile(potentialBlockedPath, 'utf-8');
                                currentPath = potentialBlockedPath;
                            } catch (blockedErr) { continue; }
                        } else { continue; }
                    }

                    try {
                        const parsedManifest = JSON.parse(manifestContent);
                        if (parsedManifest.name === pluginName) {
                            targetManifestPath = currentPath;
                            manifest = parsedManifest;
                            break;
                        }
                    } catch (parseErr) { continue; }
                }
            }

            if (!targetManifestPath || !manifest) {
                return res.status(404).json({ error: `Plugin '${pluginName}' or its manifest file not found.` });
            }

            manifest.description = description;
            await fs.writeFile(targetManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
            await pluginManager.loadPlugins();
            res.json({ message: `插件 ${pluginName} 的描述已更新并重新加载。` });
        } catch (error) {
            console.error(`[AdminPanelRoutes] Error updating description for plugin ${pluginName}:`, error);
            res.status(500).json({ error: `更新插件 ${pluginName} 描述时出错`, details: error.message });
        }
    });

    // Save plugin config
    router.post('/plugins/:pluginName/config', async (req, res) => {
        const pluginName = req.params.pluginName;
        const { content } = req.body;
        const PLUGIN_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin');

        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid content format. String expected.' });
        }

        try {
            const pluginFolders = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
            let targetPluginPath = null;

            for (const folder of pluginFolders) {
                if (folder.isDirectory()) {
                    const potentialPluginPath = path.join(PLUGIN_DIR, folder.name);
                    const manifestPath = path.join(potentialPluginPath, manifestFileName);
                    const blockedManifestPath = manifestPath + blockedManifestExtension;
                    let manifestContent = null;
                    try {
                        manifestContent = await fs.readFile(manifestPath, 'utf-8');
                    } catch (err) {
                        if (err.code === 'ENOENT') {
                            try { manifestContent = await fs.readFile(blockedManifestPath, 'utf-8'); }
                            catch (blockedErr) { continue; }
                        } else { continue; }
                    }
                    try {
                        const manifest = JSON.parse(manifestContent);
                        if (manifest.name === pluginName) {
                            targetPluginPath = potentialPluginPath;
                            break;
                        }
                    } catch (parseErr) { continue; }
                }
            }

            if (!targetPluginPath) {
                return res.status(404).json({ error: `Plugin folder for '${pluginName}' not found.` });
            }

            const configPath = path.join(targetPluginPath, 'config.env');
            await fs.writeFile(configPath, content, 'utf-8');
            await pluginManager.loadPlugins();
            res.json({ message: `插件 ${pluginName} 的配置已保存并已重新加载。` });
        } catch (error) {
            console.error(`[AdminPanelRoutes] Error writing config.env for plugin ${pluginName}:`, error);
            res.status(500).json({ error: `保存插件 ${pluginName} 配置时出错`, details: error.message });
        }
    });

    // Update command description
    router.post('/plugins/:pluginName/commands/:commandIdentifier/description', async (req, res) => {
        const { pluginName, commandIdentifier } = req.params;
        const { description } = req.body;
        const PLUGIN_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'Plugin');

        if (typeof description !== 'string') {
            return res.status(400).json({ error: 'Invalid request body. Expected { description: string }.' });
        }

        try {
            const pluginFolders = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
            let targetManifestPath = null;
            let manifest = null;
            let pluginFound = false;

            for (const folder of pluginFolders) {
                if (folder.isDirectory()) {
                    const potentialPluginPath = path.join(PLUGIN_DIR, folder.name);
                    const potentialManifestPath = path.join(potentialPluginPath, manifestFileName);
                    const potentialBlockedPath = potentialManifestPath + blockedManifestExtension;
                    let currentPath = null;
                    let manifestContent = null;

                    try {
                        manifestContent = await fs.readFile(potentialManifestPath, 'utf-8');
                        currentPath = potentialManifestPath;
                    } catch (err) {
                        if (err.code === 'ENOENT') {
                            try {
                                manifestContent = await fs.readFile(potentialBlockedPath, 'utf-8');
                                currentPath = potentialBlockedPath;
                            } catch (blockedErr) { continue; }
                        } else { continue; }
                    }

                    try {
                        const parsedManifest = JSON.parse(manifestContent);
                        if (parsedManifest.name === pluginName) {
                            targetManifestPath = currentPath;
                            manifest = parsedManifest;
                            pluginFound = true;
                            break;
                        }
                    } catch (parseErr) {
                        console.warn(`[AdminPanelRoutes] Error parsing manifest for ${folder.name}: ${parseErr.message}`);
                        continue;
                    }
                }
            }

            if (!pluginFound || !manifest) {
                return res.status(404).json({ error: `Plugin '${pluginName}' or its manifest file not found.` });
            }

            let commandUpdated = false;
            if (manifest.capabilities && manifest.capabilities.invocationCommands && Array.isArray(manifest.capabilities.invocationCommands)) {
                const commandIndex = manifest.capabilities.invocationCommands.findIndex(cmd => cmd.commandIdentifier === commandIdentifier || cmd.command === commandIdentifier);
                if (commandIndex !== -1) {
                    manifest.capabilities.invocationCommands[commandIndex].description = description;
                    commandUpdated = true;
                }
            }

            if (!commandUpdated) {
                return res.status(404).json({ error: `Command '${commandIdentifier}' not found in plugin '${pluginName}'.` });
            }

            await fs.writeFile(targetManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
            await pluginManager.loadPlugins();
            res.json({ message: `指令 '${commandIdentifier}' 在插件 '${pluginName}' 中的描述已更新并重新加载。` });
        } catch (error) {
            console.error(`[AdminPanelRoutes] Error updating command description for plugin ${pluginName}, command ${commandIdentifier}:`, error);
            res.status(500).json({ error: `更新指令描述时出错`, details: error.message });
        }
    });

    // --- Preprocessor Order Management API ---
    router.get('/preprocessors/order', (req, res) => {
        try {
            const order = pluginManager.getPreprocessorOrder();
            res.json({ status: 'success', order });
        } catch (error) {
            console.error('[AdminAPI] Error getting preprocessor order:', error);
            res.status(500).json({ status: 'error', message: 'Failed to get preprocessor order.' });
        }
    });

    router.post('/preprocessors/order', async (req, res) => {
        const { order } = req.body;
        if (!Array.isArray(order)) {
            return res.status(400).json({ status: 'error', message: 'Invalid request: "order" must be an array.' });
        }

        try {
            await fs.writeFile(PREPROCESSOR_ORDER_FILE, JSON.stringify(order, null, 2), 'utf-8');
            if (DEBUG_MODE) console.log('[AdminAPI] Saved new preprocessor order to file.');

            const newOrder = await pluginManager.hotReloadPluginsAndOrder();
            res.json({ status: 'success', message: 'Order saved and hot-reloaded successfully.', newOrder });
        } catch (error) {
            console.error('[AdminAPI] Error saving or hot-reloading preprocessor order:', error);
            res.status(500).json({ status: 'error', message: 'Failed to save or hot-reload preprocessor order.' });
        }
    });

    // --- Plugin Config Schema API ---
    // Get configSchema + current resolved values
    router.get('/plugins/:pluginName/config-schema', async (req, res) => {
        try {
            const found = await _findPlugin(req.params.pluginName);
            if (!found) return res.status(404).json({ error: `Plugin '${req.params.pluginName}' not found.` });

            const { pluginPath, manifest } = found;
            const schema = manifest.configSchema || {};

            // Read current config.env values
            let envValues = {};
            try {
                const envContent = await fs.readFile(path.join(pluginPath, 'config.env'), 'utf-8');
                envValues = dotenv.parse(envContent);
            } catch (_) {}

            // Build structured response: schema fields with current values
            const fields = {};
            for (const [key, schemaDef] of Object.entries(schema)) {
                const isObject = typeof schemaDef === 'object' && schemaDef !== null;
                const fieldType = isObject ? schemaDef.type : schemaDef;
                const description = isObject ? (schemaDef.description || '') : '';
                const defaultValue = isObject ? schemaDef.default : undefined;

                // Resolve current value: plugin env > global env > default
                let currentValue = envValues[key] ?? process.env[key] ?? defaultValue;

                // Type coerce for display
                if (fieldType === 'boolean' && typeof currentValue === 'string') {
                    currentValue = currentValue.toLowerCase() === 'true';
                } else if ((fieldType === 'number' || fieldType === 'integer') && typeof currentValue === 'string') {
                    currentValue = Number(currentValue);
                    if (isNaN(currentValue)) currentValue = defaultValue;
                }

                fields[key] = { type: fieldType, description, default: defaultValue, value: currentValue };
            }

            res.json({
                pluginName: manifest.name,
                displayName: manifest.displayName || manifest.name,
                description: manifest.description || '',
                fields
            });
        } catch (error) {
            console.error(`[AdminAPI] Error reading config schema for ${req.params.pluginName}:`, error);
            res.status(500).json({ error: 'Failed to read config schema', details: error.message });
        }
    });

    // Save structured config values to plugin's config.env
    router.post('/plugins/:pluginName/config-values', async (req, res) => {
        try {
            const found = await _findPlugin(req.params.pluginName);
            if (!found) return res.status(404).json({ error: `Plugin '${req.params.pluginName}' not found.` });

            const { pluginPath, manifest } = found;
            const values = req.body.values;
            if (!values || typeof values !== 'object') {
                return res.status(400).json({ error: 'Expected { values: { key: value, ... } }' });
            }

            // Read existing config.env to preserve unknown keys
            let existingEnv = {};
            const configPath = path.join(pluginPath, 'config.env');
            try {
                const content = await fs.readFile(configPath, 'utf-8');
                existingEnv = dotenv.parse(content);
            } catch (_) {}

            // Merge new values
            const merged = { ...existingEnv, ...values };

            // Write back as config.env format
            const lines = Object.entries(merged)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => `${k}=${v}`);
            await fs.writeFile(configPath, lines.join('\n') + '\n', 'utf-8');

            // Reload plugins
            await pluginManager.loadPlugins();
            res.json({ message: `Plugin '${manifest.name}' config saved and reloaded.` });
        } catch (error) {
            console.error(`[AdminAPI] Error saving config values for ${req.params.pluginName}:`, error);
            res.status(500).json({ error: 'Failed to save config', details: error.message });
        }
    });

    // --- Plugin Admin Panel (dynamic discovery) ---
    // Serve plugin's custom admin page, or fall back to generic config form
    router.get('/plugins/:pluginName/admin-page', async (req, res) => {
        try {
            const found = await _findPlugin(req.params.pluginName);
            if (!found) return res.status(404).json({ error: `Plugin '${req.params.pluginName}' not found.` });

            const { pluginPath, manifest } = found;

            // Priority 1: custom admin/index.html
            if (await _hasCustomAdminPage(pluginPath)) {
                const content = await fs.readFile(path.join(pluginPath, 'admin', 'index.html'), 'utf-8');
                return res.type('html').send(content);
            }

            // Priority 2: auto-generate config form from configSchema
            if (_hasConfigSchema(manifest)) {
                const genericPage = _buildGenericConfigPage(manifest.name, manifest.displayName || manifest.name);
                return res.type('html').send(genericPage);
            }

            res.status(404).json({ error: `Plugin '${req.params.pluginName}' does not have an admin page.` });
        } catch (error) {
            console.error(`[AdminAPI] Error serving admin page for ${req.params.pluginName}:`, error);
            res.status(500).json({ error: 'Failed to load plugin admin page', details: error.message });
        }
    });

    // Serve static assets from plugin's admin directory
    // Serve static assets from plugin's admin directory (supports sub-paths via wildcard)
    router.get('/plugins/:pluginName/admin-assets/*subpath', async (req, res) => {
        const { pluginName } = req.params;
        // Express 5 wildcard returns array; join segments back into a path string
        const rawSubpath = req.params.subpath;
        const assetSubPath = Array.isArray(rawSubpath) ? rawSubpath.join('/') : rawSubpath;

        // Security: prevent path traversal
        if (!assetSubPath || assetSubPath.includes('..')) {
            return res.status(400).json({ error: 'Invalid asset path.' });
        }

        try {
            const found = await _findPlugin(pluginName);
            if (!found) return res.status(404).json({ error: `Plugin '${pluginName}' not found.` });

            const assetPath = path.join(found.pluginPath, 'admin', assetSubPath);
            const resolvedPath = path.resolve(assetPath);
            const adminDir = path.resolve(path.join(found.pluginPath, 'admin'));
            if (!resolvedPath.startsWith(adminDir + path.sep) && resolvedPath !== adminDir) {
                return res.status(403).json({ error: 'Access denied.' });
            }

            await fs.access(assetPath);
            res.sendFile(resolvedPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Asset not found.' });
            }
            res.status(500).json({ error: 'Failed to serve asset', details: error.message });
        }
    });

    // --- Generic Config Page Generator ---
    function _buildGenericConfigPage(pluginName, displayName) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${displayName} - 配置</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #faf5f7; color: #3d2c3e; padding: 24px; }
        h2 { font-size: 1.1rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; color: #3d2c3e; }
        h2 .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; background: rgba(212,116,142,0.1); color: #8a7490; font-weight: 400; }
        .config-form { display: flex; flex-direction: column; gap: 14px; max-width: 500px; }
        .field { display: flex; flex-direction: column; gap: 4px; }
        .field label { font-size: 0.85rem; color: #3d2c3e; font-weight: 500; }
        .field .desc { font-size: 0.75rem; color: #8a7490; margin-bottom: 2px; }
        .field input[type="text"],
        .field input[type="number"] {
            background: #fff8fa; border: 1px solid rgba(212,116,142,0.2); border-radius: 8px;
            padding: 8px 10px; color: #3d2c3e; font-size: 0.85rem; outline: none;
            transition: border-color 0.2s;
        }
        .field input:focus { border-color: #d4748e; box-shadow: 0 0 0 2px rgba(212,116,142,0.1); }
        .field .toggle-wrap { display: flex; align-items: center; gap: 8px; }
        .toggle { position: relative; width: 40px; height: 22px; cursor: pointer; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .toggle .slider {
            position: absolute; inset: 0; background: #ddd0d5; border-radius: 11px;
            transition: background 0.2s;
        }
        .toggle .slider::before {
            content: ''; position: absolute; width: 16px; height: 16px;
            left: 3px; top: 3px; background: #fff; border-radius: 50%;
            transition: transform 0.2s, background 0.2s;
        }
        .toggle input:checked + .slider { background: #d4748e; }
        .toggle input:checked + .slider::before { transform: translateX(18px); background: #fff; }
        .toggle-label { font-size: 0.8rem; color: #8a7490; }
        .actions { display: flex; gap: 8px; margin-top: 8px; }
        .btn {
            padding: 8px 20px; border-radius: 8px; border: none; cursor: pointer;
            font-size: 0.85rem; font-weight: 500; transition: all 0.2s;
        }
        .btn-primary { background: #d4748e; color: #fff; }
        .btn-primary:hover { background: #c4647e; }
        .btn-secondary { background: #f0e8ec; color: #8a7490; border: 1px solid rgba(212,116,142,0.15); }
        .btn-secondary:hover { background: #e8dce2; color: #3d2c3e; }
        .status { font-size: 0.8rem; margin-top: 8px; min-height: 20px; }
        .status.ok { color: #4a9; }
        .status.err { color: #d55; }
        .loading { text-align: center; padding: 40px; color: #8a7490; }
    </style>
</head>
<body>
    <h2>${displayName} <span class="badge">配置管理</span></h2>
    <div id="form-container"><p class="loading">加载中...</p></div>
    <script>
        const API = '/admin_api';
        const PLUGIN_NAME = '${pluginName}';
        let schemaData = null;

        async function loadSchema() {
            try {
                const res = await fetch(API + '/plugins/' + PLUGIN_NAME + '/config-schema');
                if (!res.ok) throw new Error('Failed to load config schema');
                schemaData = await res.json();
                renderForm();
            } catch (e) {
                document.getElementById('form-container').innerHTML =
                    '<p class="status err">加载配置失败: ' + e.message + '</p>';
            }
        }

        function renderForm() {
            const container = document.getElementById('form-container');
            const fields = schemaData.fields;
            const keys = Object.keys(fields);

            if (keys.length === 0) {
                container.innerHTML = '<p style="color:#64748b">此插件没有可配置项</p>';
                return;
            }

            let html = '<div class="config-form">';
            for (const key of keys) {
                const f = fields[key];
                const val = f.value ?? f.default ?? '';
                html += '<div class="field">';
                html += '<label>' + key + '</label>';
                if (f.description) html += '<span class="desc">' + f.description + '</span>';

                if (f.type === 'boolean') {
                    const checked = val === true || val === 'true' ? 'checked' : '';
                    html += '<div class="toggle-wrap">'
                        + '<label class="toggle"><input type="checkbox" data-key="' + key + '" ' + checked + '><span class="slider"></span></label>'
                        + '<span class="toggle-label">' + (checked ? '启用' : '禁用') + '</span>'
                        + '</div>';
                } else if (f.type === 'number' || f.type === 'integer') {
                    const step = f.type === 'integer' ? '1' : 'any';
                    html += '<input type="number" data-key="' + key + '" value="' + val + '" step="' + step + '" placeholder="默认: ' + (f.default ?? '') + '">';
                } else {
                    // string or unknown
                    const isSecret = key.toLowerCase().includes('api') || key.toLowerCase().includes('key') || key.toLowerCase().includes('secret');
                    html += '<input type="text" data-key="' + key + '" value="' + (val || '') + '" placeholder="' + (isSecret ? '••••••' : '默认: ' + (f.default ?? '')) + '">';
                }
                html += '</div>';
            }
            html += '<div class="actions">'
                + '<button class="btn btn-primary" onclick="saveConfig()">保存</button>'
                + '<button class="btn btn-secondary" onclick="resetDefaults()">恢复默认</button>'
                + '</div>';
            html += '<div id="status" class="status"></div>';
            html += '</div>';
            container.innerHTML = html;

            // Toggle label update
            container.querySelectorAll('.toggle input').forEach(cb => {
                cb.addEventListener('change', function() {
                    this.closest('.toggle-wrap').querySelector('.toggle-label').textContent = this.checked ? '启用' : '禁用';
                });
            });
        }

        async function saveConfig() {
            const status = document.getElementById('status');
            const values = {};
            document.querySelectorAll('[data-key]').forEach(el => {
                const key = el.dataset.key;
                if (el.type === 'checkbox') {
                    values[key] = el.checked ? 'true' : 'false';
                } else {
                    values[key] = el.value;
                }
            });

            try {
                status.className = 'status';
                status.textContent = '保存中...';
                const res = await fetch(API + '/plugins/' + PLUGIN_NAME + '/config-values', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ values })
                });
                const data = await res.json();
                if (res.ok) {
                    status.className = 'status ok';
                    status.textContent = '✓ 保存成功，插件已重载';
                    setTimeout(() => { status.textContent = ''; }, 3000);
                } else {
                    throw new Error(data.error || 'Save failed');
                }
            } catch (e) {
                status.className = 'status err';
                status.textContent = '✗ ' + e.message;
            }
        }

        function resetDefaults() {
            if (!schemaData) return;
            const fields = schemaData.fields;
            document.querySelectorAll('[data-key]').forEach(el => {
                const f = fields[el.dataset.key];
                if (!f) return;
                const def = f.default;
                if (el.type === 'checkbox') {
                    el.checked = def === true || def === 'true';
                    el.closest('.toggle-wrap').querySelector('.toggle-label').textContent = el.checked ? '启用' : '禁用';
                } else {
                    el.value = def ?? '';
                }
            });
        }

        loadSchema();
    </script>
</body>
</html>`;
    }

    // ══════════════════════════════════════════════════
    //  Plugin UI Preferences (dashboard cards / nav page toggles)
    //  Stored in plugin-ui-prefs.json at VCP_ROOT
    // ══════════════════════════════════════════════════
    const UI_PREFS_PATH = path.join(process.env.VCP_ROOT || path.join(__dirname, '..', '..'), 'plugin-ui-prefs.json');

    async function _readUiPrefs() {
        try {
            return JSON.parse(await fs.readFile(UI_PREFS_PATH, 'utf-8'));
        } catch {
            return {};
        }
    }

    router.get('/plugin-ui-prefs', async (req, res) => {
        try {
            res.json(await _readUiPrefs());
        } catch (error) {
            res.status(500).json({ error: 'Failed to read plugin UI prefs', details: error.message });
        }
    });

    router.post('/plugin-ui-prefs', async (req, res) => {
        try {
            const prefs = req.body;
            if (!prefs || typeof prefs !== 'object') {
                return res.status(400).json({ error: 'Invalid prefs payload' });
            }
            await fs.writeFile(UI_PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf-8');
            res.json({ message: 'Plugin UI prefs saved' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to save plugin UI prefs', details: error.message });
        }
    });

    return router;
};
