# Plugin/

插件目录，manifest 驱动，支持 Node/Python/Rust 多运行时。

## 插件机制

- **契约文件**：`plugin-manifest.json`（启用） / `plugin-manifest.json.block`（禁用）
- **六种类型**：`static`, `messagePreprocessor`, `synchronous`, `asynchronous`, `service`, `hybridservice`
- **通信协议**：`stdio`（进程 stdin/stdout JSON）、`direct`（require JS 模块）、`distributed`（WebSocket 远程）
- **配置级联**：全局 `config.env` → 插件目录 `config.env` → manifest schema 默认值
- **命名规范**：PascalCase 目录名

## 关键 manifest 字段

```json
{
  "name": "插件标识",
  "pluginType": "synchronous",
  "entryPoint": { "type": "nodejs", "command": "node xxx.js" },
  "communication": { "protocol": "stdio", "timeout": 60000 },
  "capabilities": { "systemPromptPlaceholders": [...] }
}
```

## 高复杂度插件

| 插件 | 规模 | 说明 |
|------|------|------|
| `DailyHot/` | 71 文件 | 56+ 热点源聚合器 |
| `RAGDiaryPlugin/` | 4,652 行 | 语义分组、向量管理、元思考 |
| `LinuxShellExecutor/` | 3,000 行 | 安全关键，13+ 验证器，SSH 管理 |
| `ComfyUIGen/` | 18 文件 | JS+Python 双语言工作流 |
| `PaperReader/` | 11 文件 | chunker, ingest, deep-reader 管线 |

## 禁止

- 不要在 manifest 中硬编码密钥
- 不要假设所有插件都是 Node.js
- 不要直接去掉 `.block` 启用插件而不验证依赖
- 不要随意更改 `entryPoint` 格式
