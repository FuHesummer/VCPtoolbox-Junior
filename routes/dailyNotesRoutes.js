const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { Worker } = require('worker_threads');

/**
 * 日记本管理模块 (安全加固版)
 * @param {string} dailyNoteRootPath 日记本根目录
 * @param {boolean} DEBUG_MODE 是否开启调试模式
 * @returns {express.Router}
 */
module.exports = function (dailyNoteRootPath, DEBUG_MODE) {
    const router = express.Router();

    // ══════════════════════════════════════════════════
    //  Notebook path resolver helper
    //  Resolves folder names to absolute paths:
    //    "Nova"          → knowledge/Nova/
    //    "Aemeath/diary" → Agent/Aemeath/diary/
    // ══════════════════════════════════════════════════
    const VCP_ROOT = process.env.VCP_ROOT || path.join(__dirname, '..');
    function resolveFolderPath(folderName) {
        // Check if it's an Agent notebook path (contains "/")
        if (folderName.includes('/')) {
            try {
                const { getNotebookEntries } = require('../modules/notebookResolver');
                const entry = getNotebookEntries().find(e => e.displayName === folderName);
                if (entry) return entry.path;
            } catch {}
            // Fallback: treat as Agent/<name>/<subdir>
            const fullPath = path.join(VCP_ROOT, 'Agent', folderName);
            return path.normalize(fullPath);
        }
        // Regular folder under knowledge/
        return path.join(dailyNoteRootPath, folderName);
    }

    function isFolderPathSafe(resolvedPath) {
        const norm = path.normalize(resolvedPath);
        // Allow paths under dailyNoteRootPath, Agent/, or thinking/
        return norm.startsWith(path.normalize(dailyNoteRootPath)) ||
               norm.startsWith(path.normalize(path.join(VCP_ROOT, 'Agent'))) ||
               norm.startsWith(path.normalize(path.join(VCP_ROOT, 'thinking')));
    }

    // ══════════════════════════════════════════════════
    //  搜索配置
    // ══════════════════════════════════════════════════
    const SEARCH_CONFIG = {
        MAX_RESULTS: 200,
        MAX_SEARCH_TERM_LENGTH: 100,
        MAX_KEYWORDS: 5,
        TIMEOUT_MS: 30000,
        QUEUE_WAIT_TIMEOUT_MS: 10000,   // 排队等待超时
        PREVIEW_LENGTH: 100,
        MAX_FILE_SIZE: 1024 * 1024,
        MAX_DEPTH: 3,
        YIELD_EVERY_N_FILES: 50,        // 每处理 N 个文件让出事件循环
        MAX_CONCURRENT: 2,
    };

    // ══════════════════════════════════════════════════
    //  工具函数
    // ══════════════════════════════════════════════════

    /** 让出事件循环 —— 防止 CPU 独占 */
    function yieldToEventLoop() {
        return new Promise(resolve => setImmediate(resolve));
    }

    /** 安全路径检查 */
    function isPathSafe(targetPath, rootPath) {
        const resolved = path.resolve(targetPath);
        const root = path.resolve(rootPath);
        return resolved === root || resolved.startsWith(root + path.sep);
    }

    /** 符号链接检查 */
    async function isSymlink(filePath) {
        try {
            return (await fs.lstat(filePath)).isSymbolicLink();
        } catch {
            return false;
        }
    }

    // ══════════════════════════════════════════════════
    //  信号量 —— 替代手写队列，杜绝死锁
    // ══════════════════════════════════════════════════
    class Semaphore {
        constructor(max) {
            this.max = max;
            this.current = 0;
            this.queue = [];      // { resolve, reject, timer, signal }
        }

        /**
         * 获取一个槽位，支持超时和 AbortSignal 立即释放
         * @param {number} timeoutMs
         * @param {AbortSignal} signal
         * @returns {Promise<void>}
         */
        acquire(timeoutMs = 10000, signal = null) {
            if (signal?.aborted) return Promise.reject(new DOMException('Search aborted', 'AbortError'));

            // 有空位，立即获取
            if (this.current < this.max) {
                this.current++;
                return Promise.resolve();
            }

            // 无空位，排队等待
            return new Promise((resolve, reject) => {
                const entry = { resolve, reject, timer: null, signal };

                const cleanup = () => {
                    if (entry.timer) clearTimeout(entry.timer);
                    if (signal) signal.removeEventListener('abort', onAbort);
                    const idx = this.queue.indexOf(entry);
                    if (idx !== -1) this.queue.splice(idx, 1);
                };

                const onAbort = () => {
                    cleanup();
                    reject(new DOMException('Search queue wait aborted', 'AbortError'));
                };

                if (signal) {
                    signal.addEventListener('abort', onAbort, { once: true });
                }

                entry.timer = setTimeout(() => {
                    cleanup();
                    reject(new Error('Search queue wait timeout'));
                }, timeoutMs);

                entry.resolve = () => {
                    if (signal) signal.removeEventListener('abort', onAbort);
                    clearTimeout(entry.timer);
                    resolve();
                };
                
                this.queue.push(entry);
            });
        }

        /** 释放槽位，唤醒下一个等待者 */
        release() {
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next.resolve();
            } else {
                this.current--;
            }
        }

        get stats() {
            return {
                active: this.current,
                waiting: this.queue.length,
                max: this.max,
            };
        }
    }

    const searchSemaphore = new Semaphore(SEARCH_CONFIG.MAX_CONCURRENT);

    // ══════════════════════════════════════════════════
    //  目录缓存层
    // ══════════════════════════════════════════════════
    class DirectoryCache {
        constructor(ttl = 10000) {
            this.cache = new Map(); // path -> { entries, timestamp }
            this.ttl = ttl;
        }
        async getReaddir(dirPath) {
            const now = Date.now();
            if (this.cache.has(dirPath)) {
                const entry = this.cache.get(dirPath);
                if (now - entry.timestamp < this.ttl) return entry.entries;
            }
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            this.cache.set(dirPath, { entries, timestamp: now });
            return entries;
        }
        invalidate(dirPath) {
            if (dirPath) {
                this.cache.delete(dirPath);
                // 同时失效父目录可能也是必要的，但这里简单处理
                const parent = path.dirname(dirPath);
                if (parent !== dirPath) this.cache.delete(parent);
            } else {
                this.cache.clear();
            }
        }
    }
    const dirCache = new DirectoryCache(15000); // 15秒缓存

    // ══════════════════════════════════════════════════
    //  请求去重缓存
    // ══════════════════════════════════════════════════
    const inflightSearches = new Map(); // hash → { promise, refCount }

    function hashSearchParams(terms, folder) {
        return `${terms.join('+')}:::${folder || '*'}`;
    }

    // ══════════════════════════════════════════════════
    //  核心搜索（支持 AbortSignal + 周期性让步）
    // ══════════════════════════════════════════════════

    /**
     * @param {string[]} searchTerms
     * @param {string|null} folder
     * @param {AbortSignal} signal
     */
    async function executeSearch(searchTerms, folder, signal) {
        const checkAbort = () => {
            if (signal.aborted) throw new DOMException('Search aborted', 'AbortError');
        };

        const matchedNotes = [];
        const visitedPaths = new Set();
        let filesToScan = [];

        // 1. 收集所有待扫描文件（利用目录缓存）
        let foldersToSearch = [];
        if (folder) {
            const specificPath = resolveFolderPath(folder);
            if (!isFolderPathSafe(specificPath)) throw new Error('Path traversal detected');
            foldersToSearch.push({ name: folder, path: specificPath, depth: 0 });
        } else {
            // Scan shared knowledge/ folders
            try {
                const entries = await dirCache.getReaddir(dailyNoteRootPath);
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        foldersToSearch.push({ name: entry.name, path: path.join(dailyNoteRootPath, entry.name), depth: 0 });
                    }
                }
            } catch {}
            // Also include Agent notebook directories
            try {
                const { getNotebookEntries } = require('../modules/notebookResolver');
                for (const nb of getNotebookEntries()) {
                    foldersToSearch.push({ name: nb.displayName, path: nb.path, depth: 0 });
                }
            } catch {}
        }

        for (const dir of foldersToSearch) {
            checkAbort();
            if (dir.depth > SEARCH_CONFIG.MAX_DEPTH) continue;
            
            let realPath;
            try { realPath = await fs.realpath(dir.path); } catch { continue; }
            if (visitedPaths.has(realPath)) continue;
            visitedPaths.add(realPath);

            let entries;
            try { entries = await dirCache.getReaddir(dir.path); } catch { continue; }

            for (const entry of entries) {
                const fullPath = path.join(dir.path, entry.name);
                if (entry.isDirectory() && dir.depth < SEARCH_CONFIG.MAX_DEPTH) {
                    foldersToSearch.push({ name: dir.name, path: fullPath, depth: dir.depth + 1 });
                } else if (entry.isFile()) {
                    const lower = entry.name.toLowerCase();
                    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
                        try {
                            const stats = await fs.stat(fullPath);
                            if (stats.size <= SEARCH_CONFIG.MAX_FILE_SIZE) {
                                filesToScan.push({
                                    path: fullPath,
                                    name: entry.name,
                                    folderName: dir.name,
                                    lastModified: stats.mtime.toISOString()
                                });
                            }
                        } catch {}
                    }
                }
            }
        }

        if (filesToScan.length === 0) return [];

        // 2. 使用 Worker Thread 进行并行搜索
        // 将文件列表分块（如果文件很多），这里简单起见先用一个 Worker 处理所有文件
        // 但为了防止单个 Worker 运行太久，我们可以限制文件数量或分块
        const results = await new Promise((resolve, reject) => {
            const worker = new Worker(path.join(__dirname, 'searchWorker.js'), {
                workerData: {
                    files: filesToScan,
                    searchTerms,
                    previewLength: SEARCH_CONFIG.PREVIEW_LENGTH
                }
            });

            const onAbort = () => {
                worker.terminate();
                reject(new DOMException('Search aborted', 'AbortError'));
            };

            signal.addEventListener('abort', onAbort, { once: true });

            worker.on('message', (data) => {
                signal.removeEventListener('abort', onAbort);
                resolve(data);
            });

            worker.on('error', (err) => {
                signal.removeEventListener('abort', onAbort);
                reject(err);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    signal.removeEventListener('abort', onAbort);
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });

        matchedNotes.push(...results);
        matchedNotes.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

        if (DEBUG_MODE) {
            console.log(`[Search] Completed: ${filesToScan.length} files scanned, ${matchedNotes.length} matches`);
        }

        return matchedNotes.slice(0, SEARCH_CONFIG.MAX_RESULTS);
    }

    // ══════════════════════════════════════════════════
    //  带去重、排队、超时、取消的搜索入口
    // ══════════════════════════════════════════════════

    /**
     * @param {string[]} searchTerms
     * @param {string|null} folder
     * @param {AbortSignal} callerSignal - 来自调用方的取消信号（如客户端断开）
     * @returns {Promise<Array>}
     */
    async function queuedSearch(searchTerms, folder, callerSignal) {
        const hash = hashSearchParams(searchTerms, folder);

        // ── 1. 请求去重：如果同样的搜索正在执行，直接复用 ──
        if (inflightSearches.has(hash)) {
            const entry = inflightSearches.get(hash);
            entry.refCount++;
            if (DEBUG_MODE) console.log(`[Search] Reusing inflight: ${hash} (refs: ${entry.refCount})`);

            try {
                return await entry.promise;
            } finally {
                entry.refCount--;
                if (entry.refCount <= 0) {
                    inflightSearches.delete(hash);
                }
            }
        }

        // ── 2. 占位，但用独立的 abort controller ──
        const ac = new AbortController();

        // 如果调用方信号取消，也取消搜索
        const onCallerAbort = () => ac.abort();
        callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

        // ── 3. 构建搜索 promise（不用 async executor！）──
        const searchPromise = (async () => {
            // 3a. 排队获取槽位（带超时）
            try {
                await searchSemaphore.acquire(SEARCH_CONFIG.QUEUE_WAIT_TIMEOUT_MS, ac.signal);
            } catch (err) {
                throw new Error('Too many concurrent searches, please retry later');
            }

            if (DEBUG_MODE) console.log(`[Search] Acquired slot: ${hash} | ${JSON.stringify(searchSemaphore.stats)}`);

            // 3b. 超时计时器
            const timer = setTimeout(() => ac.abort(), SEARCH_CONFIG.TIMEOUT_MS);

            try {
                return await executeSearch(searchTerms, folder, ac.signal);
            } finally {
                clearTimeout(timer);
                searchSemaphore.release();
                callerSignal?.removeEventListener('abort', onCallerAbort);

                if (DEBUG_MODE) console.log(`[Search] Released slot: ${hash} | ${JSON.stringify(searchSemaphore.stats)}`);
            }
        })();

        // ── 4. 注册去重缓存 ──
        const entry = { promise: searchPromise, refCount: 1 };
        inflightSearches.set(hash, entry);

        try {
            return await searchPromise;
        } finally {
            entry.refCount--;
            if (entry.refCount <= 0) {
                inflightSearches.delete(hash);
            }
        }
    }

    // ══════════════════════════════════════════════════
    //  搜索路由（带客户端断开检测）
    // ══════════════════════════════════════════════════
    router.get('/search', async (req, res) => {
        let { term, folder, limit } = req.query;

        // ── 输入验证 ──
        if (!term || typeof term !== 'string' || term.trim() === '') {
            return res.status(400).json({ error: 'Search term is required.' });
        }

        term = term.trim().substring(0, SEARCH_CONFIG.MAX_SEARCH_TERM_LENGTH);

        let searchTerms = term
            .toLowerCase()
            .split(/\s+/)
            .filter(t => t !== '')
            .slice(0, SEARCH_CONFIG.MAX_KEYWORDS);

        if (searchTerms.length === 0) {
            return res.status(400).json({ error: 'No valid search terms.' });
        }

        if (folder && typeof folder === 'string') {
            folder = folder.trim();
            if (folder.includes('..') || folder.includes('/') || folder.includes('\\')) {
                return res.status(403).json({ error: 'Invalid folder name' });
            }
            if (folder === '') folder = null;
        } else {
            folder = null;
        }

        const maxResults = Math.min(
            parseInt(limit, 10) || SEARCH_CONFIG.MAX_RESULTS,
            SEARCH_CONFIG.MAX_RESULTS
        );

        // ★ 关键：监听客户端断开，自动取消搜索
        const ac = new AbortController();
        const onClose = () => {
            ac.abort();
            if (DEBUG_MODE) console.log('[Search] Client disconnected, aborting search');
        };
        req.on('close', onClose);

        try {
            const notes = await queuedSearch(searchTerms, folder, ac.signal);
            const limited = notes.slice(0, maxResults);

            // 响应前检查连接是否还在
            if (req.destroyed) return;

            res.json({
                notes: limited,
                total: notes.length,
                limited: notes.length > maxResults,
            });
        } catch (err) {
            if (req.destroyed) return; // 客户端已断开，不发响应

            if (err.name === 'AbortError' || ac.signal.aborted) {
                return res.status(499).json({ error: 'Search cancelled' });
            }
            if (err.message.includes('timeout') || err.message.includes('Timeout')) {
                return res.status(504).json({ error: 'Search timed out, try more specific keywords' });
            }
            if (err.message.includes('Too many concurrent')) {
                return res.status(503).json({ error: err.message });
            }
            if (err.code === 'ENOENT') {
                return res.json({ notes: [], total: 0 });
            }

            console.error('[Search] Unexpected error:', err);
            res.status(500).json({ error: 'Search failed', details: err.message });
        } finally {
            req.removeListener('close', onClose);
        }
    });

    // ══════════════════════════════════════════════════
    //  队列状态接口
    // ══════════════════════════════════════════════════
    router.get('/admin/queue-status', (req, res) => {
        res.json({
            ...searchSemaphore.stats,
            inflight: inflightSearches.size,
        });
    });

    // ══════════════════════════════════════════════════
    //  以下为其他路由（folders / folder / note / move / delete 等）
    // ══════════════════════════════════════════════════

    // GET /folders - 获取所有文件夹（结构化分组 + 扁平列表向后兼容）
    router.get('/folders', async (req, res) => {
        try {
            const folders = [];        // flat list (backward compat)
            const publicFolders = [];  // knowledge/ shared dirs
            const agentsMap = {};      // agentName → { notebooks: [] }
            const thinkingFolders = []; // thinking cluster dirs

            // 1. Shared knowledge/ folders → public
            try {
                await fs.access(dailyNoteRootPath);
                const entries = await fs.readdir(dailyNoteRootPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const folderPath = path.join(dailyNoteRootPath, entry.name);
                        if (!(await isSymlink(folderPath))) {
                            folders.push(entry.name);
                            publicFolders.push(entry.name);
                        }
                    }
                }
            } catch (e) {
                if (e.code !== 'ENOENT') throw e;
            }

            // 2. Agent notebook directories → grouped by agent + thinking
            let notebookEntries = [];
            try {
                const { getNotebookEntries } = require('../modules/notebookResolver');
                notebookEntries = getNotebookEntries();
            } catch {}
            for (const entry of notebookEntries) {
                try { await fs.access(entry.path); } catch { continue; }
                if (!folders.includes(entry.displayName)) {
                    folders.push(entry.displayName);
                }

                if (entry.type === 'thinking') {
                    thinkingFolders.push({
                        displayName: entry.displayName,
                        folderName: entry.displayName,
                        agent: entry.agent,
                    });
                } else {
                    if (!agentsMap[entry.agent]) {
                        agentsMap[entry.agent] = { name: entry.agent, notebooks: [] };
                    }
                    agentsMap[entry.agent].notebooks.push({
                        displayName: entry.displayName,
                        folderName: entry.displayName,
                        type: entry.type, // "diary" | "knowledge"
                    });
                }
            }

            // Build agents array sorted by name
            const agents = Object.values(agentsMap).sort((a, b) => a.name.localeCompare(b.name));

            res.json({ folders, agents, public: publicFolders, thinking: thinkingFolders });
        } catch (error) {
            res.status(500).json({ error: 'Failed to list folders', details: error.message });
        }
    });

    // GET /folder/:folderName - 获取文件夹内的笔记
    router.get('/folder/:folderName', async (req, res) => {
        const folderName = req.params.folderName;
        const specificFolderPath = resolveFolderPath(folderName);

        if (!isFolderPathSafe(specificFolderPath)) {
            return res.status(403).json({ error: 'Invalid folder path' });
        }

        try {
            if (await isSymlink(specificFolderPath)) {
                return res.status(403).json({ error: 'Cannot access symbolic link folders' });
            }

            await fs.access(specificFolderPath);
            const files = await fs.readdir(specificFolderPath);
            const noteFiles = files.filter(file =>
                file.toLowerCase().endsWith('.txt') ||
                file.toLowerCase().endsWith('.md')
            );

            const notes = await Promise.all(noteFiles.map(async (file) => {
                const filePath = path.join(specificFolderPath, file);
                if (await isSymlink(filePath)) return null;

                const stats = await fs.stat(filePath);
                let preview = '';
                try {
                    if (stats.size <= SEARCH_CONFIG.MAX_FILE_SIZE) {
                        const content = await fs.readFile(filePath, 'utf-8');
                        preview = content.substring(0, SEARCH_CONFIG.PREVIEW_LENGTH)
                            .replace(/\n/g, ' ') +
                            (content.length > SEARCH_CONFIG.PREVIEW_LENGTH ? '...' : '');
                    } else {
                        preview = '[文件过大，无法预览]';
                    }
                } catch {
                    preview = '[无法加载预览]';
                }
                return {
                    name: file,
                    lastModified: stats.mtime.toISOString(),
                    preview: preview
                };
            }));

            const validNotes = notes.filter(n => n !== null);
            validNotes.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
            res.json({ notes: validNotes });

        } catch (error) {
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: `Folder '${folderName}' not found.` });
            } else {
                res.status(500).json({ error: `Failed to list notes`, details: error.message });
            }
        }
    });

    // GET /note/:folderName/:fileName - 获取笔记内容
    router.get('/note/:folderName/:fileName', async (req, res) => {
        const { folderName, fileName } = req.params;
        const resolvedFolder = resolveFolderPath(folderName);
        const filePath = path.join(resolvedFolder, fileName);

        if (!isFolderPathSafe(resolvedFolder)) {
            return res.status(403).json({ error: 'Invalid file path' });
        }

        try {
            if (await isSymlink(filePath)) {
                return res.status(403).json({ error: 'Cannot read symbolic link files' });
            }
            const content = await fs.readFile(filePath, 'utf-8');
            res.json({ content });
        } catch (error) {
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'File not found' });
            } else {
                res.status(500).json({ error: 'Failed to read file', details: error.message });
            }
        }
    });

    // POST /note/:folderName/:fileName - 保存笔记
    router.post('/note/:folderName/:fileName', async (req, res) => {
        const { folderName, fileName } = req.params;
        const { content } = req.body;

        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        if (folderName.includes('..') || fileName.includes('..') ||
            fileName.includes('/') || fileName.includes('\\')) {
            return res.status(403).json({ error: 'Invalid folder or file name' });
        }

        const targetFolderPath = resolveFolderPath(folderName);
        const filePath = path.join(targetFolderPath, fileName);

        if (!isFolderPathSafe(targetFolderPath)) {
            return res.status(403).json({ error: 'Invalid file path' });
        }

        try {
            await fs.mkdir(targetFolderPath, { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            dirCache.invalidate(targetFolderPath);
            res.json({ message: 'Saved successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to save file', details: error.message });
        }
    });

    // POST /move - 移动笔记
    router.post('/move', async (req, res) => {
        const { sourceNotes, targetFolder } = req.body;

        if (!Array.isArray(sourceNotes) || typeof targetFolder !== 'string') {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        if (targetFolder.includes('..')) {
            return res.status(403).json({ error: 'Invalid target folder name' });
        }

        const results = { moved: [], errors: [] };
        const targetFolderPath = resolveFolderPath(targetFolder);

        if (!isFolderPathSafe(targetFolderPath)) {
            return res.status(403).json({ error: 'Invalid target folder path' });
        }

        try {
            await fs.mkdir(targetFolderPath, { recursive: true });
            dirCache.invalidate(targetFolderPath);
            for (const note of sourceNotes) {
                if (note.folder.includes('..') || note.file.includes('..')) {
                    results.errors.push({ note: `${note.folder}/${note.file}`, error: 'Invalid path' });
                    continue;
                }

                const sourceFolderPath = resolveFolderPath(note.folder);
                const sourceFilePath = path.join(sourceFolderPath, note.file);
                const destinationFilePath = path.join(targetFolderPath, note.file);

                if (!isFolderPathSafe(sourceFolderPath) || !isFolderPathSafe(targetFolderPath)) {
                    results.errors.push({ note: `${note.folder}/${note.file}`, error: 'Invalid path' });
                    continue;
                }

                try {
                    await fs.access(sourceFilePath);
                    try {
                        await fs.access(destinationFilePath);
                        results.errors.push({
                            note: `${note.folder}/${note.file}`,
                            error: `File already exists at destination '${targetFolder}/${note.file}'. Move aborted for this file.`
                        });
                        continue;
                    } catch {
                        // 目标不存在，可以移动
                    }
                    
                    await fs.rename(sourceFilePath, destinationFilePath);
                    dirCache.invalidate(path.dirname(sourceFilePath));
                    results.moved.push(`${note.folder}/${note.file} to ${targetFolder}/${note.file}`);
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        results.errors.push({ note: `${note.folder}/${note.file}`, error: 'Source file not found.' });
                    } else {
                        results.errors.push({ note: `${note.folder}/${note.file}`, error: error.message });
                    }
                }
            }
            const message = `Moved ${results.moved.length} note(s). ${results.errors.length > 0 ? `Encountered ${results.errors.length} error(s).` : ''}`;
            res.json({ message, moved: results.moved, errors: results.errors });
        } catch (error) {
            res.status(500).json({ error: 'Move operation failed', details: error.message });
        }
    });

    // POST /delete-batch - 批量删除
    router.post('/delete-batch', async (req, res) => {
        const { notesToDelete } = req.body;
        if (!Array.isArray(notesToDelete)) {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        const results = { deleted: [], errors: [] };
        for (const note of notesToDelete) {
            const noteFolderPath = resolveFolderPath(note.folder);
            const filePath = path.join(noteFolderPath, note.file);
            if (!isFolderPathSafe(noteFolderPath)) {
                results.errors.push({ note: `${note.folder}/${note.file}`, error: 'Invalid path' });
                continue;
            }

            try {
                await fs.unlink(filePath);
                dirCache.invalidate(path.dirname(filePath));
                results.deleted.push(`${note.folder}/${note.file}`);
            } catch (error) {
                results.errors.push({ note: `${note.folder}/${note.file}`, error: error.message });
            }
        }
        res.json(results);
    });

    // POST /rename - 重命名笔记文件
    router.post('/rename', async (req, res) => {
        const { folder, oldName, newName } = req.body;
        if (!folder || !oldName || !newName) {
            return res.status(400).json({ error: 'Missing folder, oldName, or newName' });
        }
        if (oldName === newName) return res.json({ message: 'No change' });
        // Sanitize: no path separators in file names
        if (/[/\\]/.test(newName)) {
            return res.status(400).json({ error: 'Invalid file name' });
        }
        const folderPath = resolveFolderPath(folder);
        if (!isFolderPathSafe(folderPath)) {
            return res.status(403).json({ error: 'Path not allowed' });
        }
        const oldPath = path.join(folderPath, oldName);
        const newPath = path.join(folderPath, newName);
        try {
            // Check new name doesn't already exist
            try {
                await fs.access(newPath);
                return res.status(409).json({ error: 'Target file already exists' });
            } catch { /* good, doesn't exist */ }
            await fs.rename(oldPath, newPath);
            dirCache.invalidate(folderPath);
            res.json({ message: 'Renamed', oldName, newName });
        } catch (error) {
            res.status(500).json({ error: 'Rename failed', details: error.message });
        }
    });

    // POST /folder/delete - 删除空文件夹
    router.post('/folder/delete', async (req, res) => {
        const { folderName } = req.body;
        if (!folderName) return res.status(400).json({ error: 'Folder name required' });

        const targetFolderPath = resolveFolderPath(folderName);
        if (!isFolderPathSafe(targetFolderPath) || targetFolderPath === path.resolve(dailyNoteRootPath)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        try {
            await fs.access(targetFolderPath);
            
            const files = await fs.readdir(targetFolderPath);
            if (files.length > 0) {
                return res.status(400).json({
                    error: `Folder '${folderName}' is not empty.`,
                    message: '为了安全起见，非空文件夹禁止删除。请先删除或移动其中的所有内容。'
                });
            }
            
            await fs.rmdir(targetFolderPath);
            dirCache.invalidate(dailyNoteRootPath);
            dirCache.invalidate(targetFolderPath);
            res.json({ message: `Empty folder '${folderName}' has been deleted successfully.` });
        } catch (error) {
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: `Folder '${folderName}' not found.` });
            } else {
                res.status(500).json({ error: `Failed to delete folder ${folderName}`, details: error.message });
            }
        }
    });

    // POST /associative-discovery - 联想追溯
    router.post('/associative-discovery', async (req, res) => {
        const { sourceFilePath, k, range, tagBoost } = req.body;

        if (!sourceFilePath) {
            return res.status(400).json({ error: 'sourceFilePath is required' });
        }

        // 安全检查：sourceFilePath 格式可能是 "folderName/fileName" 或 "Agent/Name/diary/fileName"
        const parts = sourceFilePath.split('/');
        const fileName = parts.pop();
        const folderPart = parts.join('/');
        const resolvedFolder = folderPart ? resolveFolderPath(folderPart) : dailyNoteRootPath;
        const fullPath = path.join(resolvedFolder, fileName);
        if (!isFolderPathSafe(resolvedFolder)) {
            return res.status(403).json({ error: 'Invalid file path' });
        }

        try {
            const associativeDiscovery = require('../modules/associativeDiscovery');

            // 🌟 Wave v8: tagBoost 支持 "0.6+" 语法，保留字符串透传到底层
            let parsedTagBoost;
            if (typeof tagBoost === 'string' && tagBoost.trim().endsWith('+')) {
                // "0.6+" → 保留原始字符串交给 KBM.search 解析
                parsedTagBoost = tagBoost.trim();
            } else {
                parsedTagBoost = parseFloat(tagBoost) || 0.15;
            }

            const result = await associativeDiscovery.discover({
                sourceFilePath,
                k: parseInt(k) || 10,
                range: Array.isArray(range) ? range : [],
                tagBoost: parsedTagBoost
            });

            res.json(result);
        } catch (error) {
            console.error('[AssociativeDiscovery] Error:', error);
            res.status(500).json({ 
                error: '联想追溯失败', 
                details: error.message 
            });
        }
    });

    return router;
};