/**
 * EmojiListGenerator Admin API Router
 *
 * 暴露表情包 CRUD 接口给 AdminPanel 管理页面。
 * 路径约定：VCP_ROOT/image/<XXX表情包>/*.png|jpg|jpeg|gif
 *
 * 挂载点：/admin_api/plugins/EmojiListGenerator/api/*
 * - GET  /packs                       — 列出所有表情包目录 + 图片数量
 * - GET  /packs/:name/images          — 列出某表情包的图片列表（含 URL 预览）
 * - POST /packs                       — 新建表情包目录 { name }
 * - DELETE /packs/:name               — 删除整个表情包目录
 * - POST /packs/:name/upload          — 上传图片（multipart/form-data）
 * - DELETE /packs/:name/images/:file  — 删除单张图片
 * - POST /regenerate                  — 立即重新执行 node emoji-list-generator.js
 * - GET  /generated/:name             — 读取 generated_lists/XXX表情包.txt 内容
 */
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const PLUGIN_DIR = __dirname;
const VCP_ROOT = process.env.VCP_ROOT || path.join(PLUGIN_DIR, '..', '..');
const IMAGE_DIR = path.join(VCP_ROOT, 'image');
const GENERATED_DIR = path.join(PLUGIN_DIR, 'generated_lists');
const IMAGE_EXT_REGEX = /\.(jpg|jpeg|png|gif|webp)$/i;
const EMOJI_PACK_SUFFIX = '表情包';

// 安全：表情包名必须以「表情包」结尾 + 不含路径分隔符 + 长度限制
function isValidPackName(name) {
    if (!name || typeof name !== 'string') return false;
    if (!name.endsWith(EMOJI_PACK_SUFFIX)) return false;
    if (name.length > 60) return false;
    if (/[\/\\\0\.\.]/.test(name)) return false;
    if (name.startsWith('.')) return false;
    return true;
}

function isValidFileName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.length > 200) return false;
    if (/[\/\\\0]/.test(name)) return false;
    if (name.startsWith('.')) return false;
    return IMAGE_EXT_REGEX.test(name);
}

function resolvePackPath(packName) {
    if (!isValidPackName(packName)) return null;
    const resolved = path.resolve(IMAGE_DIR, packName);
    if (!resolved.startsWith(path.resolve(IMAGE_DIR) + path.sep) && resolved !== path.resolve(IMAGE_DIR)) {
        return null; // 路径穿越防护
    }
    return resolved;
}

async function listPacks() {
    try {
        const entries = await fsp.readdir(IMAGE_DIR, { withFileTypes: true });
        const packs = [];
        for (const e of entries) {
            if (!e.isDirectory() || !isValidPackName(e.name)) continue;
            const packPath = path.join(IMAGE_DIR, e.name);
            let imageCount = 0;
            let totalSize = 0;
            try {
                const files = await fsp.readdir(packPath);
                for (const f of files) {
                    if (IMAGE_EXT_REGEX.test(f)) {
                        imageCount++;
                        try {
                            const stat = await fsp.stat(path.join(packPath, f));
                            totalSize += stat.size;
                        } catch { /* ignore */ }
                    }
                }
            } catch { /* ignore */ }
            const generatedFile = path.join(GENERATED_DIR, `${e.name}.txt`);
            let generatedAt = null;
            try {
                const st = await fsp.stat(generatedFile);
                generatedAt = st.mtime.toISOString();
            } catch { /* 未生成 */ }
            packs.push({
                name: e.name,
                imageCount,
                totalSize,
                generatedAt,
                placeholder: `{{${e.name}}}`,
            });
        }
        packs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        return packs;
    } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
    }
}

async function listImagesInPack(packName) {
    const packPath = resolvePackPath(packName);
    if (!packPath) throw new Error('Invalid pack name');
    const imageKey = process.env.Image_Key || 'YOUR_IMAGE_KEY';
    const files = await fsp.readdir(packPath);
    const images = [];
    for (const f of files) {
        if (!IMAGE_EXT_REGEX.test(f)) continue;
        let size = 0;
        let mtime = null;
        try {
            const st = await fsp.stat(path.join(packPath, f));
            size = st.size;
            mtime = st.mtime.toISOString();
        } catch { /* ignore */ }
        images.push({
            name: f,
            size,
            mtime,
            url: `/pw=${imageKey}/images/${encodeURIComponent(packName)}/${encodeURIComponent(f)}`,
        });
    }
    images.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return images;
}

async function createPack(packName) {
    if (!isValidPackName(packName)) throw new Error(`表情包名必须以「${EMOJI_PACK_SUFFIX}」结尾且不含特殊字符`);
    const packPath = resolvePackPath(packName);
    if (!packPath) throw new Error('Invalid pack name');
    try {
        await fsp.mkdir(packPath, { recursive: false });
    } catch (e) {
        if (e.code === 'EEXIST') throw new Error('同名表情包目录已存在');
        throw e;
    }
}

async function deletePack(packName) {
    const packPath = resolvePackPath(packName);
    if (!packPath) throw new Error('Invalid pack name');
    await fsp.rm(packPath, { recursive: true, force: true });
    // 同时删除 generated_lists/XXX表情包.txt
    const generatedFile = path.join(GENERATED_DIR, `${packName}.txt`);
    await fsp.rm(generatedFile, { force: true }).catch(() => {});
}

