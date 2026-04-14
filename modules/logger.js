// modules/logger.js
const fsSync = require('fs');
const fs = require('fs').promises; // 用于异步文件操作
const path = require('path');

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Shanghai';

// Use VCP_ROOT set by server.js — works in both source and bundle mode.
// path.dirname(__dirname) breaks in bundle: __dirname is already root, dirname goes to parent.
const DEBUG_LOG_DIR = path.join(process.env.VCP_ROOT || path.dirname(__dirname), 'DebugLog');
const ARCHIVE_DIR = path.join(DEBUG_LOG_DIR, 'archive');

// ============================================
// RotatingLogger 类 - 日志轮转核心实现
// ============================================
class RotatingLogger {
  constructor(options = {}) {
    // 配置项
    this.maxFileSize = options.maxFileSize || 5 * 1024 * 1024; // 默认 5MB
    this.maxDays = options.maxDays || 7; // 默认保留 7 天
    this.logDir = options.logDir || DEBUG_LOG_DIR;
    this.archiveDir = options.archiveDir || ARCHIVE_DIR;
    this.timezone = options.timezone || DEFAULT_TIMEZONE;
    
    // 状态
    this.currentDate = null;
    this.currentFileIndex = 0;
    this.currentFilePath = null;
    this.writeStream = null;
    this.currentFileSize = 0;
    this.isRotating = false;
    this.pendingWrites = [];
  }

