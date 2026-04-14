// 插件管理 API
import { apiFetch } from './client'
import type { PluginInfo, PluginUiPrefs } from './types'

export function listPlugins(opts: { showLoader?: boolean; suppressErrorToast?: boolean } = {}) {
  // 注：/admin_api/plugins 在 adminServer 里通常代理到主服务 :6005
  // 主服务未起时会 504 — 调用方按需传 { suppressErrorToast: true } 抑制 toast
  return apiFetch<PluginInfo[]>('/admin_api/plugins', opts)
}

export function togglePlugin(name: string, enabled: boolean) {
  return apiFetch<{ message?: string }>(`/admin_api/plugins/${encodeURIComponent(name)}/toggle`, {
    method: 'POST',
    body: { enabled },
  })
}

export function updatePluginDescription(name: string, description: string) {
  return apiFetch<{ message?: string }>(`/admin_api/plugins/${encodeURIComponent(name)}/description`, {
    method: 'POST',
    body: { description },
  })
}

export function savePluginConfig(name: string, content: string) {
  return apiFetch<{ message?: string }>(`/admin_api/plugins/${encodeURIComponent(name)}/config`, {
    method: 'POST',
    body: { content },
  })
}

export function getPluginConfigSchema(name: string) {
  return apiFetch<{ configSchema: Record<string, unknown> }>(`/admin_api/plugins/${encodeURIComponent(name)}/config-schema`)
}

export function savePluginConfigValues(name: string, values: Record<string, unknown>) {
  return apiFetch<{ message?: string }>(`/admin_api/plugins/${encodeURIComponent(name)}/config-values`, {
    method: 'POST',
    body: values,
  })
}

export function getPluginAdminPage(name: string) {
  return apiFetch<string>(`/admin_api/plugins/${encodeURIComponent(name)}/admin-page`)
}

export function updateCommandDescription(pluginName: string, commandId: string, description: string) {
  const path = `/admin_api/plugins/${encodeURIComponent(pluginName)}/commands/${encodeURIComponent(commandId)}/description`
  return apiFetch<{ message?: string }>(path, {
    method: 'POST',
    body: { description },
  })
}

export function getPluginUiPrefs(opts: { showLoader?: boolean; suppressErrorToast?: boolean } = {}) {
  return apiFetch<PluginUiPrefs>('/admin_api/plugin-ui-prefs', opts)
}

export function savePluginUiPrefs(prefs: PluginUiPrefs) {
  return apiFetch<{ message?: string }>('/admin_api/plugin-ui-prefs', {
    method: 'POST',
    body: prefs,
  })
}
