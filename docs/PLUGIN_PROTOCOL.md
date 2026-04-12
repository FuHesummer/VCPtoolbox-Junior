# VCP Plugin Protocol

> VCPtoolbox-Junior 插件系统协议规范

## 目录结构

```
Plugin/<PluginName>/
├── plugin-manifest.json          # 插件契约（启用状态）
├── plugin-manifest.json.block    # 插件契约（禁用状态，二选一）
├── <entryPoint script>           # 入口文件
├── config.env                    # 运行时配置（可选，key=value 格式）
├── admin/                        # 自定义管理界面（可选）
│   ├── index.html                # 管理页面入口
│   └── *.js / *.css              # 管理页面静态资源
└── ...                           # 其他插件文件
```

## manifest 字段规范

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 插件唯一标识符（PascalCase） |
| `pluginType` | string | 插件类型，见下方枚举 |
| `entryPoint` | object | 入口配置 |

### 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `displayName` | string | 面板显示名称 |
| `version` | string | 语义化版本号 |
| `description` | string | 插件描述 |
| `author` | string | 作者 |
| `communication` | object | 通信配置 |
| `capabilities` | object | 能力声明 |
| `configSchema` | object | 配置项 Schema（AdminPanel 自动渲染表单） |
| `configSchemaDescriptions` | object | 配置项描述映射 |
| `defaults` | object | 配置项默认值映射 |
| `webSocketPush` | object | WebSocket 推送配置 |
| `lifecycle` | object | 生命周期钩子 |

## pluginType 枚举

| 类型 | 执行模式 | 说明 |
|------|----------|------|
| `static` | 启动时执行一次 | 通过 `systemPromptPlaceholders` 注入系统提示词 |
| `messagePreprocessor` | 每次请求前执行 | 处理/修改消息队列（如 RAG 注入） |
| `synchronous` | 工具调用时同步执行 | 阻塞等待结果返回 |
| `asynchronous` | 工具调用时异步执行 | 不阻塞主流程 |
| `service` | 后台常驻服务 | 需要 `initialize()` / `shutdown()` 生命周期 |
| `hybridservice` | 混合模式 | 兼具 service 和 messagePreprocessor 能力 |

## entryPoint 配置

### direct 协议（JS 模块直接 require）

```json
{
  "entryPoint": {
    "script": "MyPlugin.js"
  },
  "communication": {
    "protocol": "direct"
  }
}
```

### stdio 协议（子进程 stdin/stdout JSON）

```json
{
  "entryPoint": {
    "type": "nodejs",
    "command": "node my-plugin.js"
  },
  "communication": {
    "protocol": "stdio",
    "timeout": 60000
  }
}
```

支持的 `type`: `nodejs`, `python`, `binary`

### distributed 协议（WebSocket 远程节点）

由远程节点通过 WebSocket 注册，不需要本地文件。

## configSchema

用于 AdminPanel 自动生成配置表单。支持两种格式：

### 简写格式

```json
{
  "configSchema": {
    "API_KEY": "string",
    "ENABLED": "boolean",
    "MAX_RETRIES": "number"
  }
}
```

### 详细格式

```json
{
  "configSchema": {
    "RerankUrl": {
      "type": "string",
      "description": "Rerank 服务的 URL",
      "default": ""
    },
    "MaxRetries": {
      "type": "number",
      "description": "最大重试次数",
      "default": 3
    }
  }
}
```

配置值存储在插件目录下的 `config.env` 文件中。

## capabilities

### systemPromptPlaceholders

```json
{
  "capabilities": {
    "systemPromptPlaceholders": ["{{VCPMyPlugin}}"]
  }
}
```

static 类型插件通过此字段声明占位符，运行时注入到系统提示词中。

### invocationCommands

```json
{
  "capabilities": {
    "invocationCommands": [
      {
        "command": "MyCommand",
        "commandIdentifier": "MyCommand",
        "description": "执行某操作的 AI 指令描述"
      }
    ]
  }
}
```

VCP 工具协议使用中文分隔符 `「始」「末」`（`<<<[TOOL_REQUEST]>>>`）进行调用。

## 自定义管理界面（admin/）

插件如果需要超出 config.env 表单的复杂管理 UI，可在目录下放置 `admin/index.html`。

### 规范

- AdminPanel 自动检测 `admin/index.html` 是否存在
- 存在时，插件配置页面显示"高级设置"按钮
- 点击后以 modal + iframe 方式加载
- 页面通过 `/admin_api/plugins/<name>/admin-page` 提供
- 静态资源通过 `/admin_api/plugins/<name>/admin-assets/<filename>` 提供

### 模板

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>插件名 - 高级设置</title>
    <style>
        /* 建议适配暗色主题 */
        body { font-family: system-ui; background: #1e293b; color: #f8fafc; padding: 24px; }
    </style>
</head>
<body>
    <h2>插件名 配置</h2>
    <!-- 自定义 UI -->
    <script>
        const API_BASE = '/admin_api';
        // 可通过 fetch 调用后端接口
    </script>
</body>
</html>
```

## 插件启用/禁用

- **启用**：`plugin-manifest.json` 存在
- **禁用**：文件重命名为 `plugin-manifest.json.block`
- AdminPanel 提供一键切换（后端自动 rename + 热重载）

## 生命周期

### service / hybridservice 类型

```javascript
class MyPlugin {
    constructor() {}
    async initialize(config) { /* 启动时调用 */ }
    shutdown() { /* 关闭/热重载时调用 */ }
}
module.exports = MyPlugin;
```

### messagePreprocessor 类型

```javascript
class MyPreprocessor {
    constructor() {}
    async initialize(config) {}
    async processMessages(messages, pluginConfig) {
        // 修改 messages 数组
        return messages;
    }
    shutdown() {}
}
module.exports = MyPreprocessor;
```

## 配置优先级

1. 插件目录 `config.env`（Plugin 级）
2. 根目录 `config.env`（全局级）
3. manifest `defaults`（默认值）

## 约束

- 目录名使用 PascalCase
- manifest 的 `name` 字段必须与代码中的注册名一致
- 不要在 manifest 中硬编码密钥
- stdio 协议的输入输出必须是单行 JSON
- 路径穿越防护：admin assets 只能访问 `admin/` 子目录内的文件
