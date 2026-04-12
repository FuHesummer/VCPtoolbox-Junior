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

## 自定义管理界面协议（admin/）

插件如果需要超出 config.env 表单的复杂管理 UI，可在目录下放置 `admin/index.html`。

### 加载机制

- AdminPanel 自动检测 `admin/index.html` 是否存在
- 存在时，插件配置页面显示"高级设置"按钮
- 点击后以 **modal + iframe** 方式加载
- 页面通过 `GET /admin_api/plugins/<name>/admin-page` 提供
- 静态资源通过 `GET /admin_api/plugins/<name>/admin-assets/<filename>` 提供

### 文件结构

```
Plugin/MyPlugin/
└── admin/
    ├── index.html        # 入口页面（必需）
    ├── style.css         # 样式（可选，通过 admin-assets 加载）
    ├── app.js            # 逻辑（可选，通过 admin-assets 加载）
    └── ...               # 其他资源
```

### 可用 API

admin 页面在 iframe 内运行，可直接 fetch 以下后端接口（同源，无跨域问题）：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/admin_api/plugins` | GET | 获取所有插件列表（含 manifest、configEnvContent、hasAdminPage） |
| `/admin_api/plugins/:name/config` | POST | 保存插件 config.env（body: `{ content: string }`） |
| `/admin_api/plugins/:name/toggle` | POST | 启用/禁用插件（body: `{ enable: boolean }`） |
| `/admin_api/plugins/:name/admin-assets/:file` | GET | 加载 admin 目录下的静态资源 |
| `/admin_api/plugin-store/installed` | GET | 已安装插件列表 |

此外，插件如果注册了自己的后端路由（通过 service 类型），也可在 admin 页面中调用。

### 设计规范

**样式适配**：
- 背景色使用 `#0f172a`（深色）或 `#1e293b`（次深色）
- 文字颜色使用 `#f8fafc`（主文字）或 `#94a3b8`（次要文字）
- 强调色使用 `#0ea5e9`（蓝色）
- 危险操作使用 `#dc2626`（红色）
- 成功状态使用 `#4ade80`（绿色）
- 圆角使用 6-8px，卡片圆角 8-12px
- 字体使用 `system-ui, -apple-system, sans-serif`

**iframe 环境约束**：
- 页面运行在 iframe 内（宽度约 80vw，高度约 75vh）
- 不要使用 `window.location` 导航（会导致 iframe 跳转）
- 不要假设页面是全屏的
- 所有资源引用使用相对路径或 `/admin_api/plugins/<name>/admin-assets/` 绝对路径

**通信模式**：
```javascript
// 推荐的 API 调用模式
const API = '/admin_api';
const PLUGIN_NAME = 'MyPlugin'; // 你的插件名

// 读取插件配置
async function getConfig() {
    const res = await fetch(`${API}/plugins`);
    const plugins = await res.json();
    return plugins.find(p => p.manifest.name === PLUGIN_NAME);
}

// 保存插件配置
async function saveConfig(envContent) {
    await fetch(`${API}/plugins/${PLUGIN_NAME}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: envContent })
    });
}

// 调用插件自己的后端接口（如果是 service 类型并注册了路由）
async function callPluginApi(endpoint) {
    const res = await fetch(`${API}/${endpoint}`);
    return res.json();
}
```

**状态反馈**：
- 操作成功：绿色文字提示，2-3 秒后淡出
- 操作失败：红色文字提示，不自动消失
- 加载中：居中灰色文字 "加载中..."
- 空状态：居中灰色斜体提示

### 完整模板

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>MyPlugin 设置</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            padding: 20px;
            min-height: 100vh;
        }
        h2 { margin-bottom: 16px; font-size: 1.2rem; }
        .card {
            background: #1e293b;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 12px;
        }
        .form-group { margin-bottom: 14px; }
        .form-group label {
            display: block;
            margin-bottom: 4px;
            font-size: 0.85rem;
            color: #94a3b8;
        }
        .form-group input, .form-group textarea, .form-group select {
            width: 100%;
            padding: 8px 12px;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 6px;
            color: #f8fafc;
            font-size: 0.9rem;
        }
        .form-group input:focus, .form-group textarea:focus {
            outline: none;
            border-color: #0ea5e9;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85rem;
            transition: background 0.2s;
        }
        .btn-primary { background: #0ea5e9; color: white; }
        .btn-primary:hover { background: #0284c7; }
        .btn-danger { background: #dc2626; color: white; }
        .btn-danger:hover { background: #b91c1c; }
        .btn-success { background: #10b981; color: white; }
        .status { margin-top: 8px; font-size: 0.8rem; }
        .status.success { color: #4ade80; }
        .status.error { color: #ef4444; }
        .loading { text-align: center; padding: 40px; opacity: 0.5; }
        .empty { text-align: center; padding: 40px; opacity: 0.4; font-style: italic; }
    </style>
</head>
<body>
    <h2>MyPlugin 高级设置</h2>
    <div id="app"><p class="loading">加载中...</p></div>

    <script>
        const API = '/admin_api';
        const PLUGIN_NAME = 'MyPlugin';

        async function init() {
            try {
                // Load your plugin data
                const res = await fetch(`${API}/plugins`);
                const plugins = await res.json();
                const plugin = plugins.find(p => p.manifest.name === PLUGIN_NAME);

                if (!plugin) {
                    document.getElementById('app').innerHTML = '<p class="empty">插件未加载</p>';
                    return;
                }

                // Render your UI
                render(plugin);
            } catch (e) {
                document.getElementById('app').innerHTML = `<p class="status error">加载失败: ${e.message}</p>`;
            }
        }

        function render(plugin) {
            document.getElementById('app').innerHTML = `
                <div class="card">
                    <div class="form-group">
                        <label>示例配置</label>
                        <input type="text" id="example-input" value="" placeholder="输入值...">
                    </div>
                    <button class="btn btn-primary" onclick="save()">保存</button>
                    <span class="status" id="status"></span>
                </div>
            `;
        }

        async function save() {
            const status = document.getElementById('status');
            try {
                // Build config.env content
                const value = document.getElementById('example-input').value;
                const content = `EXAMPLE_KEY=${value}\n`;

                await fetch(`${API}/plugins/${PLUGIN_NAME}/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });

                status.textContent = '已保存';
                status.className = 'status success';
            } catch (e) {
                status.textContent = '保存失败: ' + e.message;
                status.className = 'status error';
            }
        }

        init();
    </script>
</body>
</html>
```

### config-migrations.json

插件版本更新时配置项变更的声明文件：

```json
{
  "2.0.0": {
    "renames": { "OLD_KEY": "NEW_KEY" },
    "added": { "NEW_VAR": "default_value" },
    "removed": ["DEPRECATED_VAR"]
  }
}
```

更新时系统按版本号顺序依次执行迁移：
- `renames`: key 重命名（保留用户填的 value）
- `added`: 新增 key（使用声明的默认值）
- `removed`: 删除废弃的 key

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
