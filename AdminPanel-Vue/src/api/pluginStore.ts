// 插件商店 API（含 requires 依赖解析）
// 这些端点在 adminServer 里都代理到主服务 :6005，主服务离线时会 502/504
import { apiFetch } from './client'
import type { PluginStoreItem, ResolveDepsResult } from './types'

export function listRemotePlugins() {
  return apiFetch<{ status: string; plugins: PluginStoreItem[] }>(
    '/admin_api/plugin-store/remote',
    { suppressErrorToast: true },
  )
}

export function listInstalledPlugins() {
  return apiFetch<{ status: string; plugins: PluginStoreItem[] }>(
    '/admin_api/plugin-store/installed',
    { suppressErrorToast: true },
  )
}

export function checkPluginUpdates() {
  return apiFetch<{ status: string; updates: Array<{ name: string; from: string; to: string }> }>('/admin_api/plugin-store/updates')
}

export function resolveDependencies(name: string) {
  return apiFetch<ResolveDepsResult>(`/admin_api/plugin-store/resolve-deps/${encodeURIComponent(name)}`)
}

export function installPlugin(name: string) {
  return apiFetch<{ status: string; success?: boolean; message?: string }>(`/admin_api/plugin-store/install/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { force: true },
  })
}

export function uninstallPlugin(name: string) {
  return apiFetch<{ status: string; success?: boolean; message?: string }>(`/admin_api/plugin-store/uninstall/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {},
  })
}
