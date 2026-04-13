# VCP Plugin Protocol

> VCPtoolbox-Junior 插件系统协议规范

## 目录结构

```
Plugin/<PluginName>/
├── plugin-manifest.json          # 插件契约（启用状态）
├── plugin-manifest.json.block    # 插件契约（禁用状态，二选一）
├── package.json                  # npm 依赖声明（有第三方依赖时必须）
├── <entryPoint script>           # 入口文件
├── config.env                    # 运行时配置（可选，key=value 格式）
├── admin/                        # 自定义管理界面（可选）
│   ├── index.html                # 管理页面入口
│   └── *.js / *.css              # 管理页面静态资源
└── ...                           # 其他插件文件
```

## npm 依赖管理（package.json）

**规则：插件使用了任何第三方 npm 包，必须在插件目录下创建 `package.json` 声明依赖。**

插件加载器在 `require()` 入口脚本前会自动检测：如果存在 `package.json` 但没有 `node_modules/`，自动执行 `npm install --production`。插件商店安装/更新时也会自动触发。

### 示例 package.json

```json
{
  "name": "vcptoolbox-plugin-myplugin",
  "private": true,
  "dependencies": {
    "axios": "^1.6.0",
    "dayjs": "^1.11.0"
  }
}
```

### 要点

- `"private": true` 防止意外发布
- 只声明插件**直接使用**的包，不需要列出 Node.js 内置模块（fs, path, crypto 等）
- 版本号使用 `^` 前缀，允许小版本更新
- **不要提交 `node_modules/`**（已在 .gitignore 中排除）
- 如果插件只使用 Node.js 内置模块，不需要创建 package.json

### 为什么必须这样做

VCPToolBox 支持多种打包模式（SEA 单可执行文件、Docker 等），核心代码会被 esbuild 打包成单个 bundle。插件是运行时动态加载的，无法访问 bundle 内部的包。只有通过 `package.json` 声明并安装到插件自己的 `node_modules/` 中，依赖才能正确解析。

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

## 管理界面协议（admin/）

插件管理界面分为两种模式：**自动生成**和**自定义**。

### 自动生成配置表单

只要 manifest 中声明了 `configSchema`，AdminPanel 会**自动生成**一个配置管理表单，无需额外编写任何前端代码。

自动表单支持的类型：
- `string` → 文本输入框（key 名包含 `api`/`key`/`secret` 时自动识别为敏感字段）
- `number` → 数字输入框（支持小数）
- `integer` → 数字输入框（整数步进）
- `boolean` → toggle 开关

表单自动支持：保存配置、恢复默认值、保存后插件热重载。

### 自定义管理界面

如果需要超出配置表单的复杂 UI（如数据展示、图表、操作按钮等），在插件目录下放置 `admin/index.html` 即可**覆盖**自动表单。

**优先级**：自定义 `admin/index.html` > 自动生成 configSchema 表单

### 加载机制

- AdminPanel 检测插件是否有自定义 `admin/index.html` 或 `configSchema`
- 有任一则插件列表显示"管理"按钮
- 点击后以 **modal + iframe** 方式加载
- 自定义页面通过 `GET /admin_api/plugins/<name>/admin-page` 提供
- 无自定义页面但有 configSchema 时，同一端点返回自动生成的配置表单
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
| `/admin_api/plugins/:name/config` | POST | 保存插件 config.env 原始文本（body: `{ content: string }`） |
| `/admin_api/plugins/:name/config-schema` | GET | 获取 configSchema 定义 + 当前解析后的配置值（结构化） |
| `/admin_api/plugins/:name/config-values` | POST | 保存结构化配置值（body: `{ values: { key: value } }`），自动合并已有配置 |
| `/admin_api/plugins/:name/toggle` | POST | 启用/禁用插件（body: `{ enable: boolean }`） |
| `/admin_api/plugins/:name/admin-page` | GET | 获取管理页面（自定义或自动生成） |
| `/admin_api/plugins/:name/admin-assets/:file` | GET | 加载 admin 目录下的静态资源 |
| `/admin_api/plugin-store/installed` | GET | 已安装插件列表 |

此外，插件如果注册了自己的后端路由（通过 service 类型），也可在 admin 页面中调用。

#### config-schema 响应格式

```json
{
  "pluginName": "MyPlugin",
  "displayName": "我的插件",
  "description": "插件描述",
  "fields": {
    "API_KEY": {
      "type": "string",
      "description": "API 密钥",
      "default": "",
      "value": "当前生效的值"
    },
    "MAX_RETRIES": {
      "type": "number",
      "description": "最大重试次数",
      "default": 3,
      "value": 3
    }
  }
}
```

#### config-values 保存方式

发送结构化 JSON，后端自动序列化为 config.env 格式并触发插件热重载：

```javascript
await fetch(`${API}/plugins/${PLUGIN_NAME}/config-values`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        values: { API_KEY: 'sk-xxx', MAX_RETRIES: '5' }
    })
});
```

> **推荐**：新插件优先使用 `config-schema` + `config-values` 结构化接口，`config` 接口（原始文本模式）保留用于向后兼容。

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

// 读取配置（推荐：结构化 API）
async function getConfig() {
    const res = await fetch(`${API}/plugins/${PLUGIN_NAME}/config-schema`);
    return res.json(); // { pluginName, displayName, fields: { key: { type, description, default, value } } }
}

// 保存配置（推荐：结构化 API）
async function saveConfig(values) {
    await fetch(`${API}/plugins/${PLUGIN_NAME}/config-values`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }) // { key: value, ... }
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

        let configData = null;

        async function init() {
            try {
                // 加载配置 schema 和当前值
                const schemaRes = await fetch(`${API}/plugins/${PLUGIN_NAME}/config-schema`);
                configData = await schemaRes.json();

                if (!configData.fields || Object.keys(configData.fields).length === 0) {
                    document.getElementById('app').innerHTML = '<p class="empty">此插件没有可配置项</p>';
                    return;
                }

                render();
            } catch (e) {
                document.getElementById('app').innerHTML = `<p class="status error">加载失败: ${e.message}</p>`;
            }
        }

        function render() {
            // 自定义页面可以在这里构建复杂 UI
            // 基础配置表单已由系统自动生成，此处仅需放置额外功能
            document.getElementById('app').innerHTML = `
                <div class="card">
                    <div class="form-group">
                        <label>示例配置</label>
                        <input type="text" id="example-input"
                            value="${configData.fields.EXAMPLE_KEY?.value || ''}"
                            placeholder="输入值...">
                    </div>
                    <button class="btn btn-primary" onclick="save()">保存</button>
                    <span class="status" id="status"></span>
                </div>
            `;
        }

        async function save() {
            const status = document.getElementById('status');
            try {
                const value = document.getElementById('example-input').value;

                // 使用结构化 API 保存
                await fetch(`${API}/plugins/${PLUGIN_NAME}/config-values`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ values: { EXAMPLE_KEY: value } })
                });

                status.textContent = '✓ 已保存';
                status.className = 'status success';
                setTimeout(() => { status.textContent = ''; }, 3000);
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
