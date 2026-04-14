# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-04-14 | `019d89fc` | `5dc10f1` | fix: 移除 Plugin.js 与 maintain.js spawn 的 DEP0190 废弃警告 | Plugin.js spawn DEP0190 修复方式 | 启动日志打印 Node DEP0190 DeprecationWarning（a… | 命令字符串如被攻击者控制仍可 RCE，但 manifest 本就能指定命令（非新增风险） |
| 2026-04-14 | `019d89fc` | `76c045a` | feat(notebook): agent_map 旧格式自动扫描 Agent/<name>/ 物理子目录 | notebookResolver 旧格式兜底策略 | AdminPanel 笔记管理 diary 模式显示暂无 Agent 日记目录，… | 约定大于配置让 Agent/ 下意外子目录可能被误识别，已加白名单 diary/knowledge/thinking* |
| 2026-04-14 | `019d89fc` | `418688d` | fix(adminpanel): 笔记文件夹多级路径 encode + 404 显示暂无日记 | apiFetch 新增 suppressErrorToast + error.status | 点击 Aemeath/diary 文件夹前端显示加载日记失败 | 调用方遗忘设置仍走默认 toast（向后兼容） |
| 2026-04-14 | `019d89fc` | `0baee31` | feat(plugin-store): 插件间依赖 requires 协议 + 商店连锁安装弹窗 | 插件间依赖 requires 协议设计 | — | notFound 阻塞安装，需仓库维护者保证依赖都在同仓库 |
| 2026-04-14 | `019d89fc` | `1a58d9d` | fix: 统一 rag_params.json 权威路径到 modules/ 删除根目录冗余 | rag_params 权威路径统一到 modules/ | ContextFoldingV2 从未读到真实热参数，AdminPanel 改参…; HEAD 里根目录 rag_params.json 内容居然是 agent_ma… | 历史写过根目录 rag_params.json 的分支合并时会产生冲突 |
| 2026-04-14 | `019d89fc` | `845699f` | docs: 完善插件协议与项目结构文档 | 插件仓库 README 补三协议（依赖/配置/迁移/requires/UI 扩展）; README/CLAUDE.md 项目结构修正 | — | 两份文档同步维护成本 |
