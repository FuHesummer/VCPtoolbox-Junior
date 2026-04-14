# Plugin/

插件目录，manifest 驱动，支持 Node/Python/Rust 多运行时。

## 插件机制

- **契约文件**：`plugin-manifest.json`（启用） / `plugin-manifest.json.block`（禁用）
- **六种类型**：`static`, `messagePreprocessor`, `synchronous`, `asynchronous`, `service`, `hybridservice`
- **通信协议**：`stdio`（进程 stdin/stdout JSON）、`direct`（require JS 模块）、`distributed`（WebSocket 远程）
- **配置级联**：全局 `config.env` → 插件目录 `config.env` → manifest schema 默认值
- **命名规范**：PascalCase 目录名

## 关键 manifest 字段

```json
{
  "name": "插件标识",
  "pluginType": "synchronous",
  "entryPoint": { "type": "nodejs", "command": "node xxx.js" },
  "communication": { "protocol": "stdio", "timeout": 60000 },
  "capabilities": { "systemPromptPlaceholders": [...] },

  "adminNav": {
    "title": "侧边栏标题",
    "icon": "material_symbol_name",
    "type": "native",       // 或 'iframe'（默认）
    "entry": "panel.js"     // native 时的组件入口（相对 admin/）
  }
}
```

## 插件 admin 扩展协议（Junior 新增）

插件可以**自带前端页面 + 后端 API**，与主面板通过约定协议通信。完全解耦，商店安装即用。

### 后端 API：`pluginAdminRouter`

hybridservice / service 插件可在 `module.exports` 暴露 Express.Router：

```js
const express = require('express');
const pluginAdminRouter = express.Router();
pluginAdminRouter.use(express.json());
pluginAdminRouter.get('/items', async (req, res) => { ... });

module.exports = { initialize, shutdown, pluginAdminRouter };
```

前端访问 `/admin_api/plugins/<PluginName>/api/items` 会自动分发到这个 router。

实现细节见 [Plugin.js](../Plugin.js) `getPluginAdminRouter()` + [routes/adminPanelRoutes.js](../routes/adminPanelRoutes.js) 动态路由。

### 前端页面：两种模式

| `adminNav.type` | 机制 | 适用 |
|----------------|------|------|
| `native` ⭐ | 插件提供 `admin/panel.js`（Vue 组件），主面板原生挂载（无 iframe） | 新插件推荐，视觉与主面板等价 |
| `iframe`（默认） | 插件提供 `admin/index.html`，主面板 iframe 加载 | 遗留插件 / 需要沙盒隔离 |

**native 模式插件编写**：通过 `window.__VCPPanel`（主面板暴露）访问 Vue + API + 工具函数，详见 [docs/ADMINPANEL_DEVELOPMENT.md §5.5](../docs/ADMINPANEL_DEVELOPMENT.md)。

**参考实现**：[VCPtoolbox-Junior-Plugins/AgentDream/](../../VCPtoolbox-Junior-Plugins/AgentDream/) 梦系统插件（hybridservice + native 面板）。

## 高复杂度插件

| 插件 | 规模 | 说明 |
|------|------|------|
| `DailyHot/` | 71 文件 | 56+ 热点源聚合器 |
| `RAGDiaryPlugin/` | 4,652 行 | 语义分组、向量管理、元思考 |
| `LinuxShellExecutor/` | 3,000 行 | 安全关键，13+ 验证器，SSH 管理 |
| `ComfyUIGen/` | 18 文件 | JS+Python 双语言工作流 |
| `PaperReader/` | 11 文件 | chunker, ingest, deep-reader 管线 |

## 禁止

- 不要在 manifest 中硬编码密钥
- 不要假设所有插件都是 Node.js
- 不要直接去掉 `.block` 启用插件而不验证依赖
- 不要随意更改 `entryPoint` 格式