  // 获取当前日期字符串 (YYYY-MM-DD)
  _getDateString() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: this.timezone
    });
    return formatter.format(new Date());
  }

  // 生成主日志文件路径（固定文件名）
  _generateMainFilePath() {
    return path.join(this.logDir, 'ServerLog.txt');
  }

  // 生成归档文件路径
  _generateArchiveFilePath(dateStr, index) {
    const archiveDateDir = path.join(this.archiveDir, dateStr, 'ServerLog');
    const suffix = index.toString().padStart(3, '0');
    return path.join(archiveDateDir, `${suffix}.txt`);
  }

  // 确保归档目录存在
  _ensureArchiveDir(dateStr) {
    const archiveDateDir = path.join(this.archiveDir, dateStr, 'ServerLog');
    if (!fsSync.existsSync(archiveDateDir)) {
      fsSync.mkdirSync(archiveDateDir, { recursive: true });
    }
    return archiveDateDir;
  }

  // 检查是否需要轮转
  shouldRotate() {
    const today = this._getDateString();
    if (today !== this.currentDate) return 'date';
    if (this.currentFileSize >= this.maxFileSize) return 'size';
    return false;
  }

  // 归档当前日志文件
  async _archiveCurrentLog() {
    const mainFilePath = this._generateMainFilePath();
    if (!fsSync.existsSync(mainFilePath)) return;
    
    // 确保归档目录存在
    this._ensureArchiveDir(this.currentDate);
    
    // 找到下一个可用的归档索引
    let archiveIndex = 1;
    let archivePath = this._generateArchiveFilePath(this.currentDate, archiveIndex);
    while (fsSync.existsSync(archivePath)) {
      archiveIndex++;
      archivePath = this._generateArchiveFilePath(this.currentDate, archiveIndex);
    }
    
    // 移动文件到归档目录
    try {
      await fs.rename(mainFilePath, archivePath);
      originalConsoleLog(`[Logger] 日志已归档: ${archivePath}`);
    } catch (err) {
      originalConsoleError(`[Logger] 归档失败:`, err);
    }
  }

  // 打开新的写入流（始终写入固定文件名）
  _openNewStream() {
    this.currentFilePath = this._generateMainFilePath();
    
    // 如果文件已存在，获取其大小
    if (fsSync.existsSync(this.currentFilePath)) {
      const stats = fsSync.statSync(this.currentFilePath);
      this.currentFileSize = stats.size;
    } else {
      this.currentFileSize = 0;
    }
    
    this.writeStream = fsSync.createWriteStream(this.currentFilePath, { flags: 'a' });
    
    // 写入启动标记
    const startTime = new Date().toLocaleString('zh-CN', { timeZone: this.timezone });
    const header = `[${startTime}] Log file started.\n`;
    this.writeStream.write(header);
    this.currentFileSize += Buffer.byteLength(header);
  }

  // 关闭当前写入流
  async _closeCurrentStream() {
    if (this.writeStream) {
      return new Promise((resolve) => {
        this.writeStream.end(() => {
          this.writeStream = null;
          resolve();
        });
      });
    }
  }

  // 执行轮转
  async rotate(reason) {
    if (this.isRotating) return;
    this.isRotating = true;
    
    try {
      await this._closeCurrentStream();
      
      // 归档当前日志
      await this._archiveCurrentLog();
      
      if (reason === 'date') {
        this.currentDate = this._getDateString();
      }
      
      this._openNewStream();
      
      // 异步清理旧日志（不阻塞写入）
      this._cleanOldLogs().catch(err => {
        originalConsoleError('[Logger] 清理旧日志失败:', err);
      });
    } finally {
      this.isRotating = false;
      // 处理轮转期间积压的写入
      this._flushPendingWrites();
    }
  }

  // 处理积压的写入
  _flushPendingWrites() {
    while (this.pendingWrites.length > 0) {
      const message = this.pendingWrites.shift();
      this._doWrite(message);
    }
  }

  // 实际写入操作
  _doWrite(message) {
    if (this.writeStream) {
      this.writeStream.write(message, (err) => {
        if (err) originalConsoleError('[Logger] 写入失败:', err);
      });
      this.currentFileSize += Buffer.byteLength(message);
    }
  }

  // 写入日志（带缓冲队列）
  write(message) {
    // 如果正在轮转，先缓存
    if (this.isRotating) {
      this.pendingWrites.push(message);
      return;
    }
    
    // 每次写入前检查轮转条件（确保文件大小精确控制）
    const rotateReason = this.shouldRotate();
    if (rotateReason) {
      this.pendingWrites.push(message);
      this.rotate(rotateReason);
      return;
    }
    
    this._doWrite(message);
  }

  // 清理旧日志（清理归档目录中的旧日期文件夹）
  async _cleanOldLogs() {
    try {
      if (!fsSync.existsSync(this.archiveDir)) return;
      
      const dateDirs = await fs.readdir(this.archiveDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.maxDays);
      
      const deletePromises = [];
      for (const dateDir of dateDirs) {
        // 匹配日期目录格式：YYYY-MM-DD
        const match = dateDir.match(/^(\d{4}-\d{2}-\d{2})$/);
        if (match) {
          const dirDate = new Date(match[1] + 'T00:00:00');
          if (dirDate < cutoffDate) {
            const dirPath = path.join(this.archiveDir, dateDir);
            deletePromises.push(
              fs.rm(dirPath, { recursive: true, force: true })
                .then(() => originalConsoleLog(`[Logger] 已删除旧归档目录: ${dateDir}`))
                .catch(err => originalConsoleError(`[Logger] 删除 ${dateDir} 失败:`, err))
            );
          }
        }
      }
      await Promise.all(deletePromises);
    } catch (err) {
      originalConsoleError('[Logger] 读取归档目录失败:', err);
    }
  }

  // 初始化
  initialize() {
    ensureDebugLogDirSync();
    this.currentDate = this._getDateString();

    // 启动即归档：若主日志文件已存在且非空，先归档再开新流
    // 这样 ServerLog.txt 永远只包含当前这次启动的内容
    try {
      const mainFilePath = this._generateMainFilePath();
      if (fsSync.existsSync(mainFilePath)) {
        const stats = fsSync.statSync(mainFilePath);
        if (stats.size > 0) {
          this._archiveCurrentLogSync(stats);
        }
      }
    } catch (err) {
      originalConsoleError('[Logger] 启动归档失败（将继续 append 到原文件）:', err);
    }

    this._openNewStream();
    // 启动时清理旧日志
    this._cleanOldLogs().catch(err => {
      originalConsoleError('[Logger] 启动清理失败:', err);
    });
  }

  // 同步版归档（仅启动时使用，确保新流打开前完成）
  _archiveCurrentLogSync(stats) {
    const mainFilePath = this._generateMainFilePath();

    // 归档日期优先使用文件最后修改时间所在的那一天（更贴近日志真实归属）
    let archiveDate = this.currentDate;
    try {
      const mtime = stats.mtime;
      const fmt = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: this.timezone
      });
      archiveDate = fmt.format(mtime);
    } catch {
      // fallback to current date
    }

    this._ensureArchiveDir(archiveDate);

    let archiveIndex = 1;
    let archivePath = this._generateArchiveFilePath(archiveDate, archiveIndex);
    while (fsSync.existsSync(archivePath)) {
      archiveIndex++;
      archivePath = this._generateArchiveFilePath(archiveDate, archiveIndex);
    }

    try {
      fsSync.renameSync(mainFilePath, archivePath);
      originalConsoleLog(`[Logger] 启动归档: ${path.basename(archivePath)} (${archiveDate}, ${stats.size} bytes)`);
    } catch (err) {
      originalConsoleError('[Logger] 启动归档 rename 失败:', err);
    }
  }

  // 获取当前文件路径
  getFilePath() {
    return this.currentFilePath;
  }

  // 获取当前写入流
  getWriteStream() {
    return this.writeStream;
  }
}

