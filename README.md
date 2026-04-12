# VCPtoolbox-Junior

> VCP (Variable & Command Protocol) 简化解耦版 — 专注情感记忆系统的轻量化中间层

Fork from [lioensky/VCPToolBox](https://github.com/lioensky/VCPToolBox)

---

## 这是什么

VCPtoolbox-Junior 是 VCPToolBox 的精简分支，保留了 VCP 最核心的能力：**情感记忆系统（浪潮 V8 算法）**，并对架构进行了解耦和整理。

**如果你想要完整的 VCP 体验**（30+ 插件、分布式多节点、硬件级权限、全功能 Agent 系统），请使用 [原仓库](https://github.com/lioensky/VCPToolBox) 进行部署和魔改。

**如果你想要**：
- 干净的代码结构，方便二次开发
- 只需要核心的 RAG 记忆/日记系统
- 学习 VCP 插件开发
- 作为自己项目的情感记忆引擎

那这个仓库适合你。

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
| Linux ARM64 | `vcp-junior-linux-arm64.tar.gz` |
| macOS ARM64 (M系列) | `vcp-junior-darwin-arm64.tar.gz` |

```bash
# 解压后
# Windows: 双击 VCPtoolbox-Junior.bat
# Linux/Mac:
chmod +x vcp-junior
./vcp-junior
```

首次运行会自动创建 `config.env`（从 example 复制）并下载管理面板。编辑 `app/config.env` 填入你的 API 密钥即可。

### 方式二：从源码构建

**环境要求**：
- Node.js 22+
- Rust toolchain (stable)
- npm

```bash
# 克隆
git clone https://github.com/FuHesummer/VCPtoolbox-Junior.git
cd VCPtoolbox-Junior

# 安装 Node 依赖
npm install

# 构建 Rust 向量引擎
cd rust-vexus-lite
npm install
npm run build
cd ..

# 配置
cp config.env.example config.env
# 编辑 config.env，填入你的 API 密钥

# 启动（两种方式）
# A. 统一启动（主服务 + 管理面板）
node build/launcher.js

# B. 分别启动
node server.js          # 主服务（默认端口 6005）
node adminServer.js     # 管理面板（端口 6006，自动下载前端资源）
```

### 方式三：Docker

```bash
docker-compose up --build -d
```

### 本地打包

如果你想自己构建分发包：

```bash
# 打包当前平台
node build/package.js

# 指定平台打包
node build/package.js linux x64
node build/package.js darwin arm64
node build/package.js win32 x64

# 产物在 dist/ 目录
```

---

## 项目结构

```
VCPtoolbox-Junior/
├── server.js              # 主服务入口
├── adminServer.js         # 管理面板独立进程
├── Plugin.js              # 插件生命周期总控
├── maintain.js            # 维护脚本入口
├── modules/               # 后端核心模块
│   ├── KnowledgeBaseManager.js   # 向量库/RAG 总控
│   ├── TagMemoEngine.js          # 浪潮 V8 算法
│   ├── EPAModule.js              # 嵌入投影分析
│   ├── ResidualPyramid.js        # 残差金字塔
│   ├── WebSocketServer.js        # 分布式通信
│   └── ...
├── Plugin/                # 插件目录（动态扫描）
├── routes/                # API 路由
├── AdminPanel/            # 管理前端
├── rust-vexus-lite/       # Rust 向量引擎
├── Agent/                 # Agent 提示词文件
├── dailynote/             # 日记数据
└── docs/                  # 文档
```

---

## 插件开发

VCPtoolbox-Junior 使用 **Manifest 驱动** 的插件系统。开发一个插件只需要：

### 1. 创建目录

```
Plugin/MyPlugin/
├── plugin-manifest.json    # 插件契约
├── my-plugin.js            # 入口文件
└── config.env              # 配置（可选）
```

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
| 辉宝 | `config-migrations.json` 声明式配置迁移方案设计 |

---

## License

[MIT](./LICENSE) — 基于上游 VCPToolBox 的许可
