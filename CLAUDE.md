# VCPtoolbox-Junior

> Fork from [lioensky/VCPToolBox](https://github.com/lioensky/VCPToolBox) — 简化版，专属 VCP 论坛对接
> Upstream: `upstream` remote → `lioensky/VCPToolBox`

## 项目定位

VCPtoolbox-Junior 是 VCPToolBox 的精简分支，目标是：
1. 剥离不必要的复杂功能，保留核心中间层能力
2. 与专属 VCP 论坛系统对接
3. 保持与上游的同步能力（`upstream/main` → 本地 `sync` 分支 → `main`）

## 上游同步

```bash
git fetch upstream
git checkout sync && git merge upstream/main   # sync 分支保持与上游一致
git checkout main && git merge sync            # 选择性合并到主分支
```

## 代码索引

使用 Augment Context Engine (ACE) MCP 工具进行代码库语义检索：

```
McpAugmentContextEngineCodebaseRetrieval(
  directory_path: "D:/VCP/后端/VCPtoolbox-Junior",
  information_request: "<自然语言描述你要找的代码>"
)
```

- 首次检索会自动建立索引，后续检索实时反映磁盘当前状态
- 适合不确定文件位置时的语义搜索（如"处理用户认证的代码在哪"）
- 精确符号查找（如 `class Foo`）优先用 Grep/Glob
- **强制要求**：所有代码搜索、引用查找、依赖分析必须优先使用 ACE 检索，而非手动 Grep/Glob。ACE 能提供语义级上下文，避免遗漏间接引用

## 架构概览

Node.js 核心的 AI 中间层，采用**扁平化根目录运行结构**（无 `src/` 分层）。

```text
VCPtoolbox-Junior/
├── server.js               # 主 HTTP/SSE 入口与启动编排
├── Plugin.js               # 插件生命周期、加载与执行总控
├── WebSocketServer.js      # 分布式节点与工具桥接
├── KnowledgeBaseManager.js # RAG/标签/向量索引总控
├── maintain.js             # 维护脚本统一入口
├── modules/                # 所有后端模块（含辅助算法模块）
├── routes/                 # Express 路由层
├── scripts/                # 维护/修复脚本
├── Plugin/                 # 插件目录（8个核心插件）
├── AdminPanel/             # 内嵌静态管理前端
├── rust-vexus-lite/        # Rust N-API 向量索引子项目
├── Agent/                  # Agent 提示词文件
├── TVStxt/                 # TVS 变量文件
├── dailynote/              # 运行数据/知识内容（非源码）
├── docs/                   # 上游文档（参考）
└── image/                  # 运行期媒体资源（非源码）
```

## 快速定位

| 任务 | 文件 | 说明 |
|------|------|------|
| 启动与初始化 | `server.js` | 环境加载、中间件、路由挂载、启动顺序 |
| 插件执行链路 | `Plugin.js` | manifest 解析、同步/异步/静态执行 |
| 对话主流程 | `modules/chatCompletionHandler.js` | Chat 请求主循环与 handler 调度 |
| 变量替换 | `modules/messageProcessor.js` | 多阶段占位符解析管线 |
| Agent 映射 | `modules/agentManager.js` | `agent_map.json` 读取与热更新 |
| 分布式工具 | `WebSocketServer.js`, `FileFetcherServer.js` | 节点注册、远程执行 |
| 管理面板后端 | `routes/adminPanelRoutes.js` | 配置/文件/插件控制 API |
| 论坛接口 | `routes/forumApi.js` | 论坛 API，参数约束与锁机制 |
| 日记管理 | `routes/dailyNotesRoutes.js` | 路径穿越防护、队列与大小限制 |
| 特殊模型路由 | `routes/specialModelRouter.js` | 图像/向量白名单透传 |
| 插件协议 | `Plugin/*/plugin-manifest.json` | 各类插件契约定义 |
| 向量引擎 | `rust-vexus-lite/` | Rust N-API 向量检索 |

## 核心代码映射

| 符号 | 类型 | 文件 | 作用 |
|------|------|------|------|
| `startServer` | 函数 | `server.js` | 启动门控（`app.listen` 前） |
| `PluginManager` | 类 | `Plugin.js` | 插件注册、配置合并与执行分发 |
| `ChatCompletionHandler` | 类 | `modules/chatCompletionHandler.js` | 对话主流程编排 |
| `KnowledgeBaseManager` | 类 | `KnowledgeBaseManager.js` | 向量库与 RAG 管线总控 |
| `AgentManager` | 类 | `modules/agentManager.js` | 别名映射、缓存与热更新 |

## 技术约定

### 运行时
- **多运行时**：Node.js + Python + Rust 混合架构
- **模块系统**：CommonJS（`module.exports`），不要引入 ESM-only 依赖
- **配置**：所有配置统一在根目录 `config.env`（模板 `config.env.example`），含核心服务 + 所有保留插件的配置项。插件目录不再单独维护 `config.env`

### 插件系统
- 契约文件：`plugin-manifest.json`（启用） / `plugin-manifest.json.block`（禁用）
- 六种类型：`static`, `messagePreprocessor`, `synchronous`, `asynchronous`, `service`, `hybridservice`
- 静态插件通过 `systemPromptPlaceholders` 注入，格式 `{{VCP...}}`
- VCP 工具协议使用中文分隔符 `「始」「末」`（`<<<[TOOL_REQUEST]>>>`），非 OpenAI function-calling
- 变量系统：`{{Agent*}}`, `{{Tar*}}`, `{{Var*}}`, `{{Sar*}}`，可加载 `TVStxt/*.txt`

### 路由层
- 鉴权在 `server.js` 挂载层处理（`/admin_api`、`/AdminPanel`、bearer 链）
- 每个 endpoint 使用 `try/catch` + 明确状态码
- 文件路径操作必须规范化 + 根目录前缀校验
- `routes/taskScheduler.js` 是编排模块，不是 Express Router

### 前端（AdminPanel）
- 内嵌静态前端，非独立 SPA，无构建管线
- 样式使用 CSS 变量（`var(--...)`）
- 登录流程：`login.html` + `/admin_api/check-auth` 成对变更

## 禁止事项

- **不要**提交真实密钥（`config.env`、插件私有配置）
- **不要**把 `dailynote/`、`image/`、插件 `state/` 当作源码模块
- **不要**随意修改 plugin manifest 关键字段（加载器依赖 schema）
- **不要**直接去掉 `.block` 启用插件，先确认依赖与配置完整
- **不要**新增 `spawn(..., shell: true)` 路径，除非有严格输入约束和鉴权
- **不要**在鉴权不足时暴露重启/命令执行类接口
- **不要**假设 CI 会跑单测（当前仅验证安装与 Docker 构建）
- **不要**改动 Rust N-API 导出符号名而不同步 JS 调用方

## 常用命令

```bash
# 依赖安装
npm install
pip install -r requirements.txt

# Rust 向量引擎构建
cd rust-vexus-lite && npm run build && cd ..

# 配置
cp config.env.example config.env   # 编辑填入 API 密钥

# 运行
node server.js                     # 开发
pm2 start server.js                # 生产

# Docker
docker-compose up --build -d
docker-compose logs -f

# 上游同步
git fetch upstream
git merge upstream/main
```

## 维护工具

统一入口：`node maintain.js <command> [args...]`

```bash
node maintain.js help              # 查看所有命令
node maintain.js rebuild-tags      # 重建标签向量索引（需停服务器）
node maintain.js rebuild-vectors   # 重建全部向量索引（需停服务器）
node maintain.js repair-db         # 修复数据库重复标签（需停服务器）
node maintain.js sync-tags         # 补齐缺失标签（需服务器运行）
node maintain.js classify [flags]  # 日记语义分类（需嵌入 API）
node maintain.js tag-batch <dir>   # 批量标签处理（需 LLM API）
node maintain.js backup <file>     # 备份项目文件到 zip
```

维护脚本源码位于 `scripts/` 目录。通知客户端：`WinNotify.py`（Windows）、`LinuxNotify.py`（Linux），依赖 VCPLog 插件的 WebSocket 推送。

## 详细文档

完整文档体系位于 `docs/` 目录（12 篇，331KB）：

| 文档 | 内容 | 优先级 |
|------|------|--------|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 系统架构、启动序列、模块依赖 | 必读 |
| [PLUGIN_ECOSYSTEM.md](./docs/PLUGIN_ECOSYSTEM.md) | 插件类型、manifest、执行模式 | 必读 |
| [CONFIGURATION.md](./docs/CONFIGURATION.md) | 配置参数、优先级、风险警告 | 必读 |
| [API_ROUTES.md](./docs/API_ROUTES.md) | HTTP 端点、认证、处理逻辑 | 必读 |
| [MEMORY_SYSTEM.md](./docs/MEMORY_SYSTEM.md) | TagMemo 算法、EPA、向量索引 | 参考 |
| [DISTRIBUTED_ARCHITECTURE.md](./docs/DISTRIBUTED_ARCHITECTURE.md) | WebSocket 协议、分布式执行 | 参考 |
| [RUST_VECTOR_ENGINE.md](./docs/RUST_VECTOR_ENGINE.md) | N-API 接口、向量操作 | 参考 |
| [FRONTEND_COMPONENTS.md](./docs/FRONTEND_COMPONENTS.md) | AdminPanel、VCPChrome | 参考 |
| [FILE_INVENTORY.md](./docs/FILE_INVENTORY.md) | 文件清单、职责映射 | 参考 |
| [FEATURE_MATRIX.md](./docs/FEATURE_MATRIX.md) | 功能入口、处理流程 | 参考 |
| [OPERATIONS.md](./docs/OPERATIONS.md) | 运维部署、故障排查 | 参考 |

## .context 项目上下文

> 项目使用 `.context/` 管理开发决策上下文。

- 编码规范：`.context/prefs/coding-style.md`
- 工作流规则：`.context/prefs/workflow.md`
- 决策历史：`.context/history/commits.md`

**规则**：修改代码前必读 prefs/，做决策时按 workflow.md 规则记录日志。
