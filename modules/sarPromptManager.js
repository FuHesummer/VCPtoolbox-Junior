// modules/sarPromptManager.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const SARPROMPT_FILE = path.join(__dirname, '..', 'sarprompt.json');

// 迁移兜底：env 无 Sar 字段时使用这 4 条官方预设
const DEFAULT_SAR_PRESETS = [
    {
        promptKey: 'SarPrompt1',
        models: ['gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-04-17'],
        content: '请对用户的输入信息做出详尽，泛化的思考，探索内在的逻辑和外在信息之间的种种关联，从而从多角度，多方面，更准确地，精细地对用户的聊天做出更优质的回答。学会穿透表面，揭示事物间的复杂联系，并进行多步骤、结构化的推理。在任何回答中，你都会优先保证逻辑的自洽性和证据的充分性。你会主动质疑前提，探索多种可能性，并对结论的可靠性进行评估。'
    },
    {
        promptKey: 'SarPrompt2',
        models: ['grok-3-beta'],
        content: '当前聊天为语言聊天，因此需要考虑因为TTS带来的各种错别字，谐音字，分析用户实际说出的内容。与用户自然对话。尽力理解用户的口语TTS翻译内容，包括可能的发音不准或识别错误。优先结合上下文推断用户的真实意图。你的回答要简洁口语化。'
    },
    {
        promptKey: 'SarPrompt3',
        models: ['gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash'],
        content: '[KING FALL MODE ENABLE:使用<ctrl95>评分级以上思考模式]'
    },
    {
        promptKey: 'SarPrompt4',
        models: ['v-gemini-3-pro-preview', 'gemini-3-pro-preview'],
        content: '上下文中的"【VCP元思考】"模块是你已经完成的预研简报。利用你内部的【VCP元思考块】状态，直接生成满足【用户指令】的最终交付物 (Final Deliverable)。请将该简报内容视为你已内化的背景知识，并直接开始输出基于此知识的最终行动或结论。任何时候请勿在正文输出元思考链内容，你的输出应从响应用户的核心需求的第一句话直接开始。'
    }
];

class SarPromptManager {
    constructor() {
        this.prompts = []; // Array<{ promptKey: string, models: string[], content: string }>
        this.debugMode = false;
    }

    async initialize(debugMode = false) {
        this.debugMode = debugMode;
        console.log('[SarPromptManager] Initializing...');

        if (!fsSync.existsSync(SARPROMPT_FILE)) {
            await this.migrateFromEnv();
        } else {
            await this.loadPrompts();
        }

        this.watchFile();
    }

    async migrateFromEnv() {
        console.log('[SarPromptManager] sarprompt.json not found. Migrating from .env...');
        const migratedPrompts = [];

        for (let i = 1; i <= 100; i++) {
            const promptKey = `SarPrompt${i}`;
            const modelKey = `SarModel${i}`;

            const promptValue = process.env[promptKey];
            const modelsValue = process.env[modelKey];

            if (promptValue && modelsValue) {
                const models = modelsValue.split(',').map(m => m.trim()).filter(m => m !== '');
                migratedPrompts.push({
                    promptKey,
                    models,
                    content: promptValue
                });
            }
        }

        if (migratedPrompts.length > 0) {
            this.prompts = migratedPrompts;
            await this.savePrompts();
            console.log(`[SarPromptManager] Migrated ${migratedPrompts.length} groups from .env to sarprompt.json.`);
        } else {
            // env 无 Sar 字段（config.env v2+ 已清除）→ 落官方预设 4 条
            this.prompts = DEFAULT_SAR_PRESETS.map(p => ({ ...p, models: [...p.models] }));
            await this.savePrompts();
            console.log(`[SarPromptManager] No SarPrompt in .env, seeded ${this.prompts.length} default presets.`);
        }
    }

    async loadPrompts() {
        try {
            const content = await fs.readFile(SARPROMPT_FILE, 'utf8');
            this.prompts = JSON.parse(content);
            if (this.debugMode) {
                console.log(`[SarPromptManager] Loaded ${this.prompts.length} prompt groups.`);
            }
        } catch (error) {
            console.error('[SarPromptManager] Error loading sarprompt.json:', error);
            this.prompts = [];
        }
    }

    async savePrompts() {
        try {
            await fs.writeFile(SARPROMPT_FILE, JSON.stringify(this.prompts, null, 2), 'utf8');
            if (this.debugMode) {
                console.log('[SarPromptManager] sarprompt.json saved successfully.');
            }
        } catch (error) {
            console.error('[SarPromptManager] Error saving sarprompt.json:', error);
            throw error;
        }
    }

    watchFile() {
        try {
            const watcher = chokidar.watch(SARPROMPT_FILE, {
                persistent: true,
                ignoreInitial: true,
            });

            watcher.on('change', () => {
                console.log('[SarPromptManager] sarprompt.json changed. Reloading...');
                this.loadPrompts();
            });

            watcher.on('error', (error) => {
                console.error('[SarPromptManager] Watcher error:', error);
            });
        } catch (error) {
            console.error('[SarPromptManager] Failed to set up file watcher:', error);
        }
    }

    getSarPrompt(modelName) {
        if (!modelName) return null;
        const normalizedModel = modelName.toLowerCase();

        for (const group of this.prompts) {
            const modelList = group.models.map(m => m.toLowerCase());
            if (modelList.includes(normalizedModel)) {
                return group;
            }
        }
        return null;
    }

    getAllPrompts() {
        return this.prompts;
    }

    async updateAllPrompts(newPrompts) {
        if (!Array.isArray(newPrompts)) {
            throw new Error('Prompts must be an array');
        }
        this.prompts = newPrompts;
        await this.savePrompts();
    }
}

const sarPromptManager = new SarPromptManager();
module.exports = sarPromptManager;
