const fs = require('fs').promises;
const path = require('path');

/**
 * 从括号序列中解码出真实的验证码
 * @param {string} bracketSequence - 括号序列字符串
 * @returns {string} 解码后的6位数验证码
 */
function decodeFromBrackets(bracketSequence) {
    const bracketTypeMap = {
        '[': 0, ']': 0,
        '{': 1, '}': 1,
        '<': 2, '>': 2,
        '（': 3, '）': 3,
        '《': 4, '》': 4,
        '【': 5, '】': 5
    };

    const counts = [0, 0, 0, 0, 0, 0];

    for (const char of bracketSequence) {
        const typeIndex = bracketTypeMap[char];
        if (typeIndex !== undefined) {
            counts[typeIndex]++;
        }
    }

    return counts.join('');
}

/**
 * 从 code.bin 文件中读取并解码验证码
 * @param {string} filePath - code.bin 文件路径（可选）
 * @returns {Promise<string>} 解码后的验证码
 */
async function getAuthCode(filePath = null) {
    try {
        const codePath = filePath || path.join(__dirname, 'code.bin');
        const base64Encoded = await fs.readFile(codePath, 'utf-8');
        const bracketSequence = Buffer.from(base64Encoded.trim(), 'base64').toString('utf-8');
        const authCode = decodeFromBrackets(bracketSequence);
        return authCode;
    } catch (error) {
        console.error('[CaptchaDecoder] 读取或解码认证码失败:', error.message);
        return '';
    }
}

module.exports = { getAuthCode, decodeFromBrackets };
