# modules/

所有后端模块，包括业务编排模块和辅助算法模块。

## 业务编排模块

| 文件 | 作用 |
|------|------|
| `chatCompletionHandler.js` | Chat 请求主循环与 handler 调度 |
| `messageProcessor.js` | 多阶段占位符解析（`{{Agent*}}`, `{{Var*}}` 等） |
| `agentManager.js` | `agent_map.json` 读取、缓存、文件监听热更新 |
| `logger.js` | 控制台重定向与日志输出 |
| `roleDivider.js` | role 拆分与过滤 |
| `tvsManager.js` | TVS 文本管理 |
| `toolboxManager.js` | 工具箱管理 |
| `contextManager.js` | 上下文 token 修剪 |
| `toolApprovalManager.js` | 工具审批管理 |

## 辅助算法模块（从根目录移入）

| 文件 | 作用 | 主要被谁引用 |
|------|------|------------|
| `EPAModule.js` | 嵌入投影分析（语义空间定位） | KnowledgeBaseManager |
| `EmbeddingUtils.js` | 向量嵌入批量处理 | KnowledgeBaseManager, toolExecutor |
| `ResidualPyramid.js` | 残差金字塔算法（TagMemo 核心） | KnowledgeBaseManager |
| `ResultDeduplicator.js` | 检索结果 SVD 去重 | KnowledgeBaseManager |
| `TextChunker.js` | 文本分块 | KnowledgeBaseManager |
| `WorkerPool.js` | 并行工作线程池 | KnowledgeBaseManager |

## 服务模块（从根目录移入）

| 文件 | 作用 | 主要被谁引用 |
|------|------|------------|
| `FileFetcherServer.js` | 跨节点文件拉取 | server.js, Plugin.js |
| `modelRedirectHandler.js` | 模型名称重定向 | server.js |
| `vcpInfoHandler.js` | VCP 工具调用信息格式化 | chatCompletionHandler, streamHandler, nonStreamHandler |

## 约定

- CommonJS 导出（`module.exports`），不引入 ESM-only 依赖
- 环境变量解析使用 `try/catch` + 回退默认值
- `DebugMode` 作为日志门控，不要绕过
- Handler 主链路：解析 tool call → 分离 → 执行 → 递归/继续
- 导出风格：handler 类导出，manager 单例导出，工具模块函数对象导出

## 禁止

- 不要在 watcher/缓存链路中静默吞错
- 不要绕开 manager 直接在 `server.js` 复制状态逻辑
