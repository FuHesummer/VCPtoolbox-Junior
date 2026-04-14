// 🔌 插件原生挂载协议（native mode）
//
// 暴露到 window.__VCPPanel，给插件的 admin/panel.js 使用。
// 插件只需要写一个组件对象（含 template 字符串 + setup），调用 register() 就能
// 挂载到主面板的 Vue 实例里 — 与原生页面视觉/响应式/路由完全等价。
//
// 用法（插件侧）：
//   (function() {
//     const { Vue, pluginApi, showToast } = window.__VCPPanel
//     const { ref, onMounted } = Vue
//     const api = pluginApi('AgentDream')
//     window.__VCPPanel.register('AgentDream', {
//       template: `<div class="page">...</div>`,
//       setup() { ... }
//     })
//   })()

import * as Vue from 'vue'
import { shallowReactive } from 'vue'
import { apiFetch } from '@/api/client'
import { renderMarkdown, markdownToExcerpt } from '@/utils/markdown'
import type { Component } from 'vue'

// ============ pluginApi(name) 便捷封装 ============
function pluginApi(pluginName: string) {
  const base = `/admin_api/plugins/${encodeURIComponent(pluginName)}/api`
  return {
    get:    (p: string, opts?: any) => apiFetch(`${base}${p}`, { method: 'GET', ...opts }),
    post:   (p: string, body?: any, opts?: any) =>
      apiFetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(body ?? {}), headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) }, ...opts }),
    patch:  (p: string, body?: any, opts?: any) =>
      apiFetch(`${base}${p}`, { method: 'PATCH', body: JSON.stringify(body ?? {}), headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) }, ...opts }),
    delete: (p: string, opts?: any) => apiFetch(`${base}${p}`, { method: 'DELETE', ...opts }),
  }
}

// ============ Toast（委托给主面板 Pinia store，延迟拿） ============
let uiStoreRef: any = null
function setUiStore(store: any) { uiStoreRef = store }

function showToast(message: string, kind: 'success' | 'error' | 'warn' | 'info' = 'info', ttl = 2500) {
  if (uiStoreRef && typeof uiStoreRef.showMessage === 'function') {
    uiStoreRef.showMessage(message, kind, ttl)
  } else {
    console.log(`[Toast:${kind}] ${message}`)
  }
}

// ============ 格式化工具 ============
function formatTime(input: string | number | Date | null | undefined): string {
  if (!input) return '—'
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return String(input)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatCompact(n: number | string | undefined): string {
  const v = Number(n ?? 0)
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

// ============ 插件组件注册表 ============
// 用 shallowReactive 让 PluginNavView 能响应 register 调用
const pluginComponents = shallowReactive<Record<string, Component>>({})

function register(pluginName: string, component: Component) {
  pluginComponents[pluginName] = component
  console.info(`[VCPPanel] Plugin component registered: ${pluginName}`)
}

function getComponent(pluginName: string): Component | null {
  return pluginComponents[pluginName] || null
}

function unregister(pluginName: string) {
  delete pluginComponents[pluginName]
}

// ============ 暴露到全局 ============
const VCPPanel = {
  // Vue 实例（包含 ref/computed/onMounted 等常用 API）
  Vue,

  // 快捷 API
  apiFetch,
  pluginApi,

  // UI
  showToast,

  // 格式化
  formatTime,
  formatBytes,
  formatCompact,

  // Markdown 渲染
  markdown: renderMarkdown,
  markdownExcerpt: markdownToExcerpt,

  // 组件注册
  register,
  getComponent,
  unregister,
  _components: pluginComponents, // 内部用（PluginNavView 读取）

  // 版本
  version: '1.0.0',
}

declare global {
  interface Window {
    __VCPPanel: typeof VCPPanel
  }
}

export function installPluginHost(uiStore: any) {
  setUiStore(uiStore)
  window.__VCPPanel = VCPPanel
  console.info(`[VCPPanel] Installed ✨ (Vue ${Vue.version})`)
}

export { pluginComponents }