async function deleteImage(packName, fileName) {
    const packPath = resolvePackPath(packName);
    if (!packPath) throw new Error('Invalid pack name');
    if (!isValidFileName(fileName)) throw new Error('Invalid file name');
    const filePath = path.resolve(packPath, fileName);
    if (!filePath.startsWith(packPath + path.sep)) throw new Error('Path traversal blocked');
    await fsp.rm(filePath, { force: true });
}

function regenerateLists() {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(PLUGIN_DIR, 'emoji-list-generator.js');
        const child = spawn(process.execPath, [scriptPath], {
            env: { ...process.env, PROJECT_BASE_PATH: VCP_ROOT },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', c => { stdout += c.toString(); });
        child.stderr.on('data', c => { stderr += c.toString(); });
        child.on('exit', code => {
            try {
                const result = JSON.parse(stdout);
                resolve({ code, stderr, ...result });
            } catch {
                resolve({ code, stdout, stderr, status: code === 0 ? 'success' : 'error' });
            }
        });
        child.on('error', reject);
    });
}

const router = express.Router();

// multipart 简易解析：只接受 image/* 且小于 5MB
// 为避免引入 multer 依赖，用原生 busboy-lite 实现
router.post('/packs/:name/upload', express.raw({
    type: (req) => (req.headers['content-type'] || '').startsWith('multipart/form-data'),
    limit: '20mb',
}), async (req, res) => {
    try {
        const packName = decodeURIComponent(req.params.name);
        const packPath = resolvePackPath(packName);
        if (!packPath) return res.status(400).json({ success: false, error: 'Invalid pack name' });
        try { await fsp.mkdir(packPath, { recursive: true }); } catch { /* ignore */ }

        // 解析 multipart 边界
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!boundaryMatch) return res.status(400).json({ success: false, error: 'No boundary' });
        const boundary = boundaryMatch[1] || boundaryMatch[2];

        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
            return res.status(400).json({ success: false, error: 'Empty body' });
        }

        // 手写简易 multipart 解析
        const parts = parseMultipart(body, boundary);
        const uploaded = [];
        const errors = [];
        for (const part of parts) {
            if (!part.filename) continue;
            if (!isValidFileName(part.filename)) {
                errors.push({ file: part.filename, reason: '文件名非法或非图片格式' });
                continue;
            }
            if (part.data.length > 5 * 1024 * 1024) {
                errors.push({ file: part.filename, reason: '超过 5MB 限制' });
                continue;
            }
            const target = path.join(packPath, part.filename);
            await fsp.writeFile(target, part.data);
            uploaded.push({ name: part.filename, size: part.data.length });
        }
        res.json({ success: true, uploaded, errors });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

function parseMultipart(buffer, boundary) {
    const parts = [];
    const boundaryBuf = Buffer.from(`--${boundary}`);
    const crlf = Buffer.from('\r\n');
    let idx = 0;
    while (idx < buffer.length) {
        const start = buffer.indexOf(boundaryBuf, idx);
        if (start < 0) break;
        const nextStart = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
        if (nextStart < 0) break;
        const partRaw = buffer.slice(start + boundaryBuf.length, nextStart);
        const headerEnd = partRaw.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd < 0) { idx = nextStart; continue; }
        const headerText = partRaw.slice(0, headerEnd).toString('utf-8');
        let data = partRaw.slice(headerEnd + 4);
        // 去掉尾部的 \r\n
        if (data.length >= 2 && data.slice(-2).equals(crlf)) data = data.slice(0, -2);
        // 解析 Content-Disposition
        const filenameMatch = headerText.match(/filename=(?:"([^"]*)"|([^;\r\n]+))/i);
        const nameMatch = headerText.match(/\bname=(?:"([^"]*)"|([^;\r\n]+))/i);
        if (filenameMatch) {
            parts.push({
                name: nameMatch ? (nameMatch[1] || nameMatch[2]) : '',
                filename: filenameMatch[1] || filenameMatch[2],
                data,
            });
        }
        idx = nextStart;
    }
    return parts;
}

router.use(express.json({ limit: '100kb' }));

router.get('/packs', async (req, res) => {
    try {
        const packs = await listPacks();
        res.json({ success: true, packs, imageKeyConfigured: !!(process.env.Image_Key && !process.env.Image_Key.startsWith('YOUR_')) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/packs/:name/images', async (req, res) => {
    try {
        const packName = decodeURIComponent(req.params.name);
        const images = await listImagesInPack(packName);
        res.json({ success: true, packName, images });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post('/packs', async (req, res) => {
    try {
        const { name } = req.body || {};
        await createPack(name);
        res.json({ success: true, name });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/packs/:name', async (req, res) => {
    try {
        const packName = decodeURIComponent(req.params.name);
        await deletePack(packName);
        res.json({ success: true, name: packName });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/packs/:name/images/:file', async (req, res) => {
    try {
        const packName = decodeURIComponent(req.params.name);
        const fileName = decodeURIComponent(req.params.file);
        await deleteImage(packName, fileName);
        res.json({ success: true, name: fileName });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post('/regenerate', async (req, res) => {
    try {
        const result = await regenerateLists();
        res.json({ success: true, result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/generated/:name', async (req, res) => {
    try {
        const packName = decodeURIComponent(req.params.name);
        if (!isValidPackName(packName)) return res.status(400).json({ success: false, error: 'Invalid pack name' });
        const file = path.join(GENERATED_DIR, `${packName}.txt`);
        const content = await fsp.readFile(file, 'utf-8').catch(() => '');
        res.json({ success: true, content });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
