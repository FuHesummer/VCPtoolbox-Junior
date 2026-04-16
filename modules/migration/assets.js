// modules/migration/assets.js
// 静态资产迁移：TVStxt/*.txt + image/<表情包>/ 同结构直接 copy
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECT_ROOT, copyDir } = require('./utils');

const JUNIOR_TVS_DIR = path.join(PROJECT_ROOT, 'TVStxt');
const JUNIOR_IMAGE_DIR = path.join(PROJECT_ROOT, 'image');

async function migrateTvs(sourceRoot, selectedNames, emitter) {
    const result = { migrated: [], skipped: [], failed: [] };
    const srcDir = path.join(sourceRoot, 'TVStxt');
    if (!fs.existsSync(srcDir)) {
        emit(emitter, 'warn', 'tvs', '上游 TVStxt/ 不存在，跳过');
        return result;
    }
    await fsp.mkdir(JUNIOR_TVS_DIR, { recursive: true });

    for (const name of selectedNames) {
        try {
            const srcFile = path.join(srcDir, name);
            if (!fs.existsSync(srcFile)) {
                result.skipped.push({ name, reason: 'source missing' });
                continue;
            }
            await fsp.copyFile(srcFile, path.join(JUNIOR_TVS_DIR, name));
            result.migrated.push({ name, from: `TVStxt/${name}`, to: `TVStxt/${name}` });
            emit(emitter, 'progress', 'tvs', `✅ ${name}`);
        } catch (e) {
            result.failed.push({ name, error: e.message });
            emit(emitter, 'error', 'tvs', `❌ ${name}: ${e.message}`);
        }
    }
    return result;
}

async function migrateImages(sourceRoot, selectedNames, emitter) {
    const result = { migrated: [], skipped: [], failed: [] };
    const srcDir = path.join(sourceRoot, 'image');
    if (!fs.existsSync(srcDir)) {
        emit(emitter, 'warn', 'images', '上游 image/ 不存在，跳过');
        return result;
    }
    await fsp.mkdir(JUNIOR_IMAGE_DIR, { recursive: true });

    for (const name of selectedNames) {
        try {
            const srcSub = path.join(srcDir, name);
            if (!fs.existsSync(srcSub)) {
                result.skipped.push({ name, reason: 'source missing' });
                continue;
            }
            const st = await fsp.stat(srcSub);
            const destSub = path.join(JUNIOR_IMAGE_DIR, name);
            if (st.isDirectory()) {
                await fsp.mkdir(destSub, { recursive: true });
                const count = await copyDir(srcSub, destSub, []);
                result.migrated.push({ name, from: `image/${name}`, to: `image/${name}`, fileCount: count });
                emit(emitter, 'progress', 'images', `✅ ${name} (${count} 文件)`);
            } else {
                await fsp.copyFile(srcSub, destSub);
                result.migrated.push({ name, from: `image/${name}`, to: `image/${name}`, fileCount: 1 });
                emit(emitter, 'progress', 'images', `✅ ${name}`);
            }
        } catch (e) {
            result.failed.push({ name, error: e.message });
            emit(emitter, 'error', 'images', `❌ ${name}: ${e.message}`);
        }
    }
    return result;
}

function emit(emitter, level, stage, message) {
    if (!emitter || typeof emitter.emit !== 'function') return;
    emitter.emit('log', { level, stage, message, ts: new Date().toISOString() });
}

module.exports = { migrateTvs, migrateImages };
