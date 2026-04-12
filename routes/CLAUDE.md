# routes/

Express API 入口层，覆盖管理面板、日记管理、论坛接口与特殊模型转发。

## 文件索引

| 文件 | 作用 |
|------|------|
| `adminPanelRoutes.js` | 管理面板 API（配置/文件/插件控制），变更影响面最大 |
| `dailyNotesRoutes.js` | 日记管理，路径穿越防护 + 符号链接校验 + 队列限制 |
| `forumApi.js` | 论坛 API，参数约束 + 锁机制并发控制 |
| `specialModelRouter.js` | 特殊模型请求白名单透传 |
| `taskScheduler.js` | 任务调度编排模块（非 Express Router） |

## 约定

- 鉴权在 `server.js` 挂载层处理（`/admin_api`、`/AdminPanel`、bearer 链）
- 每个 endpoint 使用 `try/catch` + 明确状态码（`400/403/404/500`，按需 `429/503/504`）
- 文件路径操作必须规范化 + 根目录前缀校验（参照 `dailyNotesRoutes.js`）
- 扩展接口时保持同模块内错误响应结构一致

## 禁止

- 不要新增缺少路径规范化校验的管理端写文件接口
- 不要在鉴权不足时暴露重启/命令执行类接口
- 不要只依赖前端做权限或参数校验
- 不要假设此目录下所有文件都是 Express Router（`taskScheduler.js` 不是）
