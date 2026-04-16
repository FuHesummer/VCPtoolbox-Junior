// modules/migration/lock.js
// 迁移串行锁：同时只允许 1 个迁移任务
const crypto = require('crypto');

class MigrationLock {
    constructor() {
        this.current = null; // { jobId, startedAt, label, emitter, cancelRequested }
    }

    acquire(label, emitter) {
        if (this.current) {
            const running = this.current;
            const err = new Error('ANOTHER_JOB_RUNNING');
            err.code = 'ANOTHER_JOB_RUNNING';
            err.runningJobId = running.jobId;
            throw err;
        }
        const jobId = crypto.randomBytes(8).toString('hex');
        this.current = {
            jobId,
            label: label || 'migration',
            startedAt: new Date().toISOString(),
            emitter,
            cancelRequested: false,
        };
        return this.current;
    }

    release(jobId) {
        if (this.current && this.current.jobId === jobId) {
            this.current = null;
            return true;
        }
        return false;
    }

    cancel(jobId) {
        if (this.current && this.current.jobId === jobId) {
            this.current.cancelRequested = true;
            return true;
        }
        return false;
    }

    isCancelled(jobId) {
        return this.current && this.current.jobId === jobId && this.current.cancelRequested;
    }

    status() {
        if (!this.current) return { running: false };
        return {
            running: true,
            jobId: this.current.jobId,
            label: this.current.label,
            startedAt: this.current.startedAt,
            cancelRequested: this.current.cancelRequested,
        };
    }
}

// 单例
module.exports = new MigrationLock();
