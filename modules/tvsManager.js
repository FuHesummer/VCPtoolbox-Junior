// modules/tvsManager.js
const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');

let TVS_DIR = path.join(process.env.VCP_ROOT || path.join(__dirname, '..'), 'TVStxt');

class TvsManager {
    constructor() {
        this.contentCache = new Map();
        this.debugMode = false;
        // 已报告过的缺失/错误文件（避免同一文件反复污染日志）
        this.reportedMisses = new Set();
    }

    setTvsDir(dirPath) {
        TVS_DIR = dirPath;
    }

    initialize(debugMode = false) {
        this.debugMode = debugMode;
        console.log('[TvsManager] Initializing...');
        this.watchFiles();
    }

    watchFiles() {
        try {
            const watcher = chokidar.watch(TVS_DIR, {
                ignored: [
                    '**/node_modules/**',
                    '**/.git/**',
                    '**/dist/**',
                    '**/target/**',
                    '**/image/**',
                    '**/.*'
                ],
                persistent: true,
                ignoreInitial: true, // Don't trigger 'add' events on startup
            });

            watcher
                .on('add', (filePath) => {
                    // 新文件出现（如插件注册）时清理 miss 标记，让 {{Var*}} 重新尝试读取
                    const filename = path.basename(filePath);
                    if (this.reportedMisses.has(filename)) {
                        this.reportedMisses.delete(filename);
                    }
                })
                .on('change', (filePath) => {
                    const filename = path.basename(filePath);
                    if (this.contentCache.has(filename)) {
                        this.contentCache.delete(filename);
                        console.log(`[TvsManager] Cache for '${filename}' cleared due to file change.`);
                    }
                })
                .on('unlink', (filePath) => {
                    const filename = path.basename(filePath);
                    if (this.contentCache.has(filename)) {
                        this.contentCache.delete(filename);
                        console.log(`[TvsManager] Cache for '${filename}' cleared due to file deletion.`);
                    }
                })
                .on('error', (error) => console.error(`[TvsManager] Watcher error: ${error}`));

            if (this.debugMode) {
                console.log(`[TvsManager] Watching for changes in: ${TVS_DIR}`);
            }
        } catch (error) {
            console.error(`[TvsManager] Failed to set up file watcher:`, error);
        }
    }

    async getContent(filename) {
        if (this.contentCache.has(filename)) {
            if (this.debugMode) {
                console.log(`[TvsManager] Cache hit for '${filename}'.`);
            }
            return this.contentCache.get(filename);
        }

        if (this.debugMode) {
            console.log(`[TvsManager] Cache miss for '${filename}'. Reading from disk.`);
        }

        try {
            const filePath = path.join(TVS_DIR, filename);
            const content = await fs.readFile(filePath, 'utf8');
            this.contentCache.set(filename, content);
            return content;
        } catch (error) {
            // Don't cache errors, so it can be retried if the file appears later.
            // 同一文件只 WARN 一次，避免日志污染（chokidar 会在文件恢复时清除标记）
            if (!this.reportedMisses.has(filename)) {
                this.reportedMisses.add(filename);
                if (error.code === 'ENOENT') {
                    console.warn(`[TvsManager] 变量文件 '${filename}' 不存在（可能对应插件未安装，后续不再重复提示）`);
                } else {
                    console.warn(`[TvsManager] 读取 '${filename}' 失败: ${error.message}（后续不再重复提示）`);
                }
            }
            if (error.code === 'ENOENT') {
                return `[变量文件 (${filename}) 未找到]`;
            }
            return `[处理变量文件 (${filename}) 时出错]`;
        }
    }
}

const tvsManager = new TvsManager();
module.exports = tvsManager;