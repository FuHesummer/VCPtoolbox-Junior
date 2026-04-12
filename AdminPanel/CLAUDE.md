# AdminPanel/

内嵌静态管理前端，由后端直接 serve，非独立 SPA。

## 结构

| 文件/目录 | 作用 |
|-----------|------|
| `index.html` | 页面 shell / 布局 |
| `login.html` | 登录页（与 `/admin_api/check-auth` 成对） |
| `script.js` | 路由与初始化 |
| `js/` | 业务模块，调用 `/admin_api` |
| `css/` | 样式，使用 CSS 变量（`var(--...)`） |

## 约定

- 无构建管线（不是 React/Vue 工程），直接编辑原始 HTML/JS/CSS
- API 调用走 `/admin_api` 前缀
- 登录流程变更必须同步前后端
- 样式修改使用 CSS 变量保持一致性

## 禁止

- 不要假设存在现代前端构建管线
- 不要修改 API 字段结构而不同步后端
- 不要在前端脚本中写入敏感值
