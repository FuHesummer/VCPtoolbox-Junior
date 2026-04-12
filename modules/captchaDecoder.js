/**
 * captchaDecoder.js - Auth code decoder stub
 * 原模块用于解密 Plugin/UserAuth/code.bin 中的鉴权码
 */
const fs = require('fs').promises;

async function getAuthCode(filePath) {
    try {
        const data = await fs.readFile(filePath);
        // 简单返回 base64 解码（实际逻辑可能更复杂，后续按需补充）
        return data.toString('utf-8').trim();
    } catch (e) {
        return null;
    }
}

module.exports = { getAuthCode };
