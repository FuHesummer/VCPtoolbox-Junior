# DailyNoteEditor — 日记编辑工具

Junior 本体核心插件。AI 可调用的日记文件精准编辑工具（单条 CRUD）。

## 与 DailyNoteManager 的区别

| 插件 | 定位 |
|------|------|
| DailyNoteManager | **批处理**：融合、整理、去重多条日记 |
| DailyNoteEditor | **精准编辑**：单个日记文件的覆盖写入、查找替换、删除 |

两个插件**互补**，一起构成完整的日记管理工具链。

## 支持的 AI 工具命令

- `EditDailyNote` — 覆盖写入指定日记文件（AI 提供完整内容）
- `FindReplaceInNote` — 查找替换（targetText ≥ 10 字符，避免误伤）
- `DeleteDailyNote` — 删除单条日记（不可逆）

## 路径安全

- 支持的根前缀：`knowledge/` / `Agent/` / `thinking/`
- 禁止路径穿越（`..`）和文件名含路径分隔符
- 通过 `resolveNotePath` 强制校验

## 占位符

通过 invocationCommands 聚合，自动生成 `{{VCPDailyNoteEditor}}` 系统占位符（工具使用指南），可在 Agent 提示词里引用。