// 模块级 RotatingLogger 实例
let rotatingLogger = null;

// 保存原始 console 方法
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

function ensureDebugLogDirSync() {
  if (!fsSync.existsSync(DEBUG_LOG_DIR)) {
    try {
      fsSync.mkdirSync(DEBUG_LOG_DIR, { recursive: true });
      originalConsoleLog(`[ServerSetup] DebugLog 目录已创建: ${DEBUG_LOG_DIR}`);
    } catch (error) {
      originalConsoleError(`[ServerSetup] 创建 DebugLog 目录失败: ${DEBUG_LOG_DIR}`, error);
    }
  }
}

function initializeServerLogger() {
  // 从环境变量读取配置
  const maxFileSize = parseInt(process.env.LOG_MAX_FILE_SIZE) || 5 * 1024 * 1024; // 默认 5MB
  const maxDays = parseInt(process.env.LOG_MAX_DAYS) || 7; // 默认 7 天
  
  // 诊断日志：确认配置
  originalConsoleLog(`[LoggerSetup] 使用的默认时区: ${DEFAULT_TIMEZONE}`);
  originalConsoleLog(`[LoggerSetup] 日志轮转配置: maxFileSize=${maxFileSize}, maxDays=${maxDays}`);
  
  // 创建 RotatingLogger 实例
  rotatingLogger = new RotatingLogger({
    maxFileSize,
    maxDays,
    timezone: DEFAULT_TIMEZONE
  });
  rotatingLogger.initialize();
  
  originalConsoleLog(`[ServerSetup] 服务器日志将记录到: ${rotatingLogger.getFilePath()}`);
}

function formatLogMessage(level, args) {
  // 使用配置的时区格式化日志时间戳
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: DEFAULT_TIMEZONE });
  const safeStringify = obj => {
    const cache = new Set();
    return JSON.stringify(
      obj,
      (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) {
            return '[Circular]';
          }
          cache.add(value);
        }
        return value;
      },
      2,
    );
  };
  const message = args.map(arg => (typeof arg === 'object' ? safeStringify(arg) : String(arg))).join(' ');
  return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
}

function writeToLogFile(formattedMessage) {
  if (rotatingLogger) {
    rotatingLogger.write(formattedMessage);
  }
}

function overrideConsole() {
  console.log = (...args) => {
    originalConsoleLog.apply(console, args);
    const formattedMessage = formatLogMessage('log', args);
    writeToLogFile(formattedMessage);
  };

  console.error = (...args) => {
    originalConsoleError.apply(console, args);
    const formattedMessage = formatLogMessage('error', args);
    writeToLogFile(formattedMessage);
  };

  console.warn = (...args) => {
    originalConsoleWarn.apply(console, args);
    const formattedMessage = formatLogMessage('warn', args);
    writeToLogFile(formattedMessage);
  };

  console.info = (...args) => {
    originalConsoleInfo.apply(console, args);
    const formattedMessage = formatLogMessage('info', args);
    writeToLogFile(formattedMessage);
  };
}

function getServerLogPath() {
  return rotatingLogger ? rotatingLogger.getFilePath() : '';
}

function getLogWriteStream() {
  return rotatingLogger ? rotatingLogger.getWriteStream() : null;
}

module.exports = {
  initializeServerLogger,
  overrideConsole,
  getServerLogPath,
  getLogWriteStream,
  originalConsoleLog,
  originalConsoleError,
};
