const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// 记录每个日志文件的 inode，用于检测日志轮转
const logFileInodes = new Map();

// 归档文件大小上限（读取时）：5MB
const MAX_ARCHIVE_READ_SIZE = 5 * 1024 * 1024;
// 重启脚本日志大小上限：200KB
const MAX_RESTART_LOG_SIZE = 200 * 1024;

// 校验日期字符串（YYYY-MM-DD）
function isValidDateStr(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// 校验归档索引（3 位数字字符串或普通整数）
function normalizeArchiveIndex(s) {
    if (typeof s !== 'string' && typeof s !== 'number') return null;
    const n = parseInt(String(s), 10);
    if (Number.isNaN(n) || n < 1 || n > 9999) return null;
    return String(n).padStart(3, '0');
}

// 从日志内容中检测是否含有 error 级别
function detectHasError(content) {
    return /\[ERROR\]/.test(content);
}

module.exports = function(options) {
    const router = express.Router();
    const { getCurrentServerLogPath } = options;

    // 从主日志路径推导 DebugLog 根目录与 archive 目录
    function getDebugLogDir() {
        const logPath = getCurrentServerLogPath();
        if (!logPath) return null;
        return path.dirname(logPath);
    }

    function getArchiveDir() {
        const debugDir = getDebugLogDir();
        return debugDir ? path.join(debugDir, 'archive') : null;
    }

    // ================== 当前会话日志（保留原逻辑） ==================
    router.get('/server-log', async (req, res) => {
        const logPath = getCurrentServerLogPath();
        if (!logPath) {
            return res.status(503).json({ error: 'Server log path not available.', content: '服务器日志路径当前不可用，可能仍在初始化中。' });
        }
        try {
            const stats = await fs.stat(logPath);
            const currentInode = stats.ino;
            const fileSize = stats.size;

            const incremental = req.query.incremental === 'true';
            const offset = parseInt(req.query.offset || '0', 10);

            const lastInode = logFileInodes.get(logPath);
            if (incremental && lastInode && (currentInode !== lastInode || offset > fileSize)) {
                logFileInodes.set(logPath, currentInode);
                return res.json({
                    needFullReload: true,
                    path: logPath,
                    offset: 0
                });
            }

            logFileInodes.set(logPath, currentInode);

            let content = '';
            let newOffset = 0;

            const fd = await fs.open(logPath, 'r');
            try {
                if (incremental && offset >= 0 && offset <= fileSize) {
                    const bufferSize = fileSize - offset;
                    if (bufferSize > 0) {
                        const buffer = Buffer.alloc(bufferSize);
                        const { bytesRead } = await fd.read(buffer, 0, bufferSize, offset);
                        content = buffer.toString('utf-8', 0, bytesRead);
                    }
                    newOffset = fileSize;
                } else {
                    const maxReadSize = 2 * 1024 * 1024;
                    let startPos = 0;
                    let readSize = fileSize;

                    if (fileSize > maxReadSize) {
                        startPos = fileSize - maxReadSize;
                        readSize = maxReadSize;
                    }

                    const buffer = Buffer.alloc(readSize);
                    const { bytesRead } = await fd.read(buffer, 0, readSize, startPos);
                    content = buffer.toString('utf-8', 0, bytesRead);

                    if (startPos > 0) {
                        const firstNewline = content.indexOf('\n');
                        if (firstNewline !== -1) {
                            content = content.substring(firstNewline + 1);
                        }
                    }
                    newOffset = fileSize;
                }
            } finally {
                await fd.close();
            }

            res.json({
                content: content,
                offset: newOffset,
                path: logPath,
                fileSize: fileSize,
                needFullReload: false
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`[AdminPanelRoutes API] /server-log - Log file not found at: ${logPath}`);
                res.status(404).json({ error: 'Log file not found.', content: `日志文件 ${logPath} 未找到。它可能尚未创建或已被删除。`, path: logPath });
            } else {
                console.error(`[AdminPanelRoutes API] Error reading server log file ${logPath}:`, error);
                res.status(500).json({ error: 'Failed to read server log file', details: error.message, content: `读取日志文件 ${logPath} 失败。`, path: logPath });
            }
        }
    });

    // 清空当前日志文件
    router.post('/server-log/clear', async (req, res) => {
        const logPath = getCurrentServerLogPath();
        if (!logPath) {
            return res.status(503).json({ error: 'Server log path not available.' });
        }
        try {
            await fs.writeFile(logPath, '', 'utf-8');
            const stats = await fs.stat(logPath);
            logFileInodes.set(logPath, stats.ino);
            res.json({ success: true, message: '日志已清空' });
        } catch (error) {
            console.error(`[AdminPanelRoutes API] Error clearing server log file ${logPath}:`, error);
            res.status(500).json({ error: 'Failed to clear server log file', details: error.message });
        }
    });

    // ================== 归档列表 ==================
    // GET /server-log/archives
    // 返回：{ archives: [{ date, sessions: [{ index, size, mtime, hasError?, firstLine? }] }] }
    router.get('/server-log/archives', async (req, res) => {
        const archiveDir = getArchiveDir();
        if (!archiveDir) {
            return res.status(503).json({ error: 'Archive directory unavailable' });
        }

        try {
            if (!fsSync.existsSync(archiveDir)) {
                return res.json({ archives: [] });
            }

            const dateDirs = await fs.readdir(archiveDir);
            const result = [];

            for (const dateDir of dateDirs) {
                if (!isValidDateStr(dateDir)) continue;

                const sessionDir = path.join(archiveDir, dateDir, 'ServerLog');
                if (!fsSync.existsSync(sessionDir)) continue;

                let files = [];
                try {
                    files = await fs.readdir(sessionDir);
                } catch {
                    continue;
                }

                const sessions = [];
                for (const f of files) {
                    const m = f.match(/^(\d{3})\.txt$/);
                    if (!m) continue;

                    const filePath = path.join(sessionDir, f);
                    let stat;
                    try {
                        stat = await fs.stat(filePath);
                    } catch {
                        continue;
                    }

                    // 快速读取前 2KB 提取首行（启动标记）作为会话标签
                    let firstLine = '';
                    try {
                        const fd = await fs.open(filePath, 'r');
                        try {
                            const buf = Buffer.alloc(Math.min(2048, stat.size));
                            const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
                            const head = buf.toString('utf-8', 0, bytesRead);
                            const nl = head.indexOf('\n');
                            firstLine = nl >= 0 ? head.slice(0, nl) : head;
                        } finally {
                            await fd.close();
                        }
                    } catch {
                        // ignore
                    }

                    sessions.push({
                        index: parseInt(m[1], 10),
                        size: stat.size,
                        mtime: Math.floor(stat.mtimeMs / 1000),
                        firstLine: firstLine.slice(0, 200),
                    });
                }

                if (sessions.length === 0) continue;

                // 同一天内按 index 降序（最新的在前）
                sessions.sort((a, b) => b.index - a.index);

                result.push({ date: dateDir, sessions });
            }

            // 日期降序（最新日期在前）
            result.sort((a, b) => (a.date < b.date ? 1 : -1));

            res.json({ archives: result });
        } catch (error) {
            console.error('[AdminPanelRoutes API] Error listing archives:', error);
            res.status(500).json({ error: 'Failed to list archives', details: error.message });
        }
    });

    // ================== 归档内容读取 ==================
    // GET /server-log/archives/:date/:index
    router.get('/server-log/archives/:date/:index', async (req, res) => {
        const archiveDir = getArchiveDir();
        if (!archiveDir) {
            return res.status(503).json({ error: 'Archive directory unavailable' });
        }

        const { date, index } = req.params;
        if (!isValidDateStr(date)) {
            return res.status(400).json({ error: 'Invalid date format (expect YYYY-MM-DD)' });
        }
        const idx = normalizeArchiveIndex(index);
        if (!idx) {
            return res.status(400).json({ error: 'Invalid archive index' });
        }

        const filePath = path.join(archiveDir, date, 'ServerLog', `${idx}.txt`);

        // 路径穿越防护：确保最终路径在 archiveDir 内
        const resolved = path.resolve(filePath);
        const resolvedArchiveDir = path.resolve(archiveDir);
        if (!resolved.startsWith(resolvedArchiveDir + path.sep)) {
            return res.status(403).json({ error: 'Forbidden path' });
        }

        try {
            const stat = await fs.stat(filePath);
            const fileSize = stat.size;
            let content = '';
            let truncated = false;
            let readFrom = 0;

            const fd = await fs.open(filePath, 'r');
            try {
                if (fileSize <= MAX_ARCHIVE_READ_SIZE) {
                    const buf = Buffer.alloc(fileSize);
                    const { bytesRead } = await fd.read(buf, 0, fileSize, 0);
                    content = buf.toString('utf-8', 0, bytesRead);
                } else {
                    truncated = true;
                    readFrom = fileSize - MAX_ARCHIVE_READ_SIZE;
                    const buf = Buffer.alloc(MAX_ARCHIVE_READ_SIZE);
                    const { bytesRead } = await fd.read(buf, 0, MAX_ARCHIVE_READ_SIZE, readFrom);
                    content = buf.toString('utf-8', 0, bytesRead);
                    // 跳过第一行（可能被截断）
                    const nl = content.indexOf('\n');
                    if (nl !== -1) content = content.slice(nl + 1);
                }
            } finally {
                await fd.close();
            }

            res.json({
                content,
                fileSize,
                truncated,
                readFrom,
                hasError: detectHasError(content),
                path: filePath,
                date,
                index: parseInt(idx, 10),
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Archive not found' });
            }
            console.error('[AdminPanelRoutes API] Error reading archive:', error);
            res.status(500).json({ error: 'Failed to read archive', details: error.message });
        }
    });

    // ================== 删除归档 ==================
    // DELETE /server-log/archives/:date/:index
    router.delete('/server-log/archives/:date/:index', async (req, res) => {
        const archiveDir = getArchiveDir();
        if (!archiveDir) {
            return res.status(503).json({ error: 'Archive directory unavailable' });
        }

        const { date, index } = req.params;
        if (!isValidDateStr(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        const idx = normalizeArchiveIndex(index);
        if (!idx) {
            return res.status(400).json({ error: 'Invalid archive index' });
        }

        const filePath = path.join(archiveDir, date, 'ServerLog', `${idx}.txt`);
        const resolved = path.resolve(filePath);
        const resolvedArchiveDir = path.resolve(archiveDir);
        if (!resolved.startsWith(resolvedArchiveDir + path.sep)) {
            return res.status(403).json({ error: 'Forbidden path' });
        }

        try {
            await fs.unlink(filePath);
            res.json({ success: true });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Archive not found' });
            }
            console.error('[AdminPanelRoutes API] Error deleting archive:', error);
            res.status(500).json({ error: 'Failed to delete archive', details: error.message });
        }
    });

    // ================== 重启脚本日志 ==================
    // GET /server-log/restart-logs
    router.get('/server-log/restart-logs', async (req, res) => {
        const debugDir = getDebugLogDir();
        if (!debugDir) {
            return res.status(503).json({ error: 'DebugLog directory unavailable' });
        }

        async function readTailSafe(filename) {
            const filePath = path.join(debugDir, filename);
            try {
                const stat = await fs.stat(filePath);
                const fileSize = stat.size;
                const readSize = Math.min(fileSize, MAX_RESTART_LOG_SIZE);
                const readFrom = fileSize - readSize;

                const fd = await fs.open(filePath, 'r');
                try {
                    const buf = Buffer.alloc(readSize);
                    const { bytesRead } = await fd.read(buf, 0, readSize, readFrom);
                    let content = buf.toString('utf-8', 0, bytesRead);
                    if (readFrom > 0) {
                        const nl = content.indexOf('\n');
                        if (nl !== -1) content = content.slice(nl + 1);
                    }
                    return {
                        exists: true,
                        content,
                        size: fileSize,
                        truncated: readFrom > 0,
                        mtime: Math.floor(stat.mtimeMs / 1000),
                    };
                } finally {
                    await fd.close();
                }
            } catch (err) {
                if (err.code === 'ENOENT') {
                    return { exists: false, content: '', size: 0, truncated: false, mtime: 0 };
                }
                throw err;
            }
        }

        try {
            const [server, admin] = await Promise.all([
                readTailSafe('server-restart.log'),
                readTailSafe('admin-restart.log'),
            ]);
            res.json({ server, admin });
        } catch (error) {
            console.error('[AdminPanelRoutes API] Error reading restart logs:', error);
            res.status(500).json({ error: 'Failed to read restart logs', details: error.message });
        }
    });

    return router;
};
