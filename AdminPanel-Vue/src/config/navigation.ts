// Sidebar 导航结构定义 — 与 router 表解耦，独立声明可读性更高
// 插件 adminNav 协议会动态向 pluginGroup 追加子项
export interface NavItem {
  title: string
  route: string         // router name
  icon: string          // Material Symbols 图标名
  params?: Record<string, string>
}

export interface NavGroup {
  key: string
  title: string
  items: NavItem[]
  dynamic?: boolean     // 插件动态注入分组
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    title: '概览',
    items: [
      { title: '仪表盘', route: 'dashboard', icon: 'dashboard' },
      { title: '服务器日志', route: 'server-log', icon: 'description' },
      { title: 'NewAPI 监控', route: 'newapi-monitor', icon: 'monitor_heart' },
    ],
  },
  {
    key: 'config',
    title: '配置',
    items: [
      { title: '全局配置', route: 'base-config', icon: 'settings' },
      { title: 'Agent 管理', route: 'agents', icon: 'smart_toy' },
      { title: '变量编辑器', route: 'tvs', icon: 'data_object' },
      { title: '工具列表编辑', route: 'tool-list-editor', icon: 'list_alt' },
      { title: 'Toolbox 管理', route: 'toolbox', icon: 'build' },
    ],
  },
  {
    key: 'memory',
    title: '记忆系统',
    items: [
      { title: '日记管理', route: 'diary', icon: 'menu_book' },
      { title: '知识库管理', route: 'knowledge', icon: 'school' },
      { title: '公共知识库', route: 'public-knowledge', icon: 'public' },
      { title: '语义组编辑', route: 'semantic-groups', icon: 'hub' },
      { title: '思维链编辑', route: 'thinking-chains', icon: 'psychology' },
      { title: 'RAG 调参', route: 'rag-tuning', icon: 'tune' },
    ],
  },
  {
    key: 'tools',
    title: '工具',
    items: [
      { title: '预处理器排序', route: 'preprocessor-order', icon: 'swap_vert' },
      { title: '调用审核', route: 'tool-approval', icon: 'verified' },
      { title: '占位符查看', route: 'placeholders', icon: 'variables' },
      { title: '日程管理', route: 'schedules', icon: 'calendar_month' },
    ],
  },
  {
    key: 'plugins',
    title: '插件',
    dynamic: true,
    items: [
      { title: '插件商店', route: 'plugin-store', icon: 'storefront' },
      { title: '插件管理', route: 'plugin-manager', icon: 'extension' },
    ],
  },
  {
    key: 'community',
    title: '社区',
    items: [
      { title: 'VCP 论坛', route: 'forum', icon: 'forum' },
    ],
  },
]
