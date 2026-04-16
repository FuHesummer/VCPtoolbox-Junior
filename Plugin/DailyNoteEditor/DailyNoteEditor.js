// DailyNoteEditor — AI 日记编辑工具
// stdio 子进程，接收 JSON 指令执行单条日记文件的编辑/替换/删除

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// VCP 根目录：插件位于 Plugin/DailyNoteEditor/，向上两级是 VCP 根
const VCP_ROOT = process.env.VCP_ROOT || path.resolve(__dirname, '..', '..');

// 路径校验：不允许路径穿越 + 必须在 VCP 根下的合法子目录（knowledge/ 或 Agent/）
function resolveNotePath(folder, filename) {
    if (!folder || !filename) {
        throw new Error('Missing folder or filename');
    }
    if (/[\\/]/.test(filename) || filename.includes('..')) {
        throw new Error('Invalid filename (no path separators or .. allowed)');
    }
    const normFolder = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (normFolder.includes('..')) {
        throw new Error('Invalid folder (no .. allowed)');
    }
    // 允许的根前缀：knowledge/ , Agent/ , thinking/
    const firstSeg = normFolder.split('/')[0];
    if (!['knowledge', 'Agent', 'thinking'].includes(firstSeg)) {
        throw new Error(`Folder must be under knowledge/ , Agent/ or thinking/ (got ${firstSeg})`);
    }
    const full = path.resolve(VCP_ROOT, normFolder, filename);
    const vcpRootResolved = path.resolve(VCP_ROOT);
    if (!full.startsWith(vcpRootResolved + path.sep)) {
        throw new Error('Path traversal detected');
    }
    return full;
}

async function editDailyNote({ folder, filename, content }) {
    if (typeof content !== 'string') return { success: false, error: 'content must be a string' };
    const full = resolveNotePath(folder, filename);
    const dir = path.dirname(full);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
    return { success: true, message: `Note written: ${path.relative(VCP_ROOT, full)} (${Buffer.byteLength(content)} bytes)` };
}

async function findReplaceInNote({ folder, filename, targetText, replacementText }) {
    if (!targetText || typeof targetText !== 'string') return { success: false, error: 'targetText missing' };
    if (typeof replacementText !== 'string') return { success: false, error: 'replacementText must be a string' };
    if (targetText.length < 10) return { success: false, error: 'targetText must be at least 10 characters (safety)' };
    const full = resolveNotePath(folder, filename);
    if (!fsSync.existsSync(full)) return { success: false, error: `File not found: ${path.relative(VCP_ROOT, full)}` };

    const original = await fs.readFile(full, 'utf-8');
    if (!original.includes(targetText)) {
        return { success: false, error: 'targetText not found in file' };
    }
    const occurrences = original.split(targetText).length - 1;
    const updated = original.replace(targetText, replacementText);
    await fs.writeFile(full, updated, 'utf-8');
    return {
        success: true,
        message: `Replaced ${occurrences > 1 ? 'first of ' + occurrences + ' occurrences' : '1 occurrence'} in ${path.relative(VCP_ROOT, full)}`,
    };
}

async function deleteDailyNote({ folder, filename }) {
    const full = resolveNotePath(folder, filename);
    if (!fsSync.existsSync(full)) return { success: false, error: `File not found: ${path.relative(VCP_ROOT, full)}` };
    const size = (await fs.stat(full)).size;
    await fs.unlink(full);
    return { success: true, message: `Deleted ${path.relative(VCP_ROOT, full)} (${size} bytes)` };
}

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
    });
}

async function main() {
    try {
        const input = await readStdin();
        const request = JSON.parse(input);
        const { command, ...params } = request;

        let result;
        switch (command) {
            case 'EditDailyNote':
                result = await editDailyNote(params);
                break;
            case 'FindReplaceInNote':
                result = await findReplaceInNote(params);
                break;
            case 'DeleteDailyNote':
                result = await deleteDailyNote(params);
                break;
            default:
                result = { success: false, error: `Unknown command: ${command}` };
        }

        console.log(JSON.stringify({
            status: result.success ? 'success' : 'error',
            result: result.message || result.error,
        }));
    } catch (err) {
        console.log(JSON.stringify({ status: 'error', error: err.message }));
        process.exit(1);
    }
}

main();
