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
| `requires` | string[] | 插件间依赖列表，见下方章节 |
| `adminNav` | object | AdminPanel 侧边栏独立导航项，见"AdminPanel UI 扩展"章节 |
| `dashboardCards` | object[] | 仪表盘卡片注入，见"AdminPanel UI 扩展"章节 |

## AdminPanel UI 扩展（Junior 扩展协议）

Junior 的 AdminPanel 支持插件在两处注入 UI：**仪表盘卡片** 和 **侧边栏独立页面**。这是对原 `admin/` 管理弹窗的增强，让插件更深度地集成进管理面板。

### dashboardCards — 仪表盘卡片注入

manifest 声明 `dashboardCards` 数组，每个元素描述一张仪表盘上的信息卡片：

```json
{
  "dashboardCards": [
    {
      "id": "dailyhot-summary",
      "title": "今日热榜",
      "icon": "trending_up",
      "source": "dashboard-card.html",
      "width": "1x"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 卡片唯一标识（用于去重，必需）|
| `title` | string | 卡片标题（必需）|
| `icon` | string | Material Symbols 图标名（可选，默认 `extension`）|
| `source` | string | HTML 片段文件名，**相对 `admin/` 目录**（必需）|
| `width` | string | `"1x"`（默认）占一列 / `"2x"` 占两列 |

**加载机制（HTML 片段内联注入）**：
- AdminPanel 进入"仪表盘"页面时，扫描所有已启用插件的 `dashboardCards`
- 通过 `GET /admin_api/plugins/<name>/admin-assets/<source>` 拉取 HTML 片段
- 嵌入到仪表盘网格的 `.plugin-dashboard-card` 容器里
- **片段在父页面 DOM 中执行**，可读 cookies / 调用 `/admin_api`，也能复用主面板 CSS 变量

**⚠️ 片段格式硬性约束**（与 adminNav 的完整页不同）：

```html
<!-- ✅ 正确：纯片段 + 内联 style + 主题变量 -->
<div id="myplugin-card">
  <p style="color:var(--secondary-text);font-size:0.85em;">加载中...</p>
