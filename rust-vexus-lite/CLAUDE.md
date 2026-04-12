# rust-vexus-lite/

Rust N-API 向量索引子项目，为主 Node.js 运行时提供高性能向量检索能力。

## 结构

| 文件/目录 | 作用 |
|-----------|------|
| `src/` | Rust 源码 |
| `Cargo.toml` | Rust 依赖与构建配置 |
| `package.json` | 构建脚本（`napi build`） |
| `index.js` | 平台 `.node` 产物加载与导出 |

## 构建

```bash
npm run build          # Release 构建
npm run build:debug    # Debug 构建
```

使用 `@napi-rs/cli` 构建，多平台产物策略。

## 集成点

- 主项目通过 `KnowledgeBaseManager.js` 调用本模块导出的向量操作函数
- 修改 Rust 导出符号时必须同步 `index.js` 和 `KnowledgeBaseManager.js`

## 禁止

- 不要更改 N-API 导出符号名而不更新 JS 调用方
- 不要假设单平台构建
- 不要修改 Rust DB 恢复/查询逻辑而不检查 `KnowledgeBaseManager` 调用路径
