# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-04-14 | 019d89fc | 5dc10f1 | fix: 移除 Plugin.js 与 maintain.js spawn 的 DEP0190 废弃警告 | 1 | 1 | med |
| 2026-04-14 | 019d89fc | 76c045a | feat(notebook): agent_map 旧格式自动扫描 Agent/<name>/ 物理子目录 | 1 | 1 | med |
| 2026-04-14 | 019d89fc | 418688d | fix(adminpanel): 笔记文件夹多级路径 encode + 404 显示暂无日记 | 1 | 1 | med |
| 2026-04-14 | 019d89fc | 0baee31 | feat(plugin-store): 插件间依赖 requires 协议 + 商店连锁安装弹窗 | 1 | 0 | low |
| 2026-04-14 | 019d89fc | 1a58d9d | fix: 统一 rag_params.json 权威路径到 modules/ 删除根目录冗余 | 1 | 2 | med |
| 2026-04-14 | 019d89fc | 845699f | docs: 完善插件协议与项目结构文档 | 2 | 0 | low |
| 2026-04-14 | 019d8abf | — | feat(panel): AdminPanel Vue 3 + TS 全量重构 | 7 | 9 | high |
| 2026-04-14 | 019d8ac0 | — | chore(config): 规范化 config.env.example 结构 + 同步脚本 | 2 | 1 | med |
| 2026-04-14 | 019d8ac0 | — | feat(backend): 插件商店 UI 扩展字段 + Agent 头像 API | 2 | 0 | low |
| 2026-04-14 | 019d8ac1 | — | chore(scripts): AdminPanel-Vue 源码同步脚本 | 1 | 0 | low |
| 2026-04-14 | e3a38d35 | — | feat(panel): AdminPanel Vue 多页面表单化重构 + 数据/UI/协议 bug 修复 | 11 | 14 | high |
| 2026-04-14 | 019d8ba0 | — | feat(panel): Toolbox/TVS/Notes/NewAPI 深度重构 + 后端多维聚合 | 12 | 6 | high |
| 2026-04-14 | 019d8c20 | PENDING | feat(plugin-protocol): 插件 admin 协议 v2.0 + 4 大页面深度增强 + FoldingStore 修复 | 5 | 1 | high |
| 2026-04-14 | 019d8c98 | — | feat(plugin-protocol): TVS 工具指南协议 v2.1（tvsVariables，move 策略） | 5 | 1 | high |
| 2026-04-15 | 019d8fec | — | fix(plugin-protocol): PluginNavView 组件缓存 + TVS 协议保留种子 + 白名单隔离云插件 | 4 | 3 | high |
| 2026-04-15 | 019d94e1 | f6765a1 | feat(arch): 解耦面板仓库 + ADMIN_PANEL_SOURCE 生态化 + 3 新页面 | 5 | 2 | high |
| 2026-04-15 | 019d94e2 | 1ca19e4 | feat: 插件面板迭代（可视化编辑器 + dashboardCards + 三件套修复） | 3 | 1 | med |
| 2026-04-15 | 019d94e3 | 93d59b8 | feat(views): 模型提示词页面（SarModel/SarPrompt 可视化） | 2 | 0 | low |
| 2026-04-16 | 019d019d | cdfdf6b | feat(arch): 论坛解耦 + envContributions 协议 + 上游 VCPToolBox 一键迁移 | 5 | 1 | high |
| 2026-04-16 | 019d019d | 8bf93cb | feat(views): 上游迁移向导 + PromptEditor 智能化 + 配置/变量编辑器重构 | 6 | 2 | high |
| 2026-04-16 | 019d019d | 77f8314 | feat(VCPForum): 完全解耦本体（admin-router + native panel + envContributions） | 3 | 1 | med |
| 2026-04-16 | 019d95c1 | a893642 | ✨ feat(plugin): 4 个记忆系统新核心（9→13）+ TimelineOrganizer + 3 AI 工具插件 | 6 | 0 | med |
| 2026-04-16 | 019d95e2 | 1ee21f8 | 🐛 fix(plugin-protocol): install 方向热加载闭环 + _registerSinglePlugin 对称实现 | 5 | 1 | high |
| 2026-04-16 | 019d9639 | c7a743c | ✨ feat(arch): 占位符识别闭环 + 15 核心 + 时序/解析双 bug + Agent 预设清理 | 6 | 3 | high |
| 2026-04-16 | 019d964f | e4b73cf | ✨ feat(config): FileOperator 配置迁入全局 + 使用指南注释 | 3 | 0 | low |
| 2026-04-16 | 019d9652 | df991b2 | ✨ feat(plugin): FileOperator 加入内置核心（15→16）+ 配置迁全局 + 使用指南 | 3 | 0 | med |
| 2026-04-16 | 019d9660 | cfd9d4b | 👷 ci(release): 5 平台 + ARM64 + Docker 多架构 + Rust 缓存 + placeholder smoke | 6 | 0 | high |
| 2026-04-16 | 019d967d | 85828ad | 🐛 fix(lifecycle+arch): 孤儿进程清理 + 打包守 16 核心边界 | 3 | 2 | high |
| 2026-04-16 | 019d96a5 | e0f13a7 | 👷 ci: v2-beta.1 打包迭代修复（matrix/Docker/shell/adminServer 根因/Release latest）— 聚合 7 commit | 5 | 3 | high |
| 2026-04-16 | 019d96ba | PENDING | fix(adminServer): Express 5 path-to-regexp + 挂载顺序 + CI 放开下载 | 3 | 1 | high |
| 2026-04-18 | 019da151 | PENDING | 🔧 chore(admin): adminServer localModules 数组补齐 3 个名字 | 1 | 0 | low |
