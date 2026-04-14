# AdminPanel-Vue

> VCPtoolbox-Junior 管理面板 Vue 3 重构版

## 技术栈

- **Vue 3.5** + Composition API + `<script setup>`
- **TypeScript 5.7** (strict mode)
- **Vite 6** 构建
- **Pinia** 状态管理
- **Vue Router 4** 路由
- **Vitest** 单元测试
- **SCSS** 样式

## 快速开始

```bash
# 安装依赖
npm install

# 开发（默认 http://localhost:5173）
# 需要后端 AdminServer 跑在 :6006，前端已配代理
npm run dev

# 类型检查 + 生产构建（输出到 dist/）
npm run build

# 只构建跳过 type-check（快）
npm run build:fast

# 单元测试
npm run test

# 代码检查
npm run lint
```

## 目录结构

```
AdminPanel-Vue/
├── index.html              # Vite 入口
├── package.json
├── vite.config.ts          # 构建配置 + dev 代理（/admin_api → :6006）
├── tsconfig.json           # TS 严格模式
├── eslint.config.js        # ESLint flat config
│
├── src/
│   ├── main.ts             # 应用入口
│   ├── App.vue             # 根组件（router-view + 全局反馈）
│   ├── env.d.ts
│   │
│   ├── api/
│   │   └── client.ts       # 统一 apiFetch（401 跳转 / suppressErrorToast / err.status）
│   │
│   ├── stores/
│   │   ├── auth.ts         # 登录态
│   │   └── ui.ts           # 全局 loading + toast
│   │
│   ├── router/
│   │   └── index.ts        # 路由表（19 个主 section + 插件动态页）
│   │
│   ├── config/
│   │   └── navigation.ts   # Sidebar 导航分组（overview/config/memory/tools/plugins/community）
│   │
│   ├── layouts/
│   │   └── MainLayout.vue  # 主布局（TopBar + SideBar + content）
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── TopBar.vue
│   │   │   └── SideBar.vue
│   │   ├── feedback/
│   │   │   ├── MessagePopup.vue
│   │   │   └── LoadingOverlay.vue
│   │   └── common/
│   │       └── PageStub.vue    # 待迁移占位
│   │
│   ├── views/              # 页面（每个 section 对应一个 view）
│   │   ├── LoginView.vue
│   │   ├── overview/       # 仪表盘 / 服务器日志 / NewAPI 监控
│   │   ├── config/         # 全局配置 / Agent / TVS / 工具列表 / Toolbox
│   │   ├── memory/         # 日记 / 知识库 / 语义组 / 思维链 / RAG 调参
│   │   ├── tools/          # 预处理器 / 调用审核 / 占位符 / 日程
│   │   ├── plugins/        # 插件商店 / 插件管理 / 插件动态页
│   │   └── community/      # VCP 论坛
│   │
│   └── styles/
│       ├── theme.scss      # 粉色主题 CSS 变量
│       └── global.scss     # 全局基础样式 + 通用组件（btn / card / input）
│
└── tests/                  # Vitest 单元测试
```

## Junior 独有协议保留清单

- **`apiFetch(suppressErrorToast)`** — 业务自行处理 404 等状态码
- **`err.status`** — ApiError 附带 HTTP 状态码供分支判断
- **401 自动跳转登录** — 跳到 `/AdminPanel/#/login`
- **`dashboardCards`** — 插件仪表盘卡片协议（待 DashboardView 实现）
- **`adminNav`** — 插件侧边栏注入协议（待 plugin store 集成）
- **`plugin-ui-prefs`** — UI 扩展开关
- **`requires`** — 插件间依赖弹窗（待 PluginStoreView 实现）
- **`notebookResolver` 双根扫描** — Agent/ + knowledge/ 支持（待 NotesManagerView 实现）

## 与主仓库的关系

**开发现场**：`VCPtoolbox-Junior/AdminPanel-Vue/`（本目录）

**分发仓库**：`VCPtoolbox-Junior-Panel/AdminPanel-Vue/`（源码镜像）+ GitHub Release zip（dist 产物）

**同步**：`node scripts/sync-panel.js` 把本目录源码推到 Panel 仓库（详见主仓库 scripts/sync-panel.js）

**发布**：Panel 仓库打 tag → CI `npm run build` → `dist/` 打包 zip → GitHub Release → Junior panelUpdater 消费

## 迁移进度

本工程目前处于**脚手架完成阶段**：
- ✅ 路由 / 布局 / 登录 / API client / store / 主题
- ⏳ 19 个 view 目前都是 `PageStub` 占位
- ⏳ 按功能域逐个迁移：登录 → 仪表盘 → 插件 → 配置 → 日记 → 其他

迁移对照表见 `./MIGRATION.md`（待建）。