</div>
<script>
(function() {
  // 用 IIFE 隔离作用域，避免污染 window
  fetch('/admin_api/plugins/MyPlugin/data').then(r => r.json()).then(data => {
    document.getElementById('myplugin-card').innerHTML = renderItems(data);
  });
})();
</script>
```

禁止：
- ❌ `<!DOCTYPE html>` / `<html>` / `<head>` / `<body>` — 会被当作节点名处理
- ❌ 独立的 `<style>` 块含全局选择器（如 `body`, `*`, `.hot-item`）— 会污染整个面板
- ❌ 把变量挂到 `window` — 多张卡片并存时会冲突

推荐：
- ✅ 所有样式写成 inline `style="..."`，或用插件唯一前缀类名（如 `.dailyhot-xx`）
- ✅ 尺寸用 `var(--border-color)` / `var(--secondary-text)` 等主题变量，自动适配明暗主题
- ✅ 所有元素 id 加插件前缀（如 `id="dailyhot-card-body"`）避免冲突

**开关**：用户可在"插件管理"页面关闭某插件的仪表盘卡片（保存到 `plugin-ui-prefs.json`），无需禁用整个插件。

### adminNav — 侧边栏独立页面

manifest 声明 `adminNav` 对象，把插件的 `admin/index.html` 提升为 AdminPanel **侧边栏一级导航项**（而不是默认的"插件管理"里点"管理"弹出 iframe）：

```json
{
  "adminNav": {
    "title": "每日热榜",
    "icon": "trending_up"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 侧边栏显示的导航标题 |
| `icon` | string | Material Symbols 图标名 |

**前提**：插件必须有 `admin/index.html`（`hasAdminPage: true`）。

**加载机制（iframe 沙箱隔离）**：
- AdminPanel 启动时扫描所有已启用插件的 manifest，为声明 `adminNav` 的插件在侧边栏"插件"分组追加导航项
- 路由使用 `plugin-nav/:name` 动态页面
- 用户点击时渲染一个 `<iframe src="/admin_api/plugins/<name>/admin-page">` 占据整个内容区
- iframe 与主面板**同源**，cookie 鉴权自动带上，可直接调用 `/admin_api/*`
- **完全沙箱隔离** — 插件页面的 `<html>/<body>/<style>` 不会污染主面板任何样式

**开关**：同 `dashboardCards`，用户可独立关闭。关闭时该插件在侧边栏消失，用户仍可从"插件管理"进入配置弹窗。

### admin/index.html 的渲染方式

**Junior 统一使用 iframe 沙箱隔离**（Vue AdminPanel 与老版本的差异）：

| 维度 | adminNav 侧边栏页 | 插件管理弹窗（默认） |
|------|------------------|---------------------|
| 触发条件 | 声明了 `adminNav` 且用户 UI 偏好启用 | 未声明 `adminNav` 或用户关闭 `adminNav` 偏好 |
| 入口 | 侧边栏独立导航项 | 插件管理卡片的"管理"按钮 |
| 渲染方式 | `<iframe src="/admin_api/plugins/<name>/admin-page">`，占满内容区 | `<iframe src="...">`，约 80vw × 75vh 模态框 |
| DOM 隔离 | ✅ 完全隔离 | ✅ 完全隔离 |
| 可用 API | `fetch('/admin_api/*')`（同源同 cookie）、`postMessage` 与父通信 | 同左 |
| 样式影响 | ❌ 不影响主面板（iframe 文档边界锁住） | ❌ 不影响主面板 |
| 尺寸 | 全屏 section（flex-grow，最小 600px 高度） | 模态框固定尺寸 |
| 适用场景 | 高度集成的管理页（源头管理、表盘、长列表）| 轻量表单、设置、调试工具 |

> 💡 **历史背景**：旧 AdminPanel 的 adminNav 使用"内联模式"把插件 `<body>` 提取出来注入主面板 DOM，共享 CSS 变量但存在全局样式污染风险。Vue 版改为 iframe 统一沙箱，插件开发者**不再需要为内联兼容性妥协**，可以自由写完整 HTML 文档。

**写 admin/index.html 时的自由度**：

因为是 iframe 沙箱隔离，插件页面可以作为一个**完全独立的 HTML 文档**来写，**无任何样式冲突顾虑**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>MyPlugin 管理页</title>
    <style>
        /* ✅ 可以随便污染 body / * / 任意选择器，iframe 锁住了作用域 */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0f172a; color: #f8fafc; padding: 16px; }
        .hot-item:hover { background: rgba(255,255,255,0.04); }
    </style>
</head>
<body>
    <h2>MyPlugin 管理</h2>
    <div id="content">加载中...</div>
    <script>
        // ✅ 可随意使用 window 全局变量，iframe 有独立 window
        // ✅ fetch 同源，cookie 自动携带
        fetch('/admin_api/plugins/MyPlugin/config-schema')
            .then(r => r.json())
            .then(data => { /* ... */ });

        // ✅ 与父面板通信用 postMessage
        window.parent.postMessage({ type: 'plugin-ready', name: 'MyPlugin' }, '*');
    </script>
</body>
</html>
```

**与主面板主题适配**（可选）：

iframe 隔离意味着主面板的 CSS 变量（`var(--border-color)` 等）无法跨 iframe。如果你希望插件页面随主面板明暗主题切换，可以：

1. 父面板发送主题消息给 iframe：`iframe.contentWindow.postMessage({ type: 'theme', mode: 'dark' }, '*')`
2. 插件页面监听 `message` 事件，动态切换自己的 CSS 类

大多数插件直接固定自己的配色即可，无需处理。

### admin/ 目录约定

两种 UI 扩展都依赖插件目录下的 `admin/` 子目录：

```
Plugin/MyPlugin/
└── admin/
    ├── index.html            # adminNav 对应页面 / 默认管理弹窗
    ├── dashboard-card.html   # dashboardCards 的 source 文件
    ├── style.css             # 可选静态资源
    └── app.js                # 可选 JS
```

所有 `admin/` 下的文件都可通过 `/admin_api/plugins/<name>/admin-assets/<file>` 访问。**路径穿越保护**：只允许访问 `admin/` 内的文件。

### plugin-ui-prefs.json

项目根目录下的 `plugin-ui-prefs.json` 存储用户的 UI 开关偏好：

```json
{
  "DailyHot": {
    "dashboardCards": true,
    "adminNav": true
  },
  "RAGDiaryPlugin": {
    "dashboardCards": false
  }
}
```

默认不设置时视为 **启用**。用户通过"插件管理"页面的开关切换，无需改 manifest。

## 插件间依赖（requires）

当某插件在代码层依赖**另一个插件**的内部模块（如 `require('../../OtherPlugin/xxx.js')`）时，必须在 manifest 声明 `requires`：

```json
{
  "name": "LinuxLogMonitor",
  "requires": ["LinuxShellExecutor"]
}
```

**语义**：
- 数组元素是被依赖插件的 `name`（目录名）
- 插件商店**安装本插件前**会检测 `requires` 中的插件是否已安装
- 若有未安装项，商店前端**弹出确认对话框**列出待连锁安装的插件
- 用户确认 → **按依赖优先顺序**串行安装（先装依赖再装本插件）
- 用户拒绝 → 取消安装

**约束**：
- 只做**一层依赖**解析（不递归处理传递依赖）
- 被依赖的插件**必须存在于同一个插件商店仓库**中；不存在时前端报错并阻塞安装
- 插件商店**不会自动卸载**未被使用的依赖插件（卸载 LinuxLogMonitor 不会卸载 LinuxShellExecutor）
- 这是**安装时依赖**，不是**运行时依赖注入**（后者走 PluginManager 的 dependencies 参数）

**何时使用**：
- 插件 A 的代码 `require('../../PluginB/xxx')` 复用 PluginB 的工具模块
- 插件 A 需要 PluginB 的 service 在后台运行才能工作

**何时不需要**：
- 仅通过 VCP 工具协议（`<<<[TOOL_REQUEST]>>>`）调用另一个插件 —— 这是运行时解耦，不算依赖
- 仅读取根项目模块（如 `KnowledgeBaseManager`） —— 这是基础设施，不算插件依赖

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
