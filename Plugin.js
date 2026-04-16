// Plugin.js
const fs = require('fs').promises;
const EventEmitter = require('events');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fsSync = require('fs');
const schedule = require('node-schedule');
const dotenv = require('dotenv'); // Ensures dotenv is available
const FileFetcherServer = require('./modules/FileFetcherServer.js');
const express = require('express'); // For plugin API routing
const chokidar = require('chokidar');
const { getAuthCode } = require('./modules/captchaDecoder'); // 导入统一的解码函数
const ToolApprovalManager = require('./modules/toolApprovalManager');

const PLUGIN_DIR = path.join(__dirname, 'Plugin');
const TVS_DIR = path.join(__dirname, 'TVStxt');
const manifestFileName = 'plugin-manifest.json';
const PREPROCESSOR_ORDER_FILE = path.join(__dirname, 'preprocessor_order.json');

class PluginManager extends EventEmitter {
    constructor() {
        super();
        this.plugins = new Map(); // 存储所有插件（本地和分布式）
        this.staticPlaceholderValues = new Map();
        this.scheduledJobs = new Map();
        this.messagePreprocessors = new Map();
        this.preprocessorOrder = []; // 新增：用于存储预处理器的最终加载顺序
        this.serviceModules = new Map();
        this.projectBasePath = null;
        this.individualPluginDescriptions = new Map(); // New map for individual descriptions
        this.debugMode = (process.env.DebugMode || "False").toLowerCase() === "true";
        this.webSocketServer = null; // 为 WebSocketServer 实例占位
        this.isReloading = false;
        this.reloadTimeout = null;
        this.vectorDBManager = null; // 修复：不再自己创建，等待注入
        this.toolApprovalManager = new ToolApprovalManager(path.join(__dirname, 'modules', 'toolApprovalConfig.json'));
        this.pendingApprovals = new Map(); // requestId -> { resolve, reject, timeoutId }
        // TVS 变量注册表：插件通过 capabilities.tvsVariables 注入的变量
        // Map<pluginName, Array<{ key, filename, targetPath }>>
        this.pluginTvsRegistry = new Map();

        // env 贡献注册表：插件通过 capabilities.envContributions 贡献的 config.env 字段
        // Map<pluginName, Array<{ key, op, value, appliedValue, prevSnapshot }>>
        // 持久化到 data/plugin-env-registry.json，支持重启后正确回滚
        this.pluginEnvContribRegistry = new Map();
        this._envRegistryPath = path.join(__dirname, 'data', 'plugin-env-registry.json');
        this._configEnvPath = path.join(__dirname, 'config.env');
        this._loadEnvRegistryFromDisk();
    }

    _loadEnvRegistryFromDisk() {
        try {
            if (fsSync.existsSync(this._envRegistryPath)) {
                const raw = fsSync.readFileSync(this._envRegistryPath, 'utf8');
                const obj = JSON.parse(raw);
                for (const [name, arr] of Object.entries(obj || {})) {
                    if (Array.isArray(arr)) this.pluginEnvContribRegistry.set(name, arr);
                }
            }
        } catch (e) {
            console.warn(`[PluginManager] [ENV] 加载 plugin-env-registry.json 失败: ${e.message}`);
        }
    }

    async _persistEnvRegistry() {
        try {
            await fs.mkdir(path.dirname(this._envRegistryPath), { recursive: true });
            const obj = {};
            for (const [k, v] of this.pluginEnvContribRegistry.entries()) obj[k] = v;
            await fs.writeFile(this._envRegistryPath, JSON.stringify(obj, null, 2), 'utf8');
        } catch (e) {
            console.warn(`[PluginManager] [ENV] 持久化 env 注册表失败: ${e.message}`);
        }
    }

    setWebSocketServer(wss) {
        this.webSocketServer = wss;
        if (this.debugMode) console.log('[PluginManager] WebSocketServer instance has been set.');
    }

    setVectorDBManager(vdbManager) {
        this.vectorDBManager = vdbManager;
        if (this.debugMode) console.log('[PluginManager] VectorDBManager instance has been set.');
    }

    async _getDecryptedAuthCode() {
        try {
            const authCodePath = path.join(__dirname, 'Plugin', 'UserAuth', 'code.bin');
            // 使用正确的 getAuthCode 函数，并传递文件路径
            return await getAuthCode(authCodePath);
        } catch (error) {
            if (this.debugMode) {
                console.error('[PluginManager] Failed to read or decrypt auth code for plugin execution:', error.message);
            }
            return null; // Return null if code cannot be obtained
        }
    }

    setProjectBasePath(basePath) {
        this.projectBasePath = basePath;
        if (this.debugMode) console.log(`[PluginManager] Project base path set to: ${this.projectBasePath}`);
    }

    _getPluginConfig(pluginManifest) {
        const config = {};
        const globalEnv = process.env;
        const pluginSpecificEnv = pluginManifest.pluginSpecificEnvConfig || {};

        if (pluginManifest.configSchema) {
            for (const key in pluginManifest.configSchema) {
                const schemaEntry = pluginManifest.configSchema[key];
                // 兼容两种格式：对象格式 { type: "string", ... } 和简单字符串格式 "string"
                const expectedType = (typeof schemaEntry === 'object' && schemaEntry !== null)
                    ? schemaEntry.type
                    : schemaEntry;
                let rawValue;

                if (pluginSpecificEnv.hasOwnProperty(key)) {
                    rawValue = pluginSpecificEnv[key];
                } else if (globalEnv.hasOwnProperty(key)) {
                    rawValue = globalEnv[key];
                } else {
                    continue;
                }

                let value = rawValue;
                if (expectedType === 'integer') {
                    value = parseInt(value, 10);
                    if (isNaN(value)) {
                        if (this.debugMode) console.warn(`[PluginManager] Config key '${key}' for ${pluginManifest.name} expected integer, got NaN from raw value '${rawValue}'. Using undefined.`);
                        value = undefined;
                    }
                } else if (expectedType === 'boolean') {
                    value = String(value).toLowerCase() === 'true';
                }
                config[key] = value;
            }
        }

        if (pluginSpecificEnv.hasOwnProperty('DebugMode')) {
            config.DebugMode = String(pluginSpecificEnv.DebugMode).toLowerCase() === 'true';
        } else if (globalEnv.hasOwnProperty('DebugMode')) {
            config.DebugMode = String(globalEnv.DebugMode).toLowerCase() === 'true';
        } else if (!config.hasOwnProperty('DebugMode')) {
            config.DebugMode = false;
        }
        return config;
    }

    getResolvedPluginConfigValue(pluginName, configKey) {
        const pluginManifest = this.plugins.get(pluginName);
        if (!pluginManifest) {
            return undefined;
        }
        const effectiveConfig = this._getPluginConfig(pluginManifest);
        return effectiveConfig ? effectiveConfig[configKey] : undefined;
    }

