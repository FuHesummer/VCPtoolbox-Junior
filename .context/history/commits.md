# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-04-14 | `019d89fc` | `5dc10f1` | fix: 移除 Plugin.js 与 maintain.js spawn 的 DEP0190 废弃警告 | Plugin.js spawn DEP0190 修复方式 | 启动日志打印 Node DEP0190 DeprecationWarning（args+shell:true 组合已废弃… | 命令字符串如被攻击者控制仍可 RCE，但 manifest 本就能指定命令（非新增风险） |
| 2026-04-14 | `019d89fc` | `76c045a` | feat(notebook): agent_map 旧格式自动扫描 Agent/<name>/ 物理子目录 | notebookResolver 旧格式兜底策略 | AdminPanel 笔记管理 diary 模式显示暂无 Agent 日记目录，即使物理目录存在 | 约定大于配置让 Agent/ 下意外子目录可能被误识别，已加白名单 diary/knowledge/think… |
| 2026-04-14 | `019d89fc` | `418688d` | fix(adminpanel): 笔记文件夹多级路径 encode + 404 显示暂无日记 | apiFetch 新增 suppressErrorToast + error.status | 点击 Aemeath/diary 文件夹前端显示加载日记失败 | 调用方遗忘设置仍走默认 toast（向后兼容） |
| 2026-04-14 | `019d89fc` | `0baee31` | feat(plugin-store): 插件间依赖 requires 协议 + 商店连锁安装弹窗 | 插件间依赖 requires 协议设计 | — | notFound 阻塞安装，需仓库维护者保证依赖都在同仓库 |
| 2026-04-14 | `019d89fc` | `1a58d9d` | fix: 统一 rag_params.json 权威路径到 modules/ 删除根目录冗余 | rag_params 权威路径统一到 modules/ | ContextFoldingV2 从未读到真实热参数，AdminPanel 改参数对它无感; HEAD 里根目录 rag… | 历史写过根目录 rag_params.json 的分支合并时会产生冲突 |
| 2026-04-14 | `019d89fc` | `845699f` | docs: 完善插件协议与项目结构文档 | 插件仓库 README 补三协议（依赖/配置/迁移/requires/UI 扩展）; README/CLAUDE.md 项目结构修正 | — | 两份文档同步维护成本 |
| 2026-04-14 | `019d8abf` | `529704b` | feat(panel): AdminPanel Vue 3 + TS 全量重构 | 技术栈:Vue 3 Composition + TS strict + Vite 6 + Pinia + Vue Router + Vitest; 工程分层:src/api/ + stores/ + … | Vite dev 访问工具列表编辑器 404; 仪表盘 5s 轮询触发全局 spinner; /admin_api/pl… | 牺牲零构建原则 |
| 2026-04-14 | `019d8ac0` | `04db922` | chore(config): 规范化 config.env.example 结构 + 同步脚本 | config.env.example 每个字段加紧邻作用注释 + 统一段分隔符; 独立 scripts/sync-env-structure.js 脚本 | 第 354-355 行孤儿数据污染 parser | 旧版 521 行精简为 375 行 |
| 2026-04-14 | `019d8ac0` | `d059f24` | feat(backend): 插件商店 UI 扩展字段 + Agent 头像 API | pluginStore listRemote 保留 dashboardCards + adminNav; Agent 头像 API:base64 via JSON,无 multer 依赖 | — | manifest 有声明时字段保留,undefined 时 JSON.stringify 自动移除 |
| 2026-04-14 | `019d8ac1` | `76654ef` | chore(scripts): AdminPanel-Vue 源码同步脚本 | sync-panel.js 镜像 AdminPanel-Vue 源码到 Panel 仓库 | — | 排除 node_modules/dist/.vite/coverage/*.log/.env.local |
