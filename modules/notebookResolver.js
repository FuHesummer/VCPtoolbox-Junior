/**
 * notebookResolver.js
 * Resolves notebook/diary names to actual file paths using agent_map.json mappings.
 *
 * agent_map.json 支持两种格式（同一份文件可混用）：
 *   1) 新格式：{ "AgentName": { "prompt": "...", "notebooks": { "笔记本名": "diary" | "knowledge" | "thinking/xxx" } } }
 *   2) 旧格式：{ "AgentName": "AgentName/AgentName.txt" }
 *      —— 此时自动扫描 Agent/<AgentName>/ 下的物理子目录（diary / knowledge / thinking*），
 *         注册为 { "<AgentName>/<subdir>": "<subdir>" } 形态的 notebooks。
 *
 * Resolution rules:
 *   - value contains "/" → relative to VCP_ROOT (e.g. "thinking/前思维簇")
 *   - value is simple name  → relative to Agent/<agentName>/ (e.g. "diary" → Agent/Aemeath/diary)
 *   - no mapping found       → falls back to dailyNoteRootPath/<name>
 */
const fs = require('fs');
const path = require('path');

const VCP_ROOT = process.env.VCP_ROOT || path.join(__dirname, '..');
const AGENT_MAP_PATH = path.join(VCP_ROOT, 'agent_map.json');
const AGENT_DIR = path.join(VCP_ROOT, 'Agent');

let notebookMap = null;
// displayName → { path, agent, type } for admin panel
let notebookEntries = null;

/**
 * Load and build the notebook name → absolute path mapping
 */
// 旧格式自动识别的标准子目录名
const LEGACY_SUBDIRS = ['diary', 'knowledge'];

/**
 * 旧格式兜底：扫描 Agent/<agentName>/ 下的物理子目录，
 * 返回 { notebookName: subdir } 形式的 notebooks 对象。
 * 约定：diary / knowledge / thinking* 子目录会被自动识别。
 */
function scanLegacyAgentNotebooks(agentName) {
    const notebooks = {};
    const agentSubDir = path.join(AGENT_DIR, agentName);
    let items;
    try {
        items = fs.readdirSync(agentSubDir, { withFileTypes: true });
    } catch {
        return notebooks; // Agent/<agentName>/ 不存在
    }
    for (const item of items) {
        if (!item.isDirectory()) continue;
        const subdir = item.name;
        if (LEGACY_SUBDIRS.includes(subdir) || subdir.startsWith('thinking')) {
            // notebookName 直接用 "<agentName>/<subdir>"，保持与 displayName 一致
            notebooks[`${agentName}/${subdir}`] = subdir;
        }
    }
    return notebooks;
}

function loadNotebookMap() {
    const map = {};
    const entries = {};
    try {
        const data = JSON.parse(fs.readFileSync(AGENT_MAP_PATH, 'utf8'));
        for (const [agentName, config] of Object.entries(data)) {
            let notebooks = null;
            if (config && typeof config === 'object' && config.notebooks) {
                // 新格式：显式声明
                notebooks = config.notebooks;
            } else if (typeof config === 'string') {
                // 旧格式：自动扫描 Agent/<agentName>/ 下的物理子目录
                notebooks = scanLegacyAgentNotebooks(agentName);
            }
            if (!notebooks || Object.keys(notebooks).length === 0) continue;

            // Track unique paths per agent to build display entries
            const seenPaths = new Set();
            for (const [notebookName, subdir] of Object.entries(notebooks)) {
                let fullPath;
                if (subdir.includes('/')) {
                    fullPath = path.join(VCP_ROOT, subdir);
                } else {
                    fullPath = path.join(AGENT_DIR, agentName, subdir);
                }
                map[notebookName] = fullPath;

                // Build unique entries for admin listing (one per physical directory)
                if (!seenPaths.has(fullPath)) {
                    seenPaths.add(fullPath);
                    const type = subdir.includes('knowledge') ? 'knowledge'
                        : subdir.startsWith('thinking') ? 'thinking' : 'diary';
                    entries[fullPath] = {
                        path: fullPath,
                        agent: agentName,
                        type,
                        // Display label for admin panel
                        displayName: subdir.includes('/')
                            ? subdir // e.g. "thinking/前思维簇"
                            : `${agentName}/${subdir}`, // e.g. "Aemeath/diary"
                    };
                }
            }
        }
    } catch (e) {
        // agent_map.json missing or malformed
    }
    notebookMap = map;
    notebookEntries = entries;
    return map;
}

/**
 * Resolve a notebook/diary name to an absolute directory path.
 * @param {string} notebookName - e.g. "爱弥斯", "Nova日记本", "前思维簇"
 * @param {string} [fallbackRoot] - fallback root dir (usually knowledge/)
 * @returns {string} absolute path to the notebook directory
 */
function resolveNotebookPath(notebookName, fallbackRoot) {
    if (!notebookMap) loadNotebookMap();
    if (notebookMap[notebookName]) return notebookMap[notebookName];
    return fallbackRoot ? path.join(fallbackRoot, notebookName) : path.join(VCP_ROOT, 'knowledge', notebookName);
}

/**
 * Get all unique notebook directories for admin panel listing.
 * Returns array of { path, agent, type, displayName }
 */
function getNotebookEntries() {
    if (!notebookEntries) loadNotebookMap();
    return Object.values(notebookEntries || {});
}

/**
 * Get all Agent diary/knowledge directories for KnowledgeBaseManager scanning
 * @returns {string[]} array of absolute paths
 */
function getAgentKnowledgePaths() {
    if (!notebookEntries) loadNotebookMap();
    return Object.keys(notebookEntries || {}).filter(p => fs.existsSync(p));
}

/**
 * Ensure all mapped notebook directories exist on disk.
 * Call on startup to auto-generate the Agent directory structure.
 */
function ensureDirectories() {
    if (!notebookEntries) loadNotebookMap();
    for (const fullPath of Object.keys(notebookEntries || {})) {
        try {
            fs.mkdirSync(fullPath, { recursive: true });
        } catch {}
    }
}

/** Force reload (call when agent_map.json changes) */
function reload() {
    notebookMap = null;
    notebookEntries = null;
}

module.exports = { resolveNotebookPath, getNotebookEntries, getAgentKnowledgePaths, ensureDirectories, reload, loadNotebookMap };