    async _executeStaticPluginCommand(plugin) {
        if (!plugin || plugin.pluginType !== 'static' || !plugin.entryPoint || !plugin.entryPoint.command) {
            console.error(`[PluginManager] Invalid static plugin or command for execution: ${plugin ? plugin.name : 'Unknown'}`);
            return Promise.reject(new Error(`Invalid static plugin or command for ${plugin ? plugin.name : 'Unknown'}`));
        }

        return new Promise((resolve, reject) => {
            const pluginConfig = this._getPluginConfig(plugin);
            const envForProcess = { ...process.env };
            for (const key in pluginConfig) {
                if (pluginConfig.hasOwnProperty(key) && pluginConfig[key] !== undefined) {
                    envForProcess[key] = String(pluginConfig[key]);
                }
            }
            if (this.projectBasePath) { // Add projectBasePath for static plugins too if needed
                envForProcess.PROJECT_BASE_PATH = this.projectBasePath;
            }


            // 用完整命令字符串 + shell:true，避免 DEP0190（args 数组与 shell:true 并用会触发废弃警告）
            const pluginProcess = spawn(plugin.entryPoint.command, { cwd: plugin.basePath, shell: true, env: envForProcess, windowsHide: true });
            let output = '';
            let errorOutput = '';
            let processExited = false;
            const timeoutDuration = plugin.communication?.timeout || 60000; // 增加默认超时时间到 1 分钟

            const timeoutId = setTimeout(() => {
                if (!processExited) {
                    console.log(`[PluginManager] Static plugin "${plugin.name}" has completed its work cycle (${timeoutDuration}ms), terminating background process.`);
                    pluginProcess.kill('SIGKILL');
                    // 超时不作为错误 - static 插件完成工作周期后返回已收集的输出
                    resolve(output.trim());
                }
            }, timeoutDuration);

            pluginProcess.stdout.on('data', (data) => { output += data.toString(); });
            pluginProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });

            pluginProcess.on('error', (err) => {
                processExited = true;
                clearTimeout(timeoutId);
                console.error(`[PluginManager] Failed to start static plugin ${plugin.name}: ${err.message}`);
                reject(err);
            });

            pluginProcess.on('exit', (code, signal) => {
                processExited = true;
                clearTimeout(timeoutId);
                if (signal === 'SIGKILL') {
                    // 被 SIGKILL 终止（超时），已经在 timeout 回调中 resolve 了，这里直接返回
                    return;
                }
                if (code !== 0) {
                    const errMsg = `Static plugin ${plugin.name} exited with code ${code}. Stderr: ${errorOutput.trim()}`;
                    console.error(`[PluginManager] ${errMsg}`);
                    reject(new Error(errMsg));
                } else {
                    if (errorOutput.trim() && this.debugMode) {
                        console.warn(`[PluginManager] Static plugin ${plugin.name} produced stderr output: ${errorOutput.trim()}`);
                    }
                    resolve(output.trim());
                }
            });
        });
    }

    async _updateStaticPluginValue(plugin) {
        let newValue = null;
        let executionError = null;
        try {
            if (this.debugMode) console.log(`[PluginManager] Updating static plugin: ${plugin.name}`);
            newValue = await this._executeStaticPluginCommand(plugin);
        } catch (error) {
            console.error(`[PluginManager] Error executing static plugin ${plugin.name} script:`, error.message);
            executionError = error;
        }

        if (plugin.capabilities && plugin.capabilities.systemPromptPlaceholders) {
            plugin.capabilities.systemPromptPlaceholders.forEach(ph => {
                const placeholderKey = ph.placeholder;
                const currentValueEntry = this.staticPlaceholderValues.get(placeholderKey);
                const currentValue = currentValueEntry ? currentValueEntry.value : undefined;

                let parsedValue = newValue;
                if (newValue !== null) {
                    try {
                        let trimmedValue = newValue.trim();
                        // 尝试解析 JSON，支持 vcp_dynamic_fold 协议
                        if (trimmedValue.startsWith('{')) {
                            const jsonObj = JSON.parse(trimmedValue);
                            if (jsonObj && jsonObj.vcp_dynamic_fold) {
                                parsedValue = jsonObj; // 保持对象形式以供折叠处理
                            } else {
                                parsedValue = trimmedValue;
                            }
                        } else {
                            parsedValue = trimmedValue;
                        }
                    } catch (e) {
                        parsedValue = newValue.trim();
                    }
                }

                if (parsedValue !== null && parsedValue !== "") {
                    this.staticPlaceholderValues.set(placeholderKey, { value: parsedValue, serverId: 'local' });
                    if (this.debugMode) {
                        const logVal = typeof parsedValue === 'object' ? JSON.stringify(parsedValue) : parsedValue;
                        console.log(`[PluginManager] Placeholder ${placeholderKey} for ${plugin.name} updated with value: "${logVal.substring(0, 70)}..."`);
                    }
                } else if (executionError) {
                    const errorMessage = `[Error updating ${plugin.name}: ${executionError.message.substring(0, 100)}...]`;
                    if (!currentValue || (typeof currentValue === 'string' && currentValue.startsWith("[Error"))) {
                        this.staticPlaceholderValues.set(placeholderKey, { value: errorMessage, serverId: 'local' });
                        if (this.debugMode) console.warn(`[PluginManager] Placeholder ${placeholderKey} for ${plugin.name} set to error state: ${errorMessage}`);
                    } else {
                        if (this.debugMode) console.warn(`[PluginManager] Placeholder ${placeholderKey} for ${plugin.name} failed to update. Keeping stale value: "${(typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue)).substring(0, 70)}..."`);
                    }
                } else {
                    if (this.debugMode) console.warn(`[PluginManager] Static plugin ${plugin.name} produced no new output for ${placeholderKey}. Keeping stale value (if any).`);
                    if (!currentValueEntry) {
                        this.staticPlaceholderValues.set(placeholderKey, { value: `[${plugin.name} data currently unavailable]`, serverId: 'local' });
                        if (this.debugMode) console.log(`[PluginManager] Placeholder ${placeholderKey} for ${plugin.name} set to 'unavailable'.`);
                    }
                }
            });
        }
    }

    async initializeStaticPlugins() {
        console.log('[PluginManager] Initializing static plugins...');
        for (const plugin of this.plugins.values()) {
            if (plugin.pluginType === 'static') {
                // Immediately set a "loading" state for the placeholder.
                if (plugin.capabilities && plugin.capabilities.systemPromptPlaceholders) {
                    plugin.capabilities.systemPromptPlaceholders.forEach(ph => {
                        this.staticPlaceholderValues.set(ph.placeholder, { value: `[${plugin.displayName} a-zheng-zai-jia-zai-zhong... ]`, serverId: 'local' });
                    });
                }

                // Trigger the first update in the background (fire and forget).
                this._updateStaticPluginValue(plugin).catch(err => {
                    console.error(`[PluginManager] Initial background update for ${plugin.name} failed: ${err.message}`);
                });

                // Set up the scheduled recurring updates.
                if (plugin.refreshIntervalCron) {
                    if (this.scheduledJobs.has(plugin.name)) {
                        this.scheduledJobs.get(plugin.name).cancel();
                    }
                    try {
                        const job = schedule.scheduleJob(plugin.refreshIntervalCron, () => {
                            if (this.debugMode) console.log(`[PluginManager] Scheduled update for static plugin: ${plugin.name}`);
                            this._updateStaticPluginValue(plugin).catch(err => {
                                console.error(`[PluginManager] Scheduled background update for ${plugin.name} failed: ${err.message}`);
                            });
                        });
                        this.scheduledJobs.set(plugin.name, job);
                        if (this.debugMode) console.log(`[PluginManager] Scheduled ${plugin.name} with cron: ${plugin.refreshIntervalCron}`);
                    } catch (e) {
                        console.error(`[PluginManager] Invalid cron string for ${plugin.name}: ${plugin.refreshIntervalCron}. Error: ${e.message}`);
                    }
                }
            }
        }
        console.log('[PluginManager] Static plugins initialization process has been started (updates will run in the background).');
    }
    async prewarmPythonPlugins() {
        console.log('[PluginManager] Checking for Python plugins to pre-warm...');
        if (this.plugins.has('SciCalculator')) {
            console.log('[PluginManager] SciCalculator found. Starting pre-warming of Python scientific libraries in the background.');
            try {
                const command = 'python';
                const args = ['-c', 'import sympy, scipy.stats, scipy.integrate, numpy'];
                const prewarmProcess = spawn(command, args, {
                    // 移除 shell: true
                    windowsHide: true
                });

                prewarmProcess.on('error', (err) => {
                    console.warn(`[PluginManager] Python pre-warming process failed to start. Is Python installed and in the system's PATH? Error: ${err.message}`);
                });

                prewarmProcess.stderr.on('data', (data) => {
                    console.warn(`[PluginManager] Python pre-warming process stderr: ${data.toString().trim()}`);
                });

                prewarmProcess.on('exit', (code) => {
                    if (code === 0) {
                        console.log('[PluginManager] Python scientific libraries pre-warmed successfully.');
                    } else {
                        console.warn(`[PluginManager] Python pre-warming process exited with code ${code}. Please ensure required libraries are installed (pip install sympy scipy numpy).`);
                    }
                });
            } catch (e) {
                console.error(`[PluginManager] An exception occurred while spawning the Python pre-warming process: ${e.message}`);
            }
        } else {
            if (this.debugMode) console.log('[PluginManager] SciCalculator not found, skipping Python pre-warming.');
        }
    }


    getPlaceholderValue(placeholder) {
        // First, try the modern, clean key (e.g., "VCPChromePageInfo")
        let entry = this.staticPlaceholderValues.get(placeholder);

        // If not found, try the legacy key with brackets (e.g., "{{VCPChromePageInfo}}")
        if (entry === undefined) {
            entry = this.staticPlaceholderValues.get(`{{${placeholder}}}`);
        }

        // If still not found, return the "not found" message
        if (entry === undefined) {
            return `[Placeholder ${placeholder} not found]`;
        }

        // Now, handle the value format
        // Modern format: { value: "...", serverId: "..." }
        if (typeof entry === 'object' && entry !== null && entry.hasOwnProperty('value')) {
            return entry.value;
        }

        // Legacy format: raw string
        if (typeof entry === 'string') {
            return entry;
        }

        // Fallback for unexpected formats
        return `[Invalid value format for placeholder ${placeholder}]`;
    }

    async executeMessagePreprocessor(pluginName, messages) {
        const processorModule = this.messagePreprocessors.get(pluginName);
        const pluginManifest = this.plugins.get(pluginName);
        if (!processorModule || !pluginManifest) {
            console.error(`[PluginManager] Message preprocessor plugin "${pluginName}" not found.`);
            return messages;
        }
        if (typeof processorModule.processMessages !== 'function') {
            console.error(`[PluginManager] Plugin "${pluginName}" does not have 'processMessages' function.`);
            return messages;
        }
        try {
            if (this.debugMode) console.log(`[PluginManager] Executing message preprocessor: ${pluginName}`);
            const pluginSpecificConfig = this._getPluginConfig(pluginManifest);
            const processedMessages = await processorModule.processMessages(messages, pluginSpecificConfig);
            if (this.debugMode) console.log(`[PluginManager] Message preprocessor ${pluginName} finished.`);
            return processedMessages;
        } catch (error) {
            console.error(`[PluginManager] Error in message preprocessor ${pluginName}:`, error);
            return messages;
        }
    }

    async shutdownAllPlugins() {
        console.log('[PluginManager] Shutting down all plugins...'); // Keep

        // --- Shutdown VectorDBManager first to stop background processing ---
        if (this.vectorDBManager && typeof this.vectorDBManager.shutdown === 'function') {
            try {
                if (this.debugMode) console.log('[PluginManager] Calling shutdown for VectorDBManager...');
                await this.vectorDBManager.shutdown();
            } catch (error) {
                console.error('[PluginManager] Error during shutdown of VectorDBManager:', error);
            }
        }

        for (const [name, pluginModuleData] of this.messagePreprocessors) {
            const pluginModule = pluginModuleData.module || pluginModuleData;
            if (pluginModule && typeof pluginModule.shutdown === 'function') {
                try {
                    if (this.debugMode) console.log(`[PluginManager] Calling shutdown for ${name}...`);
                    await pluginModule.shutdown();
                } catch (error) {
                    console.error(`[PluginManager] Error during shutdown of plugin ${name}:`, error); // Keep error
                }
            }
        }
        for (const [name, serviceData] of this.serviceModules) {
            if (serviceData.module && typeof serviceData.module.shutdown === 'function') {
                try {
                    if (this.debugMode) console.log(`[PluginManager] Calling shutdown for service plugin ${name}...`);
                    await serviceData.module.shutdown();
                } catch (error) {
                    console.error(`[PluginManager] Error during shutdown of service plugin ${name}:`, error); // Keep error
                }
            }
        }
        for (const job of this.scheduledJobs.values()) {
            job.cancel();
        }
        this.scheduledJobs.clear();
        console.log('[PluginManager] All plugin shutdown processes initiated and scheduled jobs cancelled.'); // Keep
    }

    /**
     * Ensure plugin npm dependencies are installed.
     * If a plugin has package.json but no node_modules/, run npm install.
     * This makes plugins self-contained — they manage their own deps.
     */
    async _ensurePluginDeps(pluginPath, pluginName) {
        const pkgPath = path.join(pluginPath, 'package.json');
        const nmPath = path.join(pluginPath, 'node_modules');

        if (!fsSync.existsSync(pkgPath)) return; // no package.json, nothing to install

        // Check if node_modules exists and has content
        if (fsSync.existsSync(nmPath)) {
            try {
                const entries = fsSync.readdirSync(nmPath);
                if (entries.length > 0) return; // already installed
            } catch {}
        }

        console.log(`[PluginManager] Installing dependencies for plugin "${pluginName}"...`);
        try {
            execSync('npm install --production --legacy-peer-deps', {
                cwd: pluginPath,
                stdio: 'pipe',
                timeout: 60000,
            });
            console.log(`[PluginManager] Dependencies installed for "${pluginName}".`);
        } catch (e) {
            console.error(`[PluginManager] Failed to install dependencies for "${pluginName}":`, e.message);
        }
    }

    /**
     * 注册插件声明的 TVS 变量（capabilities.tvsVariables）。
     *
     * **策略**：首次移动 + 首次注册保护
     * - 若 TVStxt/<filename> 不存在 → 从插件目录移动过来（插件目录的 tvs/ 清空）
     * - 若 TVStxt/<filename> 已存在 → 不覆盖（保留用户在 TvsEditor 里的修改）
     * - 无论哪种情况，都注入 process.env[Var*]
     * - 冲突：同名 Var 已被其他插件占用时 WARN 并跳过
     *
     * 这样 TVStxt/ 是唯一真相，用户通过 AdminPanel 编辑不会被下次启动覆盖。
     * @param {object} manifest 插件 manifest（含 basePath）
     */
    async _registerPluginTvsVariables(manifest) {
        const decls = manifest.capabilities?.tvsVariables;
        if (!Array.isArray(decls) || decls.length === 0) return;

        try {
            await fs.mkdir(TVS_DIR, { recursive: true });
        } catch {}

        const registered = [];
        for (const decl of decls) {
            const key = decl?.key;
            const relFile = decl?.file;
            if (!key || typeof key !== 'string' || !key.startsWith('Var')) {
                console.warn(`[PluginManager] [TVS] ${manifest.name} 声明了非法 key "${key}"（必须以 Var 开头），跳过`);
                continue;
            }
            if (!relFile || typeof relFile !== 'string' || !relFile.toLowerCase().endsWith('.txt')) {
                console.warn(`[PluginManager] [TVS] ${manifest.name}.${key} 声明的 file "${relFile}" 必须是 .txt，跳过`);
                continue;
            }

            // 冲突检测：是否已被其他插件占用
            let conflict = false;
            for (const [otherPlugin, otherDecls] of this.pluginTvsRegistry.entries()) {
                if (otherPlugin === manifest.name) continue;
                if (otherDecls.some(d => d.key === key)) {
                    console.warn(`[PluginManager] [TVS] ${manifest.name}.${key} 与已注册插件 "${otherPlugin}" 冲突，跳过`);
                    conflict = true;
                    break;
                }
            }
            if (conflict) continue;

            const srcPath = path.join(manifest.basePath, relFile);
            const filename = path.basename(relFile);
            const targetPath = path.join(TVS_DIR, filename);

            try {
                const targetExists = fsSync.existsSync(targetPath);
                const srcExists = fsSync.existsSync(srcPath);

                if (!targetExists && srcExists) {
                    // 首次注册：从插件目录移动到 TVStxt/（插件目录文件消失，TVStxt 成为唯一真相）
                    await fs.rename(srcPath, targetPath).catch(async (err) => {
                        // 跨分区 rename 可能失败，降级为 copy + unlink
                        if (err.code === 'EXDEV') {
                            await fs.copyFile(srcPath, targetPath);
                            await fs.unlink(srcPath);
                        } else {
                            throw err;
                        }
                    });
                    console.log(`[PluginManager] [TVS] ${manifest.name} 首次注册 ${key}：已移动 ${relFile} → TVStxt/${filename}`);
                } else if (!targetExists && !srcExists) {
                    // 两边都没有 → 协议声明了但文件缺失
                    console.warn(`[PluginManager] [TVS] ${manifest.name}.${key} 声明的文件 ${srcPath} 不存在，跳过`);
                    continue;
                } else if (targetExists && srcExists) {
                    // TVStxt 已有 + 插件目录也有 → 以 TVStxt 为准，**保留插件目录种子不清理**
                    // 避免破坏主仓库 git tracked 的核心插件种子（Junior 本体的 Plugin/DailyNote/tvs/ 等）
                    // 云安装的新插件场景仍走上一分支（!targetExists && srcExists）正常 move
                    if (this.debugMode) {
                        console.log(`[PluginManager] [TVS] ${manifest.name} 重复注册 ${key}：沿用 TVStxt/${filename}，保留插件种子`);
                    }
                } else {
                    // TVStxt 已有（插件目录没有）→ 正常情况，沿用
                    if (this.debugMode) {
                        console.log(`[PluginManager] [TVS] ${manifest.name} 沿用 ${key} → TVStxt/${filename}`);
                    }
                }

                process.env[key] = filename;
                registered.push({ key, filename, targetPath, srcPath });
            } catch (e) {
                console.warn(`[PluginManager] [TVS] ${manifest.name}.${key} 注册失败 (${srcPath}): ${e.message}`);
            }
        }

        if (registered.length > 0) {
            this.pluginTvsRegistry.set(manifest.name, registered);
        }
    }

    /**
     * 反注册插件的 TVS 变量。
     *
     * **两种模式**：
     * - `mode='reload'`（默认）：只清理 process.env 和 registry（文件留在 TVStxt/，下次注册时会沿用）
     * - `mode='uninstall'`：同时删除 TVStxt/ 下的文件（插件卸载时彻底清理，配合 store.uninstall 一起删除插件目录）
     *
     * @param {string} pluginName
     * @param {'reload'|'uninstall'} mode
     */
    async _unregisterPluginTvsVariables(pluginName, mode = 'reload') {
        const registered = this.pluginTvsRegistry.get(pluginName);
        if (!registered) return;

        for (const { key, targetPath } of registered) {
            // 仅当 env 仍指向本插件注册的文件时才清理，避免误删用户手动配置
            if (process.env[key] === path.basename(targetPath)) {
                delete process.env[key];
            }

            if (mode === 'uninstall') {
                // 卸载模式：删除 TVStxt/ 的文件（插件目录紧接着会被 store.uninstall 整体删除）
                try {
                    await fs.unlink(targetPath);
                    if (this.debugMode) {
                        console.log(`[PluginManager] [TVS] ${pluginName} 卸载：已删除 TVStxt/${path.basename(targetPath)}`);
                    }
                } catch (e) {
                    if (e.code !== 'ENOENT' && this.debugMode) {
                        console.warn(`[PluginManager] [TVS] ${pluginName} 删除 ${targetPath} 失败: ${e.message}`);
                    }
                }
            }
            // reload 模式：不动 TVStxt/ 文件，下次注册时会沿用
        }

        this.pluginTvsRegistry.delete(pluginName);
    }

    /**
     * 注册插件声明的 config.env 贡献（capabilities.envContributions）。
     *
     * 协议：
     *   "envContributions": [
     *     { "key": "IGNORE_FOLDERS", "op": "append-csv", "value": "VCP论坛" },
     *     { "key": "SOME_FLAG", "op": "default", "value": "true" }
     *   ]
     *
     * **op 类型**：
     * - `append-csv` — 视为 CSV 列表（逗号分隔），将 value 追加到列表末尾，去重
     * - `default`    — 仅当 config.env 中 key 不存在或为空时写入
     *
     * **幂等性**：重启后读取 pluginEnvContribRegistry，若已记录则跳过重复应用
     *
     * @param {object} manifest 插件 manifest（含 name）
     */
    async _registerPluginEnvContributions(manifest) {
        const decls = manifest.capabilities?.envContributions;
        if (!Array.isArray(decls) || decls.length === 0) return;

        const pluginName = manifest.name;
        const existing = this.pluginEnvContribRegistry.get(pluginName) || [];
        const applied = [];

        // 读一次当前 config.env 文本
        let envText = '';
        try {
            if (fsSync.existsSync(this._configEnvPath)) {
                envText = await fs.readFile(this._configEnvPath, 'utf8');
            }
        } catch (e) {
            console.warn(`[PluginManager] [ENV] ${pluginName} 读 config.env 失败: ${e.message}`);
            return;
        }

        let changed = false;
        for (const decl of decls) {
            const key = decl?.key;
            const op = decl?.op || 'default';
            const value = decl?.value;
            if (!key || typeof key !== 'string' || value === undefined) {
                console.warn(`[PluginManager] [ENV] ${pluginName} 声明非法 contribution: ${JSON.stringify(decl)}，跳过`);
                continue;
            }

            // 幂等：若 registry 已记录同 key+op+value → 跳过
            const already = existing.find(e => e.key === key && e.op === op && e.value === value);
            if (already) {
                applied.push(already);
                continue;
            }

            const parsed = this._parseEnvKey(envText, key);
            if (op === 'append-csv') {
                const current = parsed ? parsed.value : '';
                const list = current ? current.split(',').map(s => s.trim()).filter(Boolean) : [];
                if (!list.includes(value)) {
                    list.push(value);
                    const newVal = list.join(',');
                    envText = parsed
                        ? this._replaceEnvLine(envText, parsed, newVal)
                        : this._appendEnvLine(envText, key, newVal, `# appended by plugin ${pluginName}`);
                    changed = true;
                    applied.push({ key, op, value, appliedValue: value, prevSnapshot: current, description: decl.description });
                    if (this.debugMode) {
                        console.log(`[PluginManager] [ENV] ${pluginName} append-csv ${key}: + "${value}"`);
                    }
                } else {
                    // 已在列表里，记录但不写文件
                    applied.push({ key, op, value, appliedValue: value, prevSnapshot: current, alreadyPresent: true });
                }
            } else if (op === 'default') {
                const current = parsed ? parsed.value : null;
                if (current === null || current === '') {
                    envText = parsed
                        ? this._replaceEnvLine(envText, parsed, value)
                        : this._appendEnvLine(envText, key, value, `# default by plugin ${pluginName}`);
                    changed = true;
                    applied.push({ key, op, value, appliedValue: value, prevSnapshot: current, description: decl.description });
                    if (this.debugMode) {
                        console.log(`[PluginManager] [ENV] ${pluginName} default ${key}="${value}"`);
                    }
                } else {
                    // 用户已有值，不覆盖，但记录
                    applied.push({ key, op, value, appliedValue: null, prevSnapshot: current, userAlreadySet: true });
                }
            } else {
                console.warn(`[PluginManager] [ENV] ${pluginName}.${key}: 未知 op "${op}"，跳过`);
            }
        }

        if (changed) {
            await fs.writeFile(this._configEnvPath, envText, 'utf8');
            // 同步 process.env（这样本次启动立即生效）
            for (const a of applied) {
                if (a.appliedValue !== null && a.appliedValue !== undefined) {
                    if (a.op === 'append-csv') {
                        process.env[a.key] = this._parseEnvKey(envText, a.key)?.value || '';
                    } else {
                        process.env[a.key] = a.appliedValue;
                    }
                }
            }
        }

        if (applied.length > 0) {
            this.pluginEnvContribRegistry.set(pluginName, applied);
            await this._persistEnvRegistry();
        }
    }

    /**
     * 反注册插件的 env 贡献。
     * - `append-csv`: 从 CSV 列表中移除 appliedValue（若当前 value 里还有），剩下的保留
     * - `default`: 若当前 config.env 值仍等于 appliedValue → 删除该行；否则保留（用户改过）
     *
     * @param {string} pluginName
     */
    async _unregisterPluginEnvContributions(pluginName) {
        const registered = this.pluginEnvContribRegistry.get(pluginName);
        if (!registered || registered.length === 0) return;

        let envText = '';
        try {
            if (fsSync.existsSync(this._configEnvPath)) {
                envText = await fs.readFile(this._configEnvPath, 'utf8');
            }
        } catch (e) {
            console.warn(`[PluginManager] [ENV] ${pluginName} 反注册读 config.env 失败: ${e.message}`);
            return;
        }

        let changed = false;
        for (const entry of registered) {
            if (entry.alreadyPresent || entry.userAlreadySet) continue; // 没应用就无需回滚
            const parsed = this._parseEnvKey(envText, entry.key);
            if (!parsed) continue;

            if (entry.op === 'append-csv') {
                const list = parsed.value.split(',').map(s => s.trim()).filter(Boolean);
                const idx = list.indexOf(entry.value);
                if (idx >= 0) {
                    list.splice(idx, 1);
                    const newVal = list.join(',');
                    envText = this._replaceEnvLine(envText, parsed, newVal);
                    changed = true;
                    if (this.debugMode) console.log(`[PluginManager] [ENV] ${pluginName} 回滚 append-csv ${entry.key}: - "${entry.value}"`);
                }
            } else if (entry.op === 'default') {
                if (parsed.value === entry.appliedValue) {
                    envText = this._deleteEnvLine(envText, parsed);
                    changed = true;
                    if (this.debugMode) console.log(`[PluginManager] [ENV] ${pluginName} 回滚 default ${entry.key}`);
                }
            }
        }

        if (changed) {
            await fs.writeFile(this._configEnvPath, envText, 'utf8');
        }
        this.pluginEnvContribRegistry.delete(pluginName);
        await this._persistEnvRegistry();
    }

    /**
     * 单插件整体反注册 —— 从 PluginManager 内存中移除指定插件的所有登记
     *
     * 与 _reloadPlugins 的全量清理不同，此方法只清理单个插件，其他插件不受影响。
     * 协议完整性需要调用方按顺序执行：
     *   1. _unregisterPluginTvsVariables(name, 'uninstall')  — TVS 还原
     *   2. _unregisterPluginEnvContributions(name)           — env 回滚
     *   3. _unregisterSinglePlugin(name)                     — 主注册表清理
     *   4. 文件系统目录删除（store.uninstall）
     *
     * @param {string} pluginName
     * @returns {Promise<{found: boolean, cleaned: string[]}>}
     */
    async _unregisterSinglePlugin(pluginName) {
        const manifest = this.plugins.get(pluginName);
        if (!manifest) {
            return { found: false, cleaned: [] };
        }

        const cleaned = [];

        // 1. service 插件：先 shutdown，再移除
        if (this.serviceModules.has(pluginName)) {
            const serviceData = this.serviceModules.get(pluginName);
            try {
                if (serviceData && serviceData.module && typeof serviceData.module.shutdown === 'function') {
                    await serviceData.module.shutdown();
                }
            } catch (e) {
                console.warn(`[PluginManager] ${pluginName} service shutdown 失败（继续清理）: ${e.message}`);
            }
            this.serviceModules.delete(pluginName);
            cleaned.push('serviceModules');
        }

        // 2. messagePreprocessor 注册表 + 顺序数组
        if (this.messagePreprocessors.has(pluginName)) {
            this.messagePreprocessors.delete(pluginName);
            cleaned.push('messagePreprocessors');
        }
        const orderIdx = this.preprocessorOrder.indexOf(pluginName);
        if (orderIdx >= 0) {
            this.preprocessorOrder.splice(orderIdx, 1);
            cleaned.push('preprocessorOrder');
        }

        // 3. static 插件占位符
        if (Array.isArray(manifest.systemPromptPlaceholders)) {
            for (const ph of manifest.systemPromptPlaceholders) {
                if (ph.placeholder && this.staticPlaceholderValues.has(ph.placeholder)) {
                    this.staticPlaceholderValues.delete(ph.placeholder);
                    cleaned.push(`staticPlaceholder:${ph.placeholder}`);
                }
            }
        }

        // 4. 定时任务
        if (this.scheduledJobs.has(pluginName)) {
            try {
                const job = this.scheduledJobs.get(pluginName);
                if (job && typeof job.cancel === 'function') job.cancel();
            } catch (e) {
                console.warn(`[PluginManager] ${pluginName} job cancel 失败（继续清理）: ${e.message}`);
            }
            this.scheduledJobs.delete(pluginName);
            cleaned.push('scheduledJobs');
        }

        // 5. pluginAdminRouter 缓存 + require.cache 清理
        if (this._pluginAdminRouterCache && this._pluginAdminRouterCache.has(pluginName)) {
            this._pluginAdminRouterCache.delete(pluginName);
            cleaned.push('pluginAdminRouterCache');
        }
        if (manifest.basePath) {
            try {
                const adminRouterPath = path.join(manifest.basePath, 'admin-router.js');
                if (require.cache[require.resolve(adminRouterPath)]) {
                    delete require.cache[require.resolve(adminRouterPath)];
                    cleaned.push('requireCache:admin-router');
                }
            } catch (_) { /* 模块未加载过，忽略 */ }
        }

        // 6. 主注册表（最后删，上面各步需要 manifest 信息）
        this.plugins.delete(pluginName);
        cleaned.push('plugins');

        // 7. 重建 VCP 工具描述（individualPluginDescriptions 被 buildVCPDescription 重建）
        this.buildVCPDescription();

        if (this.debugMode) {
            console.log(`[PluginManager] _unregisterSinglePlugin(${pluginName}) cleaned: ${cleaned.join(', ')}`);
        }

        return { found: true, cleaned };
    }

    /**
     * 单插件整体注册 —— 在运行时把指定插件加载到 PluginManager（对称 _unregisterSinglePlugin）
     *
     * 用于「插件商店安装后热加载」场景：装完插件无需重启主服务即可使用。
     * 与 loadPlugins 的全量扫描不同，此方法只处理单个插件，不影响其他已注册插件。
     *
     * 执行顺序（对称于 _unregisterSinglePlugin 的反向）：
     *   1. 读 manifest + config.env
     *   2. plugins Map 注册
     *   3. _registerPluginTvsVariables（tvs 协议）
     *   4. _registerPluginEnvContributions（env 贡献）
     *   5. 按 pluginType 分支：
     *      - messagePreprocessor/service/hybridservice → require 脚本 → initialize → 注册到对应 Map
     *      - static → 设置加载中占位符 + 异步首次更新 + cron 定时任务
     *   6. buildVCPDescription（重建 VCP 工具描述）
     *
     * @param {string} pluginName
     * @returns {Promise<{ok: boolean, reason?: string, manifest?: object, registered?: string[]}>}
     */
    async _registerSinglePlugin(pluginName) {
        // 幂等性：已注册则跳过（避免 install 多次触发 / 竞态）
        if (this.plugins.has(pluginName)) {
            return { ok: false, reason: 'already-registered' };
        }

        const pluginPath = path.join(PLUGIN_DIR, pluginName);
        const manifestPath = path.join(pluginPath, manifestFileName);
        let manifest;
        try {
            const manifestContent = await fs.readFile(manifestPath, 'utf-8');
            manifest = JSON.parse(manifestContent);
        } catch (err) {
            return { ok: false, reason: `manifest-read-failed: ${err.message}` };
        }

        if (!manifest.name || !manifest.pluginType || !manifest.entryPoint) {
            return { ok: false, reason: 'manifest-incomplete' };
        }
        if (manifest.name !== pluginName) {
            return { ok: false, reason: `manifest-name-mismatch: expected ${pluginName}, got ${manifest.name}` };
        }

        // 读 config.env（可选）
        manifest.basePath = pluginPath;
        manifest.pluginSpecificEnvConfig = {};
        try {
            const pluginEnvContent = await fs.readFile(path.join(pluginPath, 'config.env'), 'utf-8');
            manifest.pluginSpecificEnvConfig = dotenv.parse(pluginEnvContent);
        } catch (envError) {
            if (envError.code !== 'ENOENT') {
                console.warn(`[PluginManager] Error reading config.env for ${manifest.name}: ${envError.message}`);
            }
        }

        const registered = [];

        // 1. 主注册表
        this.plugins.set(manifest.name, manifest);
        registered.push('plugins');
        console.log(`[PluginManager] 🔌 Hot-loading: ${manifest.displayName} (${manifest.name}, Type: ${manifest.pluginType})`);

        // 2. TVS 变量协议
        try {
            await this._registerPluginTvsVariables(manifest);
            registered.push('tvsVariables');
        } catch (e) {
            console.warn(`[PluginManager] ${manifest.name} tvs 注册失败（继续）: ${e.message}`);
        }

        // 3. env 贡献协议
        try {
            await this._registerPluginEnvContributions(manifest);
            registered.push('envContributions');
        } catch (e) {
            console.warn(`[PluginManager] ${manifest.name} env 贡献注册失败（继续）: ${e.message}`);
        }

        // 4. 按类型分支加载
        const isPreprocessor = manifest.pluginType === 'messagePreprocessor' || manifest.pluginType === 'hybridservice';
        const isService = manifest.pluginType === 'service' || manifest.pluginType === 'hybridservice';
        const isStatic = manifest.pluginType === 'static';
        const isDirectCommunication = isPreprocessor || isService;

        if (isDirectCommunication && manifest.entryPoint.script && manifest.communication?.protocol === 'direct') {
            try {
                await this._ensurePluginDeps(pluginPath, manifest.name);
                const scriptPath = path.join(pluginPath, manifest.entryPoint.script);
                // 清 require 缓存避免装-卸-再装时用到旧模块
                try {
                    const resolved = require.resolve(scriptPath);
                    if (require.cache[resolved]) delete require.cache[resolved];
                } catch (_) { /* resolve 失败说明新装，忽略 */ }
                const module = require(scriptPath);

                if (isPreprocessor && typeof module.processMessages === 'function') {
                    this.messagePreprocessors.set(manifest.name, module);
                    // 追加到 preprocessorOrder 末尾（若用户在 AdminPanel 调序，后续会覆盖）
                    if (!this.preprocessorOrder.includes(manifest.name)) {
                        this.preprocessorOrder.push(manifest.name);
                    }
                    registered.push('messagePreprocessors');
                }
                if (isService) {
                    this.serviceModules.set(manifest.name, { manifest, module });
                    registered.push('serviceModules');
                }

                // initialize（注入 config + contextBridge 兼容）
                if (typeof module.initialize === 'function') {
                    const initialConfig = this._getPluginConfig(manifest);
                    initialConfig.PORT = process.env.PORT;
                    initialConfig.Key = process.env.Key;
                    initialConfig.PROJECT_BASE_PATH = this.projectBasePath;

                    const dependencies = { vcpLogFunctions: this.getVCPLogFunctions() };

                    // ContextBridge 通用依赖注入（manifest 声明 requiresContextBridge）
                    if (manifest.requiresContextBridge) {
                        const ragPluginModule = this.messagePreprocessors.get('RAGDiaryPlugin');
                        if (ragPluginModule && typeof ragPluginModule.getContextBridge === 'function') {
                            dependencies.contextBridge = ragPluginModule.getContextBridge();
                        } else {
                            console.warn(`[PluginManager] ${manifest.name} 声明 requiresContextBridge，但 RAGDiaryPlugin 不可用`);
                        }
                    }

                    await module.initialize(initialConfig, dependencies);
                    registered.push('initialized');
                }
            } catch (e) {
                console.error(`[PluginManager] Hot-load ${manifest.name} 模块失败:`, e);
                // 加载失败：回滚主注册表（保持一致性）
                this.plugins.delete(manifest.name);
                return { ok: false, reason: `module-load-failed: ${e.message}`, registered };
            }
        } else if (isStatic) {
            // static 插件：先设置加载中占位符
            if (manifest.capabilities && Array.isArray(manifest.capabilities.systemPromptPlaceholders)) {
                for (const ph of manifest.capabilities.systemPromptPlaceholders) {
                    if (ph.placeholder) {
                        this.staticPlaceholderValues.set(ph.placeholder, {
                            value: `[${manifest.displayName} a-zheng-zai-jia-zai-zhong... ]`,
                            serverId: 'local',
                        });
                    }
                }
                registered.push('staticPlaceholderValues');
            }
            // 后台触发首次更新
            this._updateStaticPluginValue(manifest).catch(err => {
                console.error(`[PluginManager] Hot-load static ${manifest.name} 首次更新失败: ${err.message}`);
            });
            // 注册 cron 定时任务
            if (manifest.refreshIntervalCron) {
                try {
                    const job = schedule.scheduleJob(manifest.refreshIntervalCron, () => {
                        this._updateStaticPluginValue(manifest).catch(err => {
                            console.error(`[PluginManager] Scheduled update for ${manifest.name} failed: ${err.message}`);
                        });
                    });
                    this.scheduledJobs.set(manifest.name, job);
                    registered.push('scheduledJobs');
                } catch (e) {
                    console.error(`[PluginManager] Invalid cron for ${manifest.name}: ${e.message}`);
                }
            }
        }

        // 5. 重建 VCP 工具描述（让 {{VCPAllTools}} / {{VCP<name>}} 立即包含新插件）
        this.buildVCPDescription();
        registered.push('vcpDescription');

        if (this.debugMode) {
            console.log(`[PluginManager] _registerSinglePlugin(${pluginName}) registered: ${registered.join(', ')}`);
        }

        return { ok: true, manifest, registered };
    }

    // —— env 文本工具 ——

    /** 找到某 key 的行：{ lineIdx, key, value, rawLine, prefix, quote } 或 null */
    _parseEnvKey(text, key) {
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(new RegExp(`^(\\s*)(${this._escapeRegExp(key)})(\\s*=\\s*)(["']?)(.*?)\\4\\s*$`));
            if (m) {
                return { lineIdx: i, key, prefix: m[1], sep: m[3], quote: m[4], value: m[5], rawLine: lines[i] };
            }
        }
        return null;
    }

    _escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    _replaceEnvLine(text, parsed, newValue) {
        const lines = text.split(/\r?\n/);
        const q = parsed.quote;
        // 特殊字符自动加双引号
        const needQuote = !q && /[\s#"']/.test(newValue);
        const finalQ = needQuote ? '"' : q;
        lines[parsed.lineIdx] = `${parsed.prefix}${parsed.key}${parsed.sep}${finalQ}${newValue}${finalQ}`;
        return lines.join('\n');
    }

    _appendEnvLine(text, key, value, comment) {
        const needQuote = /[\s#"']/.test(value);
        const q = needQuote ? '"' : '';
        const safe = value.replace(/"/g, '"');
        let suffix = text.endsWith('\n') ? '' : '\n';
        if (comment) suffix += comment + '\n';
        return text + suffix + `${key}=${q}${safe}${q}\n`;
    }

    _deleteEnvLine(text, parsed) {
        const lines = text.split(/\r?\n/);
        lines.splice(parsed.lineIdx, 1);
        return lines.join('\n');
    }

    async loadPlugins() {
        console.log('[PluginManager] Starting plugin discovery...');
        // 1. 清理现有插件状态
        // 1.1 识别并关闭本地插件，保留分布式插件
        const distributedPlugins = new Map();
        const localModulesToShutdown = new Set();

        for (const [name, manifest] of this.plugins.entries()) {
            if (manifest.isDistributed) {
                distributedPlugins.set(name, manifest);
            } else {
                // 收集本地插件模块以进行清理
                const preprocessor = this.messagePreprocessors.get(name);
                if (preprocessor) localModulesToShutdown.add(preprocessor);

                const service = this.serviceModules.get(name)?.module;
                if (service) localModulesToShutdown.add(service);
            }
        }

        // 执行清理：在重新加载前关闭旧的本地插件实例，释放资源
        for (const module of localModulesToShutdown) {
            if (typeof module.shutdown === 'function') {
                try {
                    module.shutdown();
                } catch (e) {
                    console.error(`[PluginManager] Error during hot-reload shutdown of a plugin:`, e.message);
                }
            }
        }

        // 反注册所有本地插件的 TVS 变量（保留分布式插件的）
        const localTvsNames = Array.from(this.pluginTvsRegistry.keys())
            .filter(n => !distributedPlugins.has(n));
        for (const name of localTvsNames) {
            await this._unregisterPluginTvsVariables(name);
        }

        // 反注册 env 贡献（仅本地插件）
        const localEnvNames = Array.from(this.pluginEnvContribRegistry.keys())
            .filter(n => !distributedPlugins.has(n));
        for (const name of localEnvNames) {
            await this._unregisterPluginEnvContributions(name);
        }

        this.plugins = distributedPlugins; // 仅保留分布式插件，本地插件将被重新发现
        this.messagePreprocessors.clear();
        this.staticPlaceholderValues.clear();
        this.serviceModules.clear();

        const discoveredPreprocessors = new Map();
        const modulesToInitialize = [];

        try {
            // 2. 发现并加载所有插件模块，但不初始化
            const pluginFolders = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
            for (const folder of pluginFolders) {
                if (folder.isDirectory()) {
                    const pluginPath = path.join(PLUGIN_DIR, folder.name);
                    const manifestPath = path.join(pluginPath, manifestFileName);
                    try {
                        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
                        const manifest = JSON.parse(manifestContent);
                        if (!manifest.name || !manifest.pluginType || !manifest.entryPoint) continue;
                        if (this.plugins.has(manifest.name)) continue;

                        manifest.basePath = pluginPath;
                        manifest.pluginSpecificEnvConfig = {};
                        try {
                            const pluginEnvContent = await fs.readFile(path.join(pluginPath, 'config.env'), 'utf-8');
                            manifest.pluginSpecificEnvConfig = dotenv.parse(pluginEnvContent);
                        } catch (envError) {
                            if (envError.code !== 'ENOENT') console.warn(`[PluginManager] Error reading config.env for ${manifest.name}:`, envError.message);
                        }

                        this.plugins.set(manifest.name, manifest);
                        console.log(`[PluginManager] Loaded manifest: ${manifest.displayName} (${manifest.name}, Type: ${manifest.pluginType})`);

                        // 注册插件声明的 TVS 变量（capabilities.tvsVariables）
                        await this._registerPluginTvsVariables(manifest);

                        // 注册插件贡献的 config.env 字段（capabilities.envContributions）
                        await this._registerPluginEnvContributions(manifest);

                        const isPreprocessor = manifest.pluginType === 'messagePreprocessor' || manifest.pluginType === 'hybridservice';
                        const isService = manifest.pluginType === 'service' || manifest.pluginType === 'hybridservice';

                        if ((isPreprocessor || isService) && manifest.entryPoint.script && manifest.communication?.protocol === 'direct') {
                            try {
                                // Auto-install plugin dependencies if package.json exists
                                await this._ensurePluginDeps(pluginPath, manifest.name);

                                const scriptPath = path.join(pluginPath, manifest.entryPoint.script);
                                const module = require(scriptPath);

                                modulesToInitialize.push({ manifest, module });

                                if (isPreprocessor && typeof module.processMessages === 'function') {
                                    discoveredPreprocessors.set(manifest.name, module);
                                }
                                if (isService) {
                                    this.serviceModules.set(manifest.name, { manifest, module });
                                }
                            } catch (e) {
                                console.error(`[PluginManager] Error loading module for ${manifest.name}:`, e);
                            }
                        }
                    } catch (error) {
                        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
                            console.error(`[PluginManager] Error loading plugin from ${folder.name}:`, error);
                        }
                    }
                }
            }

            // 3. 确定预处理器加载顺序
            const availablePlugins = new Set(discoveredPreprocessors.keys());
            let finalOrder = [];
            try {
                const orderContent = await fs.readFile(PREPROCESSOR_ORDER_FILE, 'utf-8');
                const savedOrder = JSON.parse(orderContent);
                if (Array.isArray(savedOrder)) {
                    savedOrder.forEach(pluginName => {
                        if (availablePlugins.has(pluginName)) {
                            finalOrder.push(pluginName);
                            availablePlugins.delete(pluginName);
                        }
                    });
                }
            } catch (error) {
                if (error.code !== 'ENOENT') console.error(`[PluginManager] Error reading existing ${PREPROCESSOR_ORDER_FILE}:`, error);
            }

            finalOrder.push(...Array.from(availablePlugins).sort());

            // 4. 注册预处理器
            for (const pluginName of finalOrder) {
                this.messagePreprocessors.set(pluginName, discoveredPreprocessors.get(pluginName));
            }
            this.preprocessorOrder = finalOrder;
            if (finalOrder.length > 0) console.log('[PluginManager] Final message preprocessor order: ' + finalOrder.join(' -> '));

            // 5. VectorDBManager 应该已经由 server.js 初始化，这里不再重复初始化
            if (!this.vectorDBManager) {
                console.warn('[PluginManager] VectorDBManager not set! Plugins requiring it may fail.');
            }

            // 6. 按顺序初始化所有模块
            const allModulesMap = new Map(modulesToInitialize.map(m => [m.manifest.name, m]));
            const initializationOrder = [...this.preprocessorOrder];
            allModulesMap.forEach((_, name) => {
                if (!initializationOrder.includes(name)) {
                    initializationOrder.push(name);
                }
            });

            // 🔧 依赖时序修复：ContextBridge 提供者（RAGDiaryPlugin）必须优先初始化
            // 否则依赖它的插件（如 ContextFoldingV2）拿到的 bridge 里 foldingStore 会是 null
            // 初始化顺序不影响 preprocessor 执行顺序（后者由 this.preprocessorOrder 决定）
            const bridgeProviderIdx = initializationOrder.indexOf('RAGDiaryPlugin');
            if (bridgeProviderIdx > 0) {
                initializationOrder.splice(bridgeProviderIdx, 1);
                initializationOrder.unshift('RAGDiaryPlugin');
                if (this.debugMode) console.log('[PluginManager] 🔧 RAGDiaryPlugin 已提前到初始化队首（ContextBridge 依赖保证）');
            }

            for (const pluginName of initializationOrder) {
                const item = allModulesMap.get(pluginName);
                if (!item || typeof item.module.initialize !== 'function') continue;

                const { manifest, module } = item;
                try {
                    const initialConfig = this._getPluginConfig(manifest);
                    initialConfig.PORT = process.env.PORT;
                    initialConfig.Key = process.env.Key;
                    initialConfig.PROJECT_BASE_PATH = this.projectBasePath;

                    const dependencies = { vcpLogFunctions: this.getVCPLogFunctions() };

                    // --- 注入 VectorDBManager ---
                    if (manifest.name === 'RAGDiaryPlugin') {
                        dependencies.vectorDBManager = this.vectorDBManager;
                    }

                    // --- 🌟 ContextBridge 通用依赖注入 ---
                    // 任何在 manifest 中声明 "requiresContextBridge": true 的插件都能获得 RAG 上下文向量接口
                    if (manifest.requiresContextBridge) {
                        const ragPluginModule = this.messagePreprocessors.get('RAGDiaryPlugin');
                        if (ragPluginModule && typeof ragPluginModule.getContextBridge === 'function') {
                            dependencies.contextBridge = ragPluginModule.getContextBridge();
                            if (this.debugMode) console.log(`[PluginManager] 🌟 Injected ContextBridge into ${manifest.name}.`);
                        } else {
                            console.warn(`[PluginManager] Plugin "${manifest.name}" requires ContextBridge, but RAGDiaryPlugin is not available.`);
                        }
                    }

                    // --- LightMemo 特殊依赖注入（向后兼容 + ContextBridge） ---
                    if (manifest.name === 'LightMemo') {
                        const ragPluginModule = this.messagePreprocessors.get('RAGDiaryPlugin');
                        if (ragPluginModule && ragPluginModule.vectorDBManager && typeof ragPluginModule.getSingleEmbedding === 'function') {
                            dependencies.vectorDBManager = ragPluginModule.vectorDBManager;
                            dependencies.getSingleEmbedding = ragPluginModule.getSingleEmbedding.bind(ragPluginModule);
                            // 同时注入 ContextBridge（如果 LightMemo 未在 manifest 中声明，也主动注入）
                            if (!dependencies.contextBridge && typeof ragPluginModule.getContextBridge === 'function') {
                                dependencies.contextBridge = ragPluginModule.getContextBridge();
                            }
                            if (this.debugMode) console.log(`[PluginManager] Injected VectorDBManager, getSingleEmbedding and ContextBridge into LightMemo.`);
                        } else {
                            console.error(`[PluginManager] Critical dependency failure: RAGDiaryPlugin or its components not available for LightMemo injection.`);
                        }
                    }
                    // --- 注入结束 ---

                    await module.initialize(initialConfig, dependencies);
                } catch (e) {
                    console.error(`[PluginManager] Error initializing module for ${manifest.name}:`, e);
                }
            }

            this.buildVCPDescription();
            console.log(`[PluginManager] Plugin discovery finished. Loaded ${this.plugins.size} plugins.`);
        } catch (error) {
            if (error.code === 'ENOENT') console.error(`[PluginManager] Plugin directory ${PLUGIN_DIR} not found.`);
            else console.error('[PluginManager] Error reading plugin directory:', error);
        }
    }

    buildVCPDescription() {
        this.individualPluginDescriptions.clear(); // Clear previous descriptions
        let overallLog = ['[PluginManager] Building individual VCP descriptions:'];

        for (const plugin of this.plugins.values()) {
            if (plugin.capabilities && plugin.capabilities.invocationCommands && plugin.capabilities.invocationCommands.length > 0) {
                let pluginSpecificDescriptions = [];
                plugin.capabilities.invocationCommands.forEach(cmd => {
                    if (cmd.description) {
                        let commandDescription = `- ${plugin.displayName} (${plugin.name}) - 命令: ${cmd.command || 'N/A'}:\n`; // Assuming cmd might have a 'command' field or similar identifier
                        const indentedCmdDescription = cmd.description.split('\n').map(line => `    ${line}`).join('\n');
                        commandDescription += `${indentedCmdDescription}`;

                        if (cmd.example) {
                            const exampleHeader = `\n  调用示例:\n`;
                            const indentedExample = cmd.example.split('\n').map(line => `    ${line}`).join('\n');
                            commandDescription += exampleHeader + indentedExample;
                        }
                        pluginSpecificDescriptions.push(commandDescription);
                    }
                });

                if (pluginSpecificDescriptions.length > 0) {
                    const placeholderKey = `VCP${plugin.name}`;
                    const fullDescriptionForPlugin = pluginSpecificDescriptions.join('\n\n');
                    this.individualPluginDescriptions.set(placeholderKey, fullDescriptionForPlugin);
                    overallLog.push(`  - Generated description for {{${placeholderKey}}} (Length: ${fullDescriptionForPlugin.length})`);
                }
            }
        }

        if (this.individualPluginDescriptions.size === 0) {
            overallLog.push("  - No VCP plugins with invocation commands found to generate descriptions for.");
        }
        if (this.debugMode) console.log(overallLog.join('\n'));
    }

    // New method to get all individual descriptions
    getIndividualPluginDescriptions() {
        return this.individualPluginDescriptions;
    }

    getAllPlaceholderValues() {
        return this.staticPlaceholderValues;
    }

    // getVCPDescription() { // This method is no longer needed as VCPDescription is deprecated
    //     return this.vcpDescription;
    // }

    getPlugin(name) {
        return this.plugins.get(name);
    }

    getServiceModule(name) {
        return this.serviceModules.get(name)?.module;
    }

    /**
     * 🔌 插件 admin API 协议 — 拿到插件自己暴露的 Express Router
     *
     * 插件通过 `module.exports.pluginAdminRouter = router` 暴露自己的 admin 路由。
     * 主项目路由层会通过 `/admin_api/plugins/:name/api/*` 把请求分发到这个 router。
     *
     * 这是"插件前后端通信协议"的后端挂载点，实现插件 admin UI 与主面板的完美解耦。
     *
     * @param {string} name 插件名
     * @returns {express.Router|null}
     */
    getPluginAdminRouter(name) {
        // hybridservice / service 类：插件模块存在 serviceModules
        const serviceItem = this.serviceModules.get(name);
        if (serviceItem?.module?.pluginAdminRouter) {
            return serviceItem.module.pluginAdminRouter;
        }
        // 纯 messagePreprocessor 类：存在 messagePreprocessors
        const pre = this.messagePreprocessors.get(name);
        if (pre?.pluginAdminRouter) return pre.pluginAdminRouter;

        // 🌟 synchronous 类插件 fallback：lazy-require 插件目录下的 admin-router.js
        // 允许 stdio 子进程类插件也提供面板 API（如 VCPForum）
        if (!this._pluginAdminRouterCache) this._pluginAdminRouterCache = new Map();
        if (this._pluginAdminRouterCache.has(name)) {
            return this._pluginAdminRouterCache.get(name);
        }
        const manifest = this.plugins.get(name);
        if (manifest?.basePath) {
            const adminRouterPath = path.join(manifest.basePath, 'admin-router.js');
            if (fsSync.existsSync(adminRouterPath)) {
                try {
                    delete require.cache[require.resolve(adminRouterPath)];
                    const mod = require(adminRouterPath);
                    const router = (mod && typeof mod === 'function' && !mod.stack) ? mod({ manifest }) : mod;
                    if (router) {
                        this._pluginAdminRouterCache.set(name, router);
                        if (this.debugMode) console.log(`[PluginManager] Lazy-loaded admin-router for ${name}`);
                        return router;
                    }
                } catch (e) {
                    console.warn(`[PluginManager] 加载 ${name}/admin-router.js 失败: ${e.message}`);
                }
            }
        }
        this._pluginAdminRouterCache.set(name, null);
        return null;
    }

    /** 清缓存（重载/卸载插件时调用） */
    _clearPluginAdminRouterCache(name) {
        if (this._pluginAdminRouterCache) this._pluginAdminRouterCache.delete(name);
    }

    // 新增：获取 VCPLog 插件的推送函数，供其他插件依赖注入
    getVCPLogFunctions() {
        const vcpLogModule = this.getServiceModule('VCPLog');
        const self = this;
        return {
            pushVcpLog: (data) => {
                if (vcpLogModule && typeof vcpLogModule.pushVcpLog === 'function') {
                    vcpLogModule.pushVcpLog(data);
                }
                self.emit('vcp_log', data);
            },
            pushVcpInfo: (data) => {
                if (vcpLogModule && typeof vcpLogModule.pushVcpInfo === 'function') {
                    vcpLogModule.pushVcpInfo(data);
                }
                self.emit('vcp_info', data);
            }
        };
    }

    async processToolCall(toolName, toolArgs, requestIp = null) {
        const plugin = this.plugins.get(toolName);
        if (!plugin) {
            throw new Error(`[PluginManager] Plugin "${toolName}" not found for tool call.`);
        }

        // Helper function to generate a timestamp string
        const _getFormattedLocalTimestamp = () => {
            const date = new Date();
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
            const timezoneOffsetMinutes = date.getTimezoneOffset();
            const offsetSign = timezoneOffsetMinutes > 0 ? "-" : "+";
            const offsetHours = Math.abs(Math.floor(timezoneOffsetMinutes / 60)).toString().padStart(2, '0');
            const offsetMinutes = Math.abs(timezoneOffsetMinutes % 60).toString().padStart(2, '0');
            const timezoneString = `${offsetSign}${offsetHours}:${offsetMinutes}`;
            return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${timezoneString}`;
        };

        const maidNameFromArgs = toolArgs && toolArgs.maid ? toolArgs.maid : null;
        const pluginSpecificArgs = { ...toolArgs };
        if (maidNameFromArgs) {
            // The 'maid' parameter is intentionally passed through for plugins like DeepMemo.
            // delete pluginSpecificArgs.maid;
        }

        // --- 预先拉取所有的异地文件，将其透明化 ---
        // 逻辑漏洞修复：如果是分布式插件，则不进行预拉取，直接透传 file:// 协议，由分布式端自行处理
        if (!plugin.isDistributed) {
            const resolveArgsUrls = async (obj) => {
                if (!obj || typeof obj !== 'object') return;
                for (const key of Object.keys(obj)) {
                    const val = obj[key];
                    if (typeof val === 'string') {
                        if (val.startsWith('file://')) {
                            if (this.debugMode) console.log(`[PluginManager] Intercepted file URL in args: ${val}`);
                            obj[key] = await FileFetcherServer.resolveFileUrl(val, requestIp);
                        } else if (val.includes('file://')) {
                            // 优化正则表达式：增加对中文标点（），。？！）和换行符的排除，防止匹配过长导致解析失败
                            const fileRegex = /file:\/\/[^\s"'()\]\}\>，。？！）\r\n]+/g;
                            const matches = val.match(fileRegex);
                            if (matches) {
                                let newVal = val;
                                for (const matchUrl of matches) {
                                    if (this.debugMode) console.log(`[PluginManager] Intercepted embedded file URL in args: ${matchUrl}`);
                                    const resolvedUrl = await FileFetcherServer.resolveFileUrl(matchUrl, requestIp);
                                    newVal = newVal.split(matchUrl).join(resolvedUrl); // replaceAll fallback
                                }
                                obj[key] = newVal;
                            }
                        }
                    } else if (typeof val === 'object' && val !== null) {
                        await resolveArgsUrls(val);
                    }
                }
            };

            try {
                await resolveArgsUrls(pluginSpecificArgs);
            } catch (resolveError) {
                throw new Error(JSON.stringify({ plugin_error: `Failed to pre-fetch files: ${resolveError.message}` }));
            }
        }
        // --- 透明化处理结束 ---

        // --- 人工审核逻辑 (新增) ---
        if (this.toolApprovalManager.shouldApprove(toolName, pluginSpecificArgs)) {
            const requestId = `approve-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            if (this.debugMode) console.log(`[PluginManager] Tool call for "${toolName}" requires manual approval. Request ID: ${requestId}`);

            const approvalPromise = new Promise((resolve, reject) => {
                const timeoutDuration = this.toolApprovalManager.getTimeoutMs();
                const timeoutId = setTimeout(() => {
                    if (this.pendingApprovals.has(requestId)) {
                        this.pendingApprovals.delete(requestId);
                        reject(new Error(JSON.stringify({ plugin_error: `Manual approval for "${toolName}" timed out after ${timeoutDuration / 60000} minutes.` })));
                    }
                }, timeoutDuration);

                this.pendingApprovals.set(requestId, {
                    resolve, reject, timeoutId,
                    // AdminPanel 待审批任务列表用的请求详情
                    toolName,
                    args: pluginSpecificArgs,
                    maid: maidNameFromArgs,
                    timestamp: _getFormattedLocalTimestamp(),
                    createdAt: Date.now()
                });
            });

            // 发送审核请求到管理面板
            if (this.webSocketServer) {
                const approvalRequest = {
                    type: 'tool_approval_request',
                    data: {
                        requestId,
                        toolName,
                        maid: maidNameFromArgs,
                        args: pluginSpecificArgs,
                        timestamp: _getFormattedLocalTimestamp()
                    }
                };
                this.webSocketServer.broadcast(approvalRequest, 'VCPLog');
                console.log(`[PluginManager] 🔔 正在等待工具调用人工审核: ${toolName} (ID: ${requestId})`);
            } else {
                this.pendingApprovals.delete(requestId);
                throw new Error(JSON.stringify({ plugin_error: 'WebSocketServer not initialized, cannot request manual approval.' }));
            }

            try {
                await approvalPromise;
                if (this.debugMode) console.log(`[PluginManager] Tool call for "${toolName}" (ID: ${requestId}) approved.`);
            } catch (error) {
                if (this.debugMode) console.warn(`[PluginManager] Tool call for "${toolName}" (ID: ${requestId}) rejected: ${error.message}`);
                throw error;
            }
        }
        // --- 人工审核逻辑结束 ---

        try {
            let resultFromPlugin;
            if (plugin.isDistributed) {
                // --- 分布式插件调用逻辑 ---
                if (!this.webSocketServer) {
                    throw new Error('[PluginManager] WebSocketServer is not initialized. Cannot call distributed tool.');
                }
                if (this.debugMode) console.log(`[PluginManager] Processing distributed tool call for: ${toolName} on server ${plugin.serverId}`);
                resultFromPlugin = await this.webSocketServer.executeDistributedTool(plugin.serverId, toolName, pluginSpecificArgs);
                // 分布式工具的返回结果应该已经是JS对象了
            } else if (toolName === 'ChromeControl' && plugin.communication?.protocol === 'direct') {
                // --- ChromeControl 特殊处理逻辑 ---
                if (!this.webSocketServer) {
                    throw new Error('[PluginManager] WebSocketServer is not initialized. Cannot call ChromeControl tool.');
                }
                if (this.debugMode) console.log(`[PluginManager] Processing direct WebSocket tool call for: ${toolName}`);
                const command = pluginSpecificArgs.command;
                delete pluginSpecificArgs.command;
                resultFromPlugin = await this.webSocketServer.forwardCommandToChrome(command, pluginSpecificArgs);

            } else if (plugin.pluginType === 'hybridservice' && plugin.communication?.protocol === 'direct') {
                // --- 混合服务插件直接调用逻辑 ---
                if (this.debugMode) console.log(`[PluginManager] Processing direct tool call for hybrid service: ${toolName}`);
                const serviceModule = this.getServiceModule(toolName);
                if (!serviceModule) {
                    throw new Error(`[PluginManager] Hybrid service plugin "${toolName}" module not found. It may have failed to load or initialize during hot-reload.`);
                }
                if (typeof serviceModule.processToolCall !== 'function') {
                    throw new Error(`[PluginManager] Hybrid service plugin "${toolName}" does not have a processToolCall function.`);
                }
                resultFromPlugin = await serviceModule.processToolCall(pluginSpecificArgs);
            } else {
                // --- 本地插件调用逻辑 (现有逻辑) ---
                if (!((plugin.pluginType === 'synchronous' || plugin.pluginType === 'asynchronous') && plugin.communication?.protocol === 'stdio')) {
                    throw new Error(`[PluginManager] Local plugin "${toolName}" (type: ${plugin.pluginType}) is not a supported stdio plugin for direct tool call.`);
                }

                let executionParam = null;
                if (Object.keys(pluginSpecificArgs).length > 0) {
                    executionParam = JSON.stringify(pluginSpecificArgs);
                }

                const logParam = executionParam ? (executionParam.length > 100 ? executionParam.substring(0, 100) + '...' : executionParam) : null;
                if (this.debugMode) console.log(`[PluginManager] Calling local executePlugin for: ${toolName} with prepared param:`, logParam);

                const pluginOutput = await this.executePlugin(toolName, executionParam, requestIp); // Returns {status, result/error}

                if (pluginOutput.status === "success") {
                    if (typeof pluginOutput.result === 'string') {
                        try {
                            // If the result is a string, try to parse it as JSON.
                            resultFromPlugin = JSON.parse(pluginOutput.result);
                        } catch (parseError) {
                            // If parsing fails, wrap it. This is for plugins that return plain text.
                            if (this.debugMode) console.warn(`[PluginManager] Local plugin ${toolName} result string was not valid JSON. Original: "${pluginOutput.result.substring(0, 100)}"`);
                            resultFromPlugin = { original_plugin_output: pluginOutput.result };
                        }
                    } else {
                        // If the result is already an object (as with our new image plugins), use it directly.
                        resultFromPlugin = pluginOutput.result;
                    }
                } else {
                    throw new Error(JSON.stringify({ plugin_error: pluginOutput.error || `Plugin "${toolName}" reported an unspecified error.` }));
                }
            }

            // --- 通用结果处理 ---
            let finalResultObject = (typeof resultFromPlugin === 'object' && resultFromPlugin !== null) ? resultFromPlugin : { original_plugin_output: resultFromPlugin };

            if (maidNameFromArgs) {
                finalResultObject.MaidName = maidNameFromArgs;
            }
            finalResultObject.timestamp = _getFormattedLocalTimestamp();

            return finalResultObject;

        } catch (e) {
            console.error(`[PluginManager processToolCall] Error during execution for plugin ${toolName}:`, e.message);
            let errorObject;
            try {
                errorObject = JSON.parse(e.message);
            } catch (jsonParseError) {
                errorObject = { plugin_execution_error: e.message || 'Unknown plugin execution error' };
            }

            if (maidNameFromArgs && !errorObject.MaidName) {
                errorObject.MaidName = maidNameFromArgs;
            }
            if (!errorObject.timestamp) {
                errorObject.timestamp = _getFormattedLocalTimestamp();
            }
            throw new Error(JSON.stringify(errorObject));
        }
    }

    async executePlugin(pluginName, inputData, requestIp = null) {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            // This case should ideally be caught by processToolCall before calling executePlugin
            throw new Error(`[PluginManager executePlugin] Plugin "${pluginName}" not found.`);
        }
        // Validations for pluginType, communication, entryPoint remain important
        if (!((plugin.pluginType === 'synchronous' || plugin.pluginType === 'asynchronous') && plugin.communication?.protocol === 'stdio')) {
            throw new Error(`[PluginManager executePlugin] Plugin "${pluginName}" (type: ${plugin.pluginType}, protocol: ${plugin.communication?.protocol}) is not a supported stdio plugin. Expected synchronous or asynchronous stdio plugin.`);
        }
        if (!plugin.entryPoint || !plugin.entryPoint.command) {
            throw new Error(`[PluginManager executePlugin] Entry point command undefined for plugin "${pluginName}".`);
        }

        const pluginConfig = this._getPluginConfig(plugin);
        const envForProcess = { ...process.env };

        for (const key in pluginConfig) {
            if (pluginConfig.hasOwnProperty(key) && pluginConfig[key] !== undefined) {
                envForProcess[key] = String(pluginConfig[key]);
            }
        }

        const additionalEnv = {};
        if (this.projectBasePath) {
            additionalEnv.PROJECT_BASE_PATH = this.projectBasePath;
        } else {
            if (this.debugMode) console.warn("[PluginManager executePlugin] projectBasePath not set, PROJECT_BASE_PATH will not be available to plugins.");
        }

        // 如果插件需要管理员权限，则获取解密后的验证码并注入环境变量
        if (plugin.requiresAdmin) {
            const decryptedCode = await this._getDecryptedAuthCode();
            if (decryptedCode) {
                additionalEnv.DECRYPTED_AUTH_CODE = decryptedCode;
                if (this.debugMode) console.log(`[PluginManager] Injected DECRYPTED_AUTH_CODE for admin-required plugin: ${pluginName}`);
            } else {
                if (this.debugMode) console.warn(`[PluginManager] Could not get decrypted auth code for admin-required plugin: ${pluginName}. Execution will proceed without it.`);
            }
        }
        // 将 requestIp 添加到环境变量
        if (requestIp) {
            additionalEnv.VCP_REQUEST_IP = requestIp;
        }
        if (process.env.PORT) {
            additionalEnv.SERVER_PORT = process.env.PORT;
        }
        const imageServerKey = this.getResolvedPluginConfigValue('ImageServer', 'Image_Key');
        if (imageServerKey) {
            additionalEnv.IMAGESERVER_IMAGE_KEY = imageServerKey;
        }
        const fileServerKey = this.getResolvedPluginConfigValue('ImageServer', 'File_Key');
        if (fileServerKey) {
            additionalEnv.IMAGESERVER_FILE_KEY = fileServerKey;
        }

        // Pass CALLBACK_BASE_URL and PLUGIN_NAME to asynchronous plugins
        if (plugin.pluginType === 'asynchronous') {
            const callbackBaseUrl = pluginConfig.CALLBACK_BASE_URL || process.env.CALLBACK_BASE_URL; // Prefer plugin-specific, then global
            if (callbackBaseUrl) {
                additionalEnv.CALLBACK_BASE_URL = callbackBaseUrl;
            } else {
                if (this.debugMode) console.warn(`[PluginManager executePlugin] CALLBACK_BASE_URL not configured for asynchronous plugin ${pluginName}. Callback functionality might be impaired.`);
            }
            additionalEnv.PLUGIN_NAME_FOR_CALLBACK = pluginName; // Pass the plugin's name
        }

        // Force Python stdio encoding to UTF-8
        additionalEnv.PYTHONIOENCODING = 'utf-8';
        const finalEnv = { ...envForProcess, ...additionalEnv };

        if (this.debugMode && plugin.pluginType === 'asynchronous') {
            console.log(`[PluginManager executePlugin] Final ENV for async plugin ${pluginName}:`, JSON.stringify(finalEnv, null, 2).substring(0, 500) + "...");
        }

        return new Promise((resolve, reject) => {
            if (this.debugMode) console.log(`[PluginManager executePlugin Internal] For plugin "${pluginName}", manifest entryPoint command is: "${plugin.entryPoint.command}"`);
            if (this.debugMode) console.log(`[PluginManager executePlugin Internal] Attempting to spawn: "${plugin.entryPoint.command}" in cwd: ${plugin.basePath}`);

            // 用完整命令字符串 + shell:true，避免 DEP0190（args 数组与 shell:true 并用会触发废弃警告）
            const pluginProcess = spawn(plugin.entryPoint.command, { cwd: plugin.basePath, shell: true, env: finalEnv, windowsHide: true });


            let outputBuffer = ''; // Buffer to accumulate data chunks
            let errorOutput = '';
            let processExited = false;
            let initialResponseSent = false; // Flag for async plugins
            const isAsyncPlugin = plugin.pluginType === 'asynchronous';

            const timeoutDuration = plugin.communication.timeout || (isAsyncPlugin ? 1800000 : 60000); // Use manifest timeout, or 30min for async, 1min for sync

            const timeoutId = setTimeout(() => {
                if (!processExited && !initialResponseSent && isAsyncPlugin) {
                    // For async, if initial response not sent by timeout, it's an error for that phase
                    console.error(`[PluginManager executePlugin Internal] Async plugin "${pluginName}" initial response timed out after ${timeoutDuration}ms.`);
                    pluginProcess.kill('SIGKILL'); // Kill if no initial response
                    reject(new Error(`Plugin "${pluginName}" initial response timed out.`));
                } else if (!processExited && !isAsyncPlugin) {
                    // For sync plugins, or if async initial response was sent but process hangs
                    console.error(`[PluginManager executePlugin Internal] Plugin "${pluginName}" execution timed out after ${timeoutDuration}ms.`);
                    pluginProcess.kill('SIGKILL');
                    reject(new Error(`Plugin "${pluginName}" execution timed out.`));
                } else if (!processExited && isAsyncPlugin && initialResponseSent) {
                    // Async plugin's initial response was sent, but the process is still running (e.g. for background tasks)
                    // We let it run, but log if it exceeds the overall timeout.
                    // The process will be managed by its own non-daemon threads.
                    if (this.debugMode) console.log(`[PluginManager executePlugin Internal] Async plugin "${pluginName}" process is still running in background after timeout. This is expected for non-daemon threads.`);
                }
            }, timeoutDuration);

            pluginProcess.stdout.setEncoding('utf8');
            pluginProcess.stdout.on('data', (data) => {
                if (processExited || (isAsyncPlugin && initialResponseSent)) {
                    // If async and initial response sent, or process exited, ignore further stdout for this Promise.
                    // The plugin's background task might still log to its own stdout, but we don't collect it here.
                    if (this.debugMode && isAsyncPlugin && initialResponseSent) console.log(`[PluginManager executePlugin Internal] Async plugin ${pluginName} (initial response sent) produced more stdout: ${data.substring(0, 100)}...`);
                    return;
                }
                outputBuffer += data;
                try {
                    // Try to parse a complete JSON object from the buffer.
                    // This is a simple check; for robust streaming JSON, a more complex parser is needed.
                    // We assume the first complete JSON is the one we want for async initial response.
                    const potentialJsonMatch = outputBuffer.match(/(\{[\s\S]*?\})(?:\s|$)/);
                    if (potentialJsonMatch && potentialJsonMatch[1]) {
                        const jsonString = potentialJsonMatch[1];
                        const parsedOutput = JSON.parse(jsonString);

                        if (parsedOutput && (parsedOutput.status === "success" || parsedOutput.status === "error")) {
                            if (isAsyncPlugin) {
                                if (!initialResponseSent) {
                                    if (this.debugMode) console.log(`[PluginManager executePlugin Internal] Async plugin "${pluginName}" sent initial JSON response. Resolving promise.`);
                                    initialResponseSent = true;
                                    // For async, we resolve with the first valid JSON and let the process continue if it has non-daemon threads.
                                    // We don't clear the main timeout here for async, as the process might still need to be killed if it misbehaves badly later.
                                    // However, the primary purpose of this promise is fulfilled.
                                    resolve(parsedOutput);
                                    // We don't return or clear outputBuffer here, as more data might be part of a *synchronous* plugin's single large JSON output.
                                }
                            } else { // Synchronous plugin
                                // For sync plugins, we wait for 'exit' to ensure all output is collected.
                                // This block within 'data' event is more for validating if the output *looks* like our expected JSON.
                                // The actual resolve for sync plugins happens in 'exit'.
                                if (this.debugMode) console.log(`[PluginManager executePlugin Internal] Sync plugin "${pluginName}" current output buffer contains a potential JSON.`);
                            }
                        }
                    }
                } catch (e) {
                    // Incomplete JSON or invalid JSON, wait for more data or 'exit' event.
                    if (this.debugMode && outputBuffer.length > 2) console.log(`[PluginManager executePlugin Internal] Plugin "${pluginName}" stdout buffer not yet a complete JSON or invalid. Buffer: ${outputBuffer.substring(0, 100)}...`);
                }
            });

            pluginProcess.stderr.setEncoding('utf8');
            pluginProcess.stderr.on('data', (data) => {
                errorOutput += data;
                if (this.debugMode) console.warn(`[PluginManager executePlugin Internal stderr] Plugin "${pluginName}": ${data.trim()}`);
            });

            pluginProcess.on('error', (err) => {
                processExited = true; clearTimeout(timeoutId);
                if (!initialResponseSent) { // Only reject if initial response (for async) or any response (for sync) hasn't been sent
                    reject(new Error(`Failed to start plugin "${pluginName}": ${err.message}`));
                } else if (this.debugMode) {
                    console.error(`[PluginManager executePlugin Internal] Error after initial response for async plugin "${pluginName}": ${err.message}. Process might have been expected to continue.`);
                }
            });

            pluginProcess.on('exit', (code, signal) => {
                processExited = true;
                clearTimeout(timeoutId); // Clear the main timeout once the process exits.

                if (isAsyncPlugin && initialResponseSent) {
                    // For async plugins where initial response was already sent, log exit but don't re-resolve/reject.
                    if (this.debugMode) console.log(`[PluginManager executePlugin Internal] Async plugin "${pluginName}" process exited with code ${code}, signal ${signal} after initial response was sent.`);
                    return;
                }

                // If we are here, it's either a sync plugin, or an async plugin whose initial response was NOT sent before exit.

                if (signal === 'SIGKILL') { // Typically means timeout killed it
                    if (!initialResponseSent) reject(new Error(`Plugin "${pluginName}" execution timed out or was killed.`));
                    return;
                }

                try {
                    const parsedOutput = JSON.parse(outputBuffer.trim()); // Use accumulated outputBuffer
                    if (parsedOutput && (parsedOutput.status === "success" || parsedOutput.status === "error")) {
                        if (code !== 0 && parsedOutput.status === "success" && this.debugMode) {
                            console.warn(`[PluginManager executePlugin Internal] Plugin "${pluginName}" exited with code ${code} but reported success in JSON. Trusting JSON.`);
                        }
                        if (code === 0 && parsedOutput.status === "error" && this.debugMode) {
                            console.warn(`[PluginManager executePlugin Internal] Plugin "${pluginName}" exited with code 0 but reported error in JSON. Trusting JSON.`);
                        }
                        if (errorOutput.trim()) parsedOutput.pluginStderr = errorOutput.trim();

                        if (!initialResponseSent) resolve(parsedOutput); // Ensure resolve only once
                        else if (this.debugMode) console.log(`[PluginManager executePlugin Internal] Plugin ${pluginName} exited, initial async response already sent.`);
                        return;
                    }
                    if (this.debugMode) console.warn(`[PluginManager executePlugin Internal] Plugin "${pluginName}" final stdout was not in the expected JSON format: ${outputBuffer.trim().substring(0, 100)}`);
                } catch (e) {
                    if (this.debugMode) console.warn(`[PluginManager executePlugin Internal] Failed to parse final stdout JSON from plugin "${pluginName}". Error: ${e.message}. Stdout: ${outputBuffer.trim().substring(0, 100)}`);
                }

                if (!initialResponseSent) { // Only reject if no response has been sent yet
                    if (code !== 0) {
                        let detailedError = `Plugin "${pluginName}" exited with code ${code}.`;
                        if (outputBuffer.trim()) detailedError += ` Stdout: ${outputBuffer.trim().substring(0, 200)}`;
                        if (errorOutput.trim()) detailedError += ` Stderr: ${errorOutput.trim().substring(0, 200)}`;
                        reject(new Error(detailedError));
                    } else {
                        // Exit code 0, but no valid initial JSON response was sent/parsed.
                        reject(new Error(`Plugin "${pluginName}" exited successfully but did not provide a valid initial JSON response. Stdout: ${outputBuffer.trim().substring(0, 200)}`));
                    }
                }
            });

            try {
                if (inputData !== undefined && inputData !== null) {
                    pluginProcess.stdin.write(inputData.toString());
                }
                pluginProcess.stdin.end();
            } catch (e) {
                console.error(`[PluginManager executePlugin Internal] Stdin write error for "${pluginName}": ${e.message}`);
                if (!initialResponseSent) { // Only reject if no response has been sent yet
                    reject(new Error(`Stdin write error for "${pluginName}": ${e.message}`));
                }
            }
        });
    }

    handleApprovalResponse(requestId, approved) {
        const approval = this.pendingApprovals.get(requestId);
        if (approval) {
            this.pendingApprovals.delete(requestId);
            clearTimeout(approval.timeoutId);
            if (approved) {
                approval.resolve();
            } else {
                approval.reject(new Error(JSON.stringify({ plugin_error: 'Manual approval was REJECTED by user.' })));
            }
            return true;
        }
        return false;
    }

    initializeServices(app, adminApiRouter, projectBasePath) {
        if (!app) {
            console.error('[PluginManager] Cannot initialize services without Express app instance.');
            return;
        }
        if (!adminApiRouter) {
            console.error('[PluginManager] Cannot initialize services without adminApiRouter instance.');
            return;
        }
        if (!projectBasePath) {
            console.error('[PluginManager] Cannot initialize services without projectBasePath.'); // Keep error
            return;
        }
        console.log('[PluginManager] Initializing service plugins...'); // Keep
        for (const [name, serviceData] of this.serviceModules) {
            try {
                const pluginConfig = this._getPluginConfig(serviceData.manifest);
                const manifest = serviceData.manifest;
                const module = serviceData.module;

                // 新的、带命名空间的API路由注册机制
                if (manifest.hasApiRoutes && typeof module.registerApiRoutes === 'function') {
                    if (this.debugMode) console.log(`[PluginManager] Registering namespaced API routes for service plugin: ${name}`);
                    const pluginRouter = express.Router();
                    // 将 router 和其他上下文传递给插件
                    module.registerApiRoutes(pluginRouter, pluginConfig, projectBasePath, this.webSocketServer);
                    // 统一挂载到带命名空间的前缀下
                    app.use(`/api/plugins/${name}`, pluginRouter);
                    if (this.debugMode) console.log(`[PluginManager] Mounted API routes for ${name} at /api/plugins/${name}`);
                }

                // VCPLog 特殊处理：注入 WebSocketServer 的广播函数
                if (name === 'VCPLog' && this.webSocketServer && typeof module.setBroadcastFunctions === 'function') {
                    if (typeof this.webSocketServer.broadcastVCPInfo === 'function') {
                        module.setBroadcastFunctions(this.webSocketServer.broadcastVCPInfo);
                        if (this.debugMode) console.log(`[PluginManager] Injected broadcastVCPInfo into VCPLog.`);
                    } else {
                        console.warn(`[PluginManager] WebSocketServer is missing broadcastVCPInfo function. VCPInfo will not be broadcastable.`);
                    }
                }

                // 兼容旧的、直接在 app 上注册的 service 插件
                if (typeof module.registerRoutes === 'function') {
                    if (this.debugMode) console.log(`[PluginManager] Registering legacy routes for service plugin: ${name}`);
                    if (module.registerRoutes.length >= 4) {
                        if (this.debugMode) console.log(`[PluginManager] Calling new-style legacy registerRoutes for ${name} (4+ args).`);
                        module.registerRoutes(app, adminApiRouter, pluginConfig, projectBasePath);
                    } else {
                        if (this.debugMode) console.log(`[PluginManager] Calling legacy-style registerRoutes for ${name} (3 args).`);
                        module.registerRoutes(app, pluginConfig, projectBasePath);
                    }
                }

            } catch (e) {
                console.error(`[PluginManager] Error initializing service plugin ${name}:`, e); // Keep error
            }
        }
        console.log('[PluginManager] Service plugins initialized.'); // Keep
    }
    // --- 新增分布式插件管理方法 ---
    registerDistributedTools(serverId, tools) {
        if (this.debugMode) console.log(`[PluginManager] Registering ${tools.length} tools from distributed server: ${serverId}`);
        for (const toolManifest of tools) {
            if (!toolManifest.name || !toolManifest.pluginType || !toolManifest.entryPoint) {
                if (this.debugMode) console.warn(`[PluginManager] Invalid manifest from ${serverId} for tool '${toolManifest.name}'. Skipping.`);
                continue;
            }
            if (this.plugins.has(toolManifest.name)) {
                if (this.debugMode) console.warn(`[PluginManager] Distributed tool '${toolManifest.name}' from ${serverId} conflicts with an existing tool. Skipping.`);
                continue;
            }

            // 标记为分布式插件并存储其来源服务器ID
            toolManifest.isDistributed = true;
            toolManifest.serverId = serverId;

            // 在显示名称前加上[云端]前缀
            toolManifest.displayName = `[云端] ${toolManifest.displayName || toolManifest.name}`;

            this.plugins.set(toolManifest.name, toolManifest);
            console.log(`[PluginManager] Registered distributed tool: ${toolManifest.displayName} (${toolManifest.name}) from ${serverId}`);
        }
        // 注册后重建描述，以包含新插件
        this.buildVCPDescription();
    }

    unregisterAllDistributedTools(serverId) {
        if (this.debugMode) console.log(`[PluginManager] Unregistering all tools from distributed server: ${serverId}`);
        let unregisteredCount = 0;
        for (const [name, manifest] of this.plugins.entries()) {
            if (manifest.isDistributed && manifest.serverId === serverId) {
                this.plugins.delete(name);
                unregisteredCount++;
                if (this.debugMode) console.log(`  - Unregistered: ${name}`);
            }
        }
        if (unregisteredCount > 0) {
            console.log(`[PluginManager] Unregistered ${unregisteredCount} tools from server ${serverId}.`);
            // 注销后重建描述
            this.buildVCPDescription();
        }

        // 新增：清理分布式静态占位符
        this.clearDistributedStaticPlaceholders(serverId);
    }

    // 新增：更新分布式静态占位符
    updateDistributedStaticPlaceholders(serverId, serverName, placeholders) {
        if (this.debugMode) {
            console.log(`[PluginManager] Updating static placeholders from distributed server ${serverName} (${serverId})`);
        }

        for (const [placeholder, value] of Object.entries(placeholders)) {
            // 新增逻辑：尝试解析可能的 JSON 折叠对象
            let parsedValue = value;
            if (typeof value === 'string' && value.trim().startsWith('{')) {
                try {
                    const jsonObj = JSON.parse(value.trim());
                    if (jsonObj && jsonObj.vcp_dynamic_fold) {
                        parsedValue = jsonObj; // 保持对象形式以供折叠处理
                    }
                } catch (e) {
                    // 解析失败说明只是普通的字符串，可以直接忽略错误
                }
            }

            // 为分布式占位符添加服务器来源标识
            this.staticPlaceholderValues.set(placeholder, { value: parsedValue, serverId: serverId });

            if (this.debugMode) {
                const logVal = typeof parsedValue === 'object' ? JSON.stringify(parsedValue) : parsedValue;
                console.log(`[PluginManager] Updated distributed placeholder ${placeholder} from ${serverName}: ${logVal.substring(0, 100)}${logVal.length > 100 ? '...' : ''}`);
            }
        }

        // 强制日志记录分布式静态占位符更新
        console.log(`[PluginManager] Updated ${Object.keys(placeholders).length} static placeholders from distributed server ${serverName}.`);
    }

    // 新增：清理分布式静态占位符
    clearDistributedStaticPlaceholders(serverId) {
        const placeholdersToRemove = [];

        for (const [placeholder, entry] of this.staticPlaceholderValues.entries()) {
            if (entry && entry.serverId === serverId) {
                placeholdersToRemove.push(placeholder);
            }
        }

        for (const placeholder of placeholdersToRemove) {
            this.staticPlaceholderValues.delete(placeholder);
            if (this.debugMode) {
                console.log(`[PluginManager] Removed distributed placeholder ${placeholder} from disconnected server ${serverId}`);
            }
        }

        if (placeholdersToRemove.length > 0) {
            console.log(`[PluginManager] Cleared ${placeholdersToRemove.length} static placeholders from disconnected server ${serverId}.`);
        }
    }

    // --- 新增方法 ---
    async hotReloadPluginsAndOrder() {
        console.log('[PluginManager] Hot reloading plugins and preprocessor order...');
        // 重新加载所有插件，这将自动应用新的顺序
        await this.loadPlugins();
        console.log('[PluginManager] Hot reload complete.');
        return this.getPreprocessorOrder();
    }

    getPreprocessorOrder() {
        // 返回所有已发现、已排序的预处理器信息
        return this.preprocessorOrder.map(name => {
            const manifest = this.plugins.get(name);
            return {
                name: name,
                displayName: manifest ? manifest.displayName : name,
                description: manifest ? manifest.description : 'N/A'
            };
        });
    }
    startPluginWatcher() {
        if (this.debugMode) console.log('[PluginManager] Starting plugin file watcher...');

        const watcher = chokidar.watch(PLUGIN_DIR, {
            ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/target/**',
                '**/image/**',
                '**/.*'
            ],
            persistent: true,
            ignoreInitial: true, // Don't fire on initial scan
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        const filterManifest = (filePath) => {
            const fileName = path.basename(filePath);
            return fileName === 'plugin-manifest.json' || fileName === 'plugin-manifest.json.block';
        };

        watcher
            .on('add', filePath => {
                if (filterManifest(filePath)) this.handlePluginManifestChange('add', filePath);
            })
            .on('change', filePath => {
                if (filterManifest(filePath)) this.handlePluginManifestChange('change', filePath);
            })
            .on('unlink', filePath => {
                if (filterManifest(filePath)) this.handlePluginManifestChange('unlink', filePath);
            });

        console.log(`[PluginManager] Chokidar is now watching ${PLUGIN_DIR} for manifest changes.`);
    }

    handlePluginManifestChange(eventType, filePath) {
        if (this.isReloading) {
            if (this.debugMode) console.log(`[PluginManager] Already reloading, skipping event '${eventType}' for: ${filePath}`);
            return;
        }

        clearTimeout(this.reloadTimeout);

        if (this.debugMode) console.log(`[PluginManager] Debouncing plugin reload trigger due to '${eventType}' event on: ${path.basename(filePath)}`);

        this.reloadTimeout = setTimeout(async () => {
            this.isReloading = true;

            try {
                // --- 精细化检查：判断是否需要触发重载 ---
                if (eventType !== 'unlink') {
                    try {
                        const content = await fs.readFile(filePath, 'utf-8');
                        const manifest = JSON.parse(content);

                        // 如果是常驻内存型插件（direct 协议），禁止自动热重载以维持稳定性
                        if (manifest.communication?.protocol === 'direct') {
                            if (this.debugMode) console.log(`[PluginManager] Resident plugin manifest change detected (${manifest.name}), skipping auto-reload to maintain stability.`);
                            this.isReloading = false;
                            return;
                        }
                    } catch (e) {
                        // 如果读取或解析失败，保守起见继续执行重载
                    }
                }

                console.log(`[PluginManager] Manifest file change detected ('${eventType}'). Hot-reloading plugins...`);
                await this.loadPlugins();
                console.log('[PluginManager] Hot-reload complete.');

                if (this.webSocketServer && typeof this.webSocketServer.broadcastToAdminPanel === 'function') {
                    this.webSocketServer.broadcastToAdminPanel({
                        type: 'plugins-reloaded',
                        message: 'Plugin list has been updated due to file changes.'
                    });
                    if (this.debugMode) console.log('[PluginManager] Notified admin panel about plugin reload.');
                }
            } catch (error) {
                console.error('[PluginManager] Error during hot-reload:', error);
            } finally {
                this.isReloading = false;
            }
        }, 500); // 500ms debounce window
    }
}

const pluginManager = new PluginManager();

// 新增：获取所有静态占位符值
pluginManager.getAllPlaceholderValues = function () {
    const valuesMap = new Map();
    for (const [key, entry] of this.staticPlaceholderValues.entries()) {
        // Sanitize the key to remove legacy brackets for consistency
        const sanitizedKey = key.replace(/^{{|}}$/g, '');

        let value;
        // Handle modern object format
        if (typeof entry === 'object' && entry !== null && entry.hasOwnProperty('value')) {
            value = entry.value;
            // Handle legacy raw string format
        } else if (typeof entry === 'string') {
            value = entry;
        } else {
            // Fallback for any other unexpected format
            value = `[Invalid format for placeholder ${sanitizedKey}]`;
        }

        valuesMap.set(sanitizedKey, value || `[Placeholder ${sanitizedKey} has no value]`);
    }
    return valuesMap;
};

module.exports = pluginManager;