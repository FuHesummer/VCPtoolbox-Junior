// 通用 API 类型定义
export interface ApiResponse<T = unknown> {
  status?: 'success' | 'error'
  message?: string
  data?: T
}

export interface PluginManifest {
  name: string
  displayName?: string
  version?: string
  description?: string
  pluginType?: string
  dashboardCards?: DashboardCardDef[]
  adminNav?: AdminNavDef
  requires?: string[]
  [key: string]: unknown
}

export interface DashboardCardDef {
  id?: string
  title?: string
  icon?: string
  src?: string            // iframe src（相对于插件 admin-assets）
  inline?: string         // 内联 HTML（与 src 二选一）
  height?: number | string
  [key: string]: unknown
}

export interface AdminNavDef {
  title: string
  icon?: string
  src?: string
  inline?: string
}

export interface PluginInfo {
  name: string
  displayName?: string
  enabled: boolean
  manifest: PluginManifest
  configEnvContent?: string
  hasAdminPage?: boolean
  [key: string]: unknown
}

export interface AgentMapNew {
  [alias: string]: {
    prompt?: string
    notebooks?: Record<string, string>
  } | string
}

export interface NoteFolder {
  name: string
  path: string
  count?: number
}

export interface NoteFile {
  name: string
  folder: string
  size?: number
  mtime?: number
}

export interface PluginStoreItem {
  name: string
  displayName?: string
  description?: string
  version?: string
  pluginType?: string                         // hybridservice | synchronous | asynchronous | messagePreprocessor | static | service
  installed?: boolean
  requires?: string[]
  dashboardCards?: DashboardCardDef[]         // UI 扩展：仪表盘卡片
  adminNav?: AdminNavDef                      // UI 扩展：侧边栏导航
  [key: string]: unknown
}

export interface ResolveDepsResult {
  status: 'success' | 'error'
  requires: string[]
  missing: string[]
  already: string[]
  notFound: string[]
}

export interface PluginUiPrefs {
  [pluginName: string]: {
    dashboardCards?: boolean
    adminNav?: boolean
    [k: string]: boolean | undefined
  }
}

export interface SystemResources {
  cpu: { percent: number; count?: number; load?: number[] }
  memory: { total: number; used: number; free: number; percent: number }
  disk?: { total: number; used: number; free: number; percent: number }
}

export interface PM2Process {
  name: string
  pid: number | null
  status: string
  cpu?: number
  memory?: number
  uptime?: number
}

export interface Schedule {
  id: string
  time: string        // ISO 或 cron 表达式
  content: string
  [k: string]: unknown
}

export interface NewApiLogItem {
  timestamp: number
  model: string
  tokens?: number
  cost?: number
  [k: string]: unknown
}
