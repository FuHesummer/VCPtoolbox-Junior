// modules/migration/webdav.js
// 轻量级 WebDAV 客户端（针对坚果云 / nextcloud 等）
// 只依赖 axios（已装）—— 手写 PROPFIND XML 解析（坚果云的 response 结构简单）
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const axios = require('axios');
const { PROJECT_ROOT } = require('./utils');

const DEFAULT_URL = 'https://dav.jianguoyun.com/dav/';
const DEFAULT_PATH = '/VCP备份';

function getConfig() {
    return {
        url: (process.env.JianguoyunDEVUrl || DEFAULT_URL).trim(),
        user: (process.env.JianguoyunDEVUser || '').trim(),
        password: (process.env.JianguoyunDEVPW || '').trim(),
        basePath: (process.env.JianguoyunPath || DEFAULT_PATH).trim(),
        enabled: (process.env.JianguoyunDEV || 'false').toLowerCase() === 'true',
    };
}

function buildUrl(config, extra = '') {
    const base = config.url.replace(/\/+$/, '');
    const p = (config.basePath || '').replace(/^\/*|\/*$/g, '');
    const e = extra.replace(/^\/+/, '');
    return `${base}/${p}${e ? '/' + e : ''}`.replace(/([^:]\/)\/+/g, '$1');
}

function authHeaders(config) {
    if (!config.user || !config.password) return {};
    const token = Buffer.from(`${config.user}:${config.password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
}

// 测试连接：PROPFIND 根路径
async function testConnection() {
    const config = getConfig();
    if (!config.user || !config.password) {
        return { ok: false, error: '坚果云账号/密码未配置（JianguoyunDEVUser/JianguoyunDEVPW）' };
    }
    try {
        const url = buildUrl(config);
        const res = await axios.request({
            url,
            method: 'PROPFIND',
            headers: { ...authHeaders(config), Depth: '0' },
            timeout: 15000,
            validateStatus: () => true,
        });
        if (res.status === 207 || res.status === 200) {
            return { ok: true, statusCode: res.status, url };
        }
        if (res.status === 404) {
            // 目录不存在 —— 尝试创建
            const mkRes = await mkcol();
            if (mkRes.ok) return { ok: true, statusCode: 201, url, created: true };
            return { ok: false, error: `远程目录不存在且创建失败（${mkRes.error}）`, statusCode: res.status };
        }
        return { ok: false, error: `HTTP ${res.status}: ${(res.data || '').toString().slice(0, 200)}` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// 创建远程目录（坚果云需要目录存在才能 PUT）
async function mkcol() {
    const config = getConfig();
    try {
        const url = buildUrl(config);
        const res = await axios.request({
            url,
            method: 'MKCOL',
            headers: authHeaders(config),
            timeout: 15000,
            validateStatus: () => true,
        });
        if (res.status === 201 || res.status === 405) {
            return { ok: true, statusCode: res.status, note: res.status === 405 ? 'already exists' : 'created' };
        }
        return { ok: false, statusCode: res.status, error: (res.data || '').toString().slice(0, 200) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// 列出远程目录的 zip 文件
async function list() {
    const config = getConfig();
    if (!config.user || !config.password) {
        throw new Error('坚果云未配置');
    }
    const url = buildUrl(config);
    const res = await axios.request({
        url,
        method: 'PROPFIND',
        headers: { ...authHeaders(config), Depth: '1' },
        timeout: 20000,
        responseType: 'text',
        validateStatus: () => true,
    });
    if (res.status !== 207 && res.status !== 200) {
        throw new Error(`list failed HTTP ${res.status}`);
    }
    const text = typeof res.data === 'string' ? res.data : res.data.toString();
    return parseWebdavListing(text, url);
}

// 极简 XML 解析：坚果云返回 <d:response> 结构
function parseWebdavListing(xml, selfUrl) {
    const items = [];
    const responseRegex = /<d:response[^>]*>([\s\S]*?)<\/d:response>/gi;
    let m;
    while ((m = responseRegex.exec(xml)) !== null) {
        const block = m[1];
        const hrefMatch = block.match(/<d:href[^>]*>([^<]*)<\/d:href>/i);
        if (!hrefMatch) continue;
        const href = decodeURIComponent(hrefMatch[1].trim());
        // 跳过 self（目录本身）
        try {
            const selfUri = new URL(selfUrl);
            const myPath = selfUri.pathname.replace(/\/+$/, '');
            const itemPath = new URL(href, selfUri).pathname.replace(/\/+$/, '');
            if (itemPath === myPath) continue;
        } catch {}

        const filename = path.basename(href.replace(/\/+$/, ''));
        if (!filename) continue;

        const lenMatch = block.match(/<d:getcontentlength[^>]*>(\d+)<\/d:getcontentlength>/i);
        const modMatch = block.match(/<d:getlastmodified[^>]*>([^<]+)<\/d:getlastmodified>/i);
        const isDirMatch = /<d:resourcetype>[\s\S]*?<d:collection/i.test(block);

        items.push({
            filename,
            href,
            isDirectory: isDirMatch,
            size: lenMatch ? parseInt(lenMatch[1], 10) : 0,
            lastModified: modMatch ? modMatch[1].trim() : null,
        });
    }
    return items.filter(it => !it.isDirectory && /\.zip$/i.test(it.filename))
        .sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
}

// 上传本地文件到远程
async function upload(localPath, remoteName, onProgress) {
    const config = getConfig();
    if (!config.user || !config.password) throw new Error('坚果云未配置');
    if (!fs.existsSync(localPath)) throw new Error(`local file not found: ${localPath}`);

    const target = buildUrl(config, remoteName);
    const st = await fsp.stat(localPath);
    const stream = fs.createReadStream(localPath);

    if (typeof onProgress === 'function') {
        let sent = 0;
        stream.on('data', chunk => {
            sent += chunk.length;
            onProgress({ sent, total: st.size, pct: sent / st.size });
        });
    }

    const res = await axios.request({
        url: target,
        method: 'PUT',
        headers: {
            ...authHeaders(config),
            'Content-Type': 'application/zip',
            'Content-Length': st.size,
        },
        data: stream,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600000,
        validateStatus: () => true,
    });
    if (![200, 201, 204].includes(res.status)) {
        throw new Error(`upload failed HTTP ${res.status}: ${(res.data || '').toString().slice(0, 200)}`);
    }
    return { ok: true, remoteName, size: st.size, statusCode: res.status };
}

// 下载远程文件到本地
async function download(remoteName, localPath, onProgress) {
    const config = getConfig();
    if (!config.user || !config.password) throw new Error('坚果云未配置');

    const url = buildUrl(config, remoteName);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    const res = await axios.request({
        url,
        method: 'GET',
        headers: authHeaders(config),
        responseType: 'stream',
        timeout: 600000,
        validateStatus: () => true,
    });
    if (res.status !== 200) {
        throw new Error(`download failed HTTP ${res.status}`);
    }
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let received = 0;

    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(localPath);
        res.data.on('data', chunk => {
            received += chunk.length;
            if (typeof onProgress === 'function') {
                onProgress({ received, total, pct: total > 0 ? received / total : 0 });
            }
        });
        res.data.on('error', reject);
        out.on('error', reject);
        out.on('close', resolve);
        res.data.pipe(out);
    });

    const st = await fsp.stat(localPath);
    return { ok: true, localPath, size: st.size };
}

// 删除远程文件
async function remove(remoteName) {
    const config = getConfig();
    if (!config.user || !config.password) throw new Error('坚果云未配置');
    const url = buildUrl(config, remoteName);
    const res = await axios.request({
        url,
        method: 'DELETE',
        headers: authHeaders(config),
        timeout: 15000,
        validateStatus: () => true,
    });
    return { ok: res.status === 204 || res.status === 200, statusCode: res.status };
}

module.exports = {
    getConfig,
    testConnection,
    mkcol,
    list,
    upload,
    download,
    remove,
};
