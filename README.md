# VCPtoolbox-Junior

[![Stars](https://img.shields.io/github/stars/FuHesummer/VCPtoolbox-Junior?style=social)](https://github.com/FuHesummer/VCPtoolbox-Junior/stargazers)
[![Release](https://img.shields.io/github/v/release/FuHesummer/VCPtoolbox-Junior)](https://github.com/FuHesummer/VCPtoolbox-Junior/releases)
[![License](https://img.shields.io/github/license/FuHesummer/VCPtoolbox-Junior)](./LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/fuhesummer/vcptoolbox-junior)

> VCPToolBox 解耦分支 — 情感记忆系统 + 50+ 插件生态 + 分布式多节点 + Agent 系统

Fork from [lioensky/VCPToolBox](https://github.com/lioensky/VCPToolBox)

---

## 这是什么

VCPtoolbox-Junior 是 VCPToolBox 的解耦分支，保留了 VCP 的全部核心能力：**情感记忆系统（浪潮 V8 算法）、50+ 插件生态、分布式多节点、Agent 系统**，并对架构进行了重构和整理。

**与 [原仓库](https://github.com/lioensky/VCPToolBox) 的区别**：代码结构更干净、模块解耦更清晰、支持自由二次开发和深度定制。功能不做删减，适合想在 VCP 基础上做自己项目的开发者。

---

## 核心能力

### TagMemo 浪潮 V8 情感记忆引擎

- **EPA 投影分析** — 语义空间定位，识别对话所在的"认知世界"
- **残差金字塔** — 逐层分解查询向量，提取新颖度和覆盖率
- **有向共现矩阵** — 标签间的因果关系建模（V7）
- **LIF 脉冲扩散** — 神经网络式的标签激活传播（V6）
- **测地线重排** — 基于语义地形的二次排序（V8）
- **Rust N-API 向量引擎** — 高性能向量检索（rust-vexus-lite）

### 插件系统

- 6 种插件类型（static / messagePreprocessor / synchronous / asynchronous / service / hybridservice）
- Manifest 驱动，即插即用
- 支持 Node.js / Python / Rust 多运行时
- 热重载，无需重启
- 自定义管理界面（`admin/index.html`）

### 分布式通信

- WebSocket 节点注册与远程工具执行
- 跨节点文件拉取（FileFetcherServer）

---

## 快速开始

### 方式一：下载预构建包（推荐）

前往 [Releases](https://github.com/FuHesummer/VCPtoolbox-Junior/releases) 下载对应平台的包：

| 平台 | 文件 |
|------|------|
| Windows x64 | `vcp-junior-win32-x64.zip` |
| Linux x64 | `vcp-junior-linux-x64.tar.gz` |
| macOS ARM64 (M系列) | `vcp-junior-darwin-arm64.tar.gz` |

```bash
# 解压后
# Windows: 直接运行 VCPtoolbox.exe
# Linux/macOS:
chmod +x VCPtoolbox
./VCPtoolbox
```

首次运行会自动创建 `config.env`（从 example 复制）。编辑 `config.env` 填入你的 API 密钥即可。

主服务 (端口 6005) + 管理面板 (端口 6006) 同时启动，打开 `http://localhost:6006/AdminPanel/` 进入管理面板。

### 方式二：Docker

```bash
# 使用 docker-compose（推荐）
docker-compose up --build -d

# 或直接拉取镜像
docker pull ghcr.io/fuhesummer/vcptoolbox-junior:latest
mkdir -p data
docker run -d -p 6005:6005 -p 6006:6006 \
  -v ./data:/usr/src/app/data \
  ghcr.io/fuhesummer/vcptoolbox-junior:latest
```

> 只需挂载一个 `data/` 目录，所有用户数据（配置、插件、知识库、日记、向量索引等）自动持久化。
> 首次启动从镜像同步默认配置；更新镜像时智能合并新插件，保留用户设置和启用状态。
> 持久化路径定义在 `docker-persist.json`，详见文件内注释。

### 方式三：从源码运行

**环境要求**：Node.js 22+、Rust toolchain (stable)

```bash
git clone https://github.com/FuHesummer/VCPtoolbox-Junior.git
cd VCPtoolbox-Junior

# 安装依赖
npm install
cd rust-vexus-lite && npm install && npm run build && cd ..

# 配置
cp config.env.example config.env
# 编辑 config.env，填入 API 密钥

# 启动
node server.js          # 主服务（端口 6005）
node adminServer.js     # 管理面板（端口 6006，另开终端）
```

### 本地打包

```bash
# esbuild 打包
npm run bundle

# SEA 单可执行文件打包（当前平台）
node build/package-sea.js

# 指定平台
node build/package-sea.js linux x64
node build/package-sea.js darwin arm64
node build/package-sea.js win32 x64

# 产物在 dist/ 目录
```

---

## 项目结构

```
VCPtoolbox-Junior/
├── server.js                      # 主服务入口（端口 6005）
├── adminServer.js                 # 管理面板独立进程（端口 6006）
├── Plugin.js                      # 插件生命周期总控
├── maintain.js                    # 维护脚本统一入口
├── config.env                     # 全局配置（复制自 .example，含密钥）
├── config.env.example             # 配置模板
├── agent_map.json                 # Agent 别名 → 提示词映射
├── docker-persist.json            # Docker 持久化目录定义
├── plugin-ui-prefs.json           # AdminPanel UI 扩展开关（按插件独立）
│
├── modules/                       # 后端核心模块
│   ├── KnowledgeBaseManager.js    # 向量库/RAG 总控
│   ├── TagMemoEngine.js           # 浪潮 V8 算法
│   ├── EPAModule.js               # 嵌入投影分析
│   ├── ResidualPyramid.js         # 残差金字塔
│   ├── WebSocketServer.js         # 分布式通信
│   ├── agentManager.js            # Agent 映射热重载
│   ├── notebookResolver.js        # Agent 日记/知识库路径解析
│   ├── panelUpdater.js            # AdminPanel 自动更新器
│   ├── pluginStore.js             # 插件商店逻辑（含依赖解析）
│   ├── rag_params.json            # RAG 热参数（AdminPanel 可改，权威位置）
│   └── ...
│
├── Plugin/                        # 插件目录（13 个内置核心 + 商店扩展）
│   ├── ContextFoldingV2/          # 上下文折叠
│   ├── DailyNote*/                # 日记系统套件（Write/Manager/Panel/Editor）
│   ├── LightMemo/                 # 轻量回忆
│   ├── RAGDiaryPlugin/            # 日记 RAG
│   ├── SemanticGroupEditor/       # 语义组查询与编辑
│   ├── ThoughtClusterManager/     # 思维簇创建与编辑
│   ├── TimelineOrganizer/         # Agent 时间线整理
│   ├── UserAuth/                  # 用户认证
│   ├── VCPLog/                    # 日志推送
│   └── ...                        # 商店安装的第三方插件
│
├── routes/                        # Express API 路由
│   ├── admin/                     # 管理面板 API（/admin_api/*）
│   ├── adminPanelRoutes.js        # 管理面板路由挂载
│   ├── dailyNotesRoutes.js        # 日记 API（路径穿越防护 + 队列）
│   ├── forumApi.js                # VCP 论坛 API
│   └── specialModelRouter.js      # 特殊模型白名单转发
│
├── AdminPanel/                    # 管理前端（独立仓库 VCPtoolbox-Junior-Panel 同步而来）
│   ├── index.html
│   ├── js/                        # 业务脚本（按模块拆分）
│   ├── .panel-version             # 面板版本锚（由 panelUpdater 维护）
│   └── ...
│
├── Agent/                         # Agent 数据目录（每个 Agent 一个子目录）
│   └── <AgentName>/
│       ├── <AgentName>.txt        # Agent 提示词文件
│       ├── diary/                 # 该 Agent 的个人日记
│       └── knowledge/             # 该 Agent 的专属知识库
│
├── knowledge/                     # 公共知识库（所有 Agent 共享，"公共*" 子目录会被梦系统扫描）
├── thinking/                      # 思维簇目录（AI 元自学习产物）
│
├── TVStxt/                        # TVS 变量文本（{{Tar*}}/{{Var*}}/{{Sar*}} 占位符）
├── rust-vexus-lite/               # Rust N-API 向量引擎子项目
├── scripts/                       # 维护脚本（被 maintain.js 调度）
├── build/                         # SEA 打包脚本
├── docs/                          # 文档体系
│
├── data/                          # Docker 持久化目录（生产环境使用，docker-persist.json 定义）
├── image/                         # 运行时媒体资源（表情包 / 图床）
├── DebugLog/                      # 服务日志轮转
└── .file_cache/                   # 跨节点文件拉取缓存
```

---

## 插件开发

VCPtoolbox-Junior 使用 **Manifest 驱动** 的插件系统。开发一个插件只需要：

### 1. 创建目录

```
Plugin/MyPlugin/
├── plugin-manifest.json    # 插件契约
├── package.json            # npm 依赖声明（有第三方依赖时必需）
├── my-plugin.js            # 入口文件
└── config.env              # 配置（可选）
```

> **重要**：如果插件用了第三方 npm 包（axios、cheerio 等），必须创建 `package.json` 声明依赖。详见 [插件协议文档](./docs/PLUGIN_PROTOCOL.md#npm-依赖管理packagejson)。

### 2. 编写 Manifest

```json
{
  "name": "MyPlugin",
  "displayName": "我的插件",
  "version": "1.0.0",
  "description": "一个示例插件",
  "pluginType": "synchronous",
  "entryPoint": {
    "type": "nodejs",
    "command": "node my-plugin.js"
  },
  "communication": {
    "protocol": "stdio",
    "timeout": 10000
  },
  "configSchema": {
    "API_KEY": {
      "type": "string",
      "description": "你的 API 密钥"
    },
    "ENABLED": {
      "type": "boolean",
      "description": "是否启用",
      "default": true
    }
  }
}
```

### 3. 插件类型速查

| 类型 | 场景 | 通信方式 |
|------|------|----------|
| `static` | 启动时注入系统提示词 | 占位符替换 |
| `messagePreprocessor` | 每次请求前处理消息（如 RAG 注入） | direct (JS require) |
| `synchronous` | 工具调用，同步等待结果 | stdio (JSON) |
| `asynchronous` | 工具调用，不阻塞 | stdio (JSON) |
| `service` | 后台常驻服务 | direct |
| `hybridservice` | service + preprocessor 混合 | direct |

### 4. 自定义管理界面

如果你的插件需要比 config.env 表单更复杂的配置 UI：

```
Plugin/MyPlugin/
└── admin/
    └── index.html    # 放这里，AdminPanel 自动发现
```

AdminPanel 会在插件配置页面显示"高级设置"按钮，点击弹窗加载你的页面。

### 5. 启用 / 禁用

- `plugin-manifest.json` → 启用
- `plugin-manifest.json.block` → 禁用（rename 即可）

详细协议规范见 [docs/PLUGIN_PROTOCOL.md](./docs/PLUGIN_PROTOCOL.md)

---

## 内置插件

| 插件 | 类型 | 作用 |
|------|------|------|
| RAGDiaryPlugin | hybridservice | 日记向量检索与 RAG 注入 |
| DailyNote | synchronous | 日记创建与更新 |
| DailyNoteWrite | synchronous | 日记写入（带自动 Tag） |
| DailyNoteManager | synchronous | 日记批处理 |
| DailyNotePanel | service | 日记面板路由 |
| LightMemo | hybridservice | 轻量回忆（浪潮 V8 适配） |
| ContextFoldingV2 | messagePreprocessor | 上下文语义折叠 |
| UserAuth | static | 用户认证 |
| VCPLog | service | 日志 WebSocket 推送 |
| TimelineOrganizer | service | Agent 生平时间线可视化编辑 + 一键生成 TVStxt/ Markdown |
| DailyNoteEditor | synchronous | AI 日记编辑工具（覆盖 / 查找替换 / 删除单条日记） |
| ThoughtClusterManager | synchronous | AI 思维簇创建与编辑（元自学习能力） |
| SemanticGroupEditor | synchronous | AI 语义词元组查询与批量更新（RAG 知识库辅助） |

---

## 与上游的关系

```
lioensky/VCPToolBox (上游，全功能)
        ↓ fork
FuHesummer/VCPtoolbox-Junior (本仓库，精简解耦)
```

- 上游是完整的 VCP 系统，30+ 插件，适合进阶用户深度魔改
- 本仓库保留核心记忆引擎，解耦了插件管理界面，整理了代码结构
- 不定期从上游同步核心算法更新

---

## 文档

| 文档 | 内容 |
|------|------|
| [PLUGIN_PROTOCOL.md](./docs/PLUGIN_PROTOCOL.md) | 插件系统完整协议规范 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 系统架构（参考） |
| [MEMORY_SYSTEM.md](./docs/MEMORY_SYSTEM.md) | 记忆系统算法详解（参考） |
| [API_ROUTES.md](./docs/API_ROUTES.md) | HTTP 端点文档（参考） |

---

## Contributors

| 贡献者 | 角色 |
|--------|------|
| [FuHe](https://github.com/FuHesummer) | 项目发起 / 架构设计 |
| 辉宝 | 项目命名 (VCPtoolbox-Junior) |

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=FuHesummer/VCPtoolbox-Junior&type=Date)](https://star-history.com/#FuHesummer/VCPtoolbox-Junior&Date)

---

## License

[MIT](./LICENSE) — 基于上游 VCPToolBox 的许可
