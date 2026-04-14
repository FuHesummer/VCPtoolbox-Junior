import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 按 sidebar 结构分组的路由表
// 每个 section 对应一个 lazy-loaded view
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },

      // 概览
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/overview/DashboardView.vue'), meta: { group: 'overview', title: '仪表盘' } },
      { path: 'server-log', name: 'server-log', component: () => import('@/views/overview/ServerLogView.vue'), meta: { group: 'overview', title: '服务器日志' } },
      { path: 'newapi-monitor', name: 'newapi-monitor', component: () => import('@/views/overview/NewApiMonitorView.vue'), meta: { group: 'overview', title: 'NewAPI 监控' } },

      // 配置
      { path: 'base-config', name: 'base-config', component: () => import('@/views/config/BaseConfigView.vue'), meta: { group: 'config', title: '全局配置' } },
      { path: 'agents', name: 'agents', component: () => import('@/views/config/AgentManagerView.vue'), meta: { group: 'config', title: 'Agent 管理' } },
      { path: 'tvs', name: 'tvs', component: () => import('@/views/config/TvsEditorView.vue'), meta: { group: 'config', title: '变量编辑器' } },
      { path: 'tool-list-editor', name: 'tool-list-editor', component: () => import('@/views/config/ToolListEditorView.vue'), meta: { group: 'config', title: '工具列表编辑' } },
      { path: 'toolbox', name: 'toolbox', component: () => import('@/views/config/ToolboxManagerView.vue'), meta: { group: 'config', title: 'Toolbox 管理' } },

      // 记忆系统
      { path: 'diary', name: 'diary', component: () => import('@/views/memory/NotesManagerView.vue'), props: { mode: 'diary' }, meta: { group: 'memory', title: '日记管理' } },
      { path: 'knowledge', name: 'knowledge', component: () => import('@/views/memory/NotesManagerView.vue'), props: { mode: 'knowledge' }, meta: { group: 'memory', title: '知识库管理' } },
      { path: 'public-knowledge', name: 'public-knowledge', component: () => import('@/views/memory/NotesManagerView.vue'), props: { mode: 'public' }, meta: { group: 'memory', title: '公共知识库' } },
      { path: 'semantic-groups', name: 'semantic-groups', component: () => import('@/views/memory/SemanticGroupsView.vue'), meta: { group: 'memory', title: '语义组编辑' } },
      { path: 'thinking-chains', name: 'thinking-chains', component: () => import('@/views/memory/ThinkingChainsView.vue'), meta: { group: 'memory', title: '思维链编辑' } },
      { path: 'rag-tuning', name: 'rag-tuning', component: () => import('@/views/memory/RagTuningView.vue'), meta: { group: 'memory', title: 'RAG 调参' } },

      // 工具
      { path: 'preprocessor-order', name: 'preprocessor-order', component: () => import('@/views/tools/PreprocessorOrderView.vue'), meta: { group: 'tools', title: '预处理器排序' } },
      { path: 'tool-approval', name: 'tool-approval', component: () => import('@/views/tools/ToolApprovalView.vue'), meta: { group: 'tools', title: '调用审核' } },
      { path: 'placeholders', name: 'placeholders', component: () => import('@/views/tools/PlaceholderViewerView.vue'), meta: { group: 'tools', title: '占位符查看' } },

      // 插件
      { path: 'plugin-store', name: 'plugin-store', component: () => import('@/views/plugins/PluginStoreView.vue'), meta: { group: 'plugins', title: '插件商店' } },
      { path: 'plugin-manager', name: 'plugin-manager', component: () => import('@/views/plugins/PluginManagerView.vue'), meta: { group: 'plugins', title: '插件管理' } },
      // 插件 adminNav 动态注入页面（通用路由）
      { path: 'plugin-nav/:name', name: 'plugin-nav', component: () => import('@/views/plugins/PluginNavView.vue'), props: true },

      // 社区
      { path: 'forum', name: 'forum', component: () => import('@/views/community/ForumView.vue'), meta: { group: 'community', title: 'VCP 论坛' } },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
]

const router = createRouter({
  history: createWebHistory('/AdminPanel/'),
  routes,
})

// 鉴权守卫
router.beforeEach(async (to) => {
  if (to.meta.public) return true
  const auth = useAuthStore()
  if (!auth.checked) {
    await auth.check()
  }
  if (!auth.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
