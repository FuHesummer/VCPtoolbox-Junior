// 统一 API 客户端 — 迁移自 AdminPanel/js/utils.js 的 apiFetch
// 保留关键特性：
// - 401 自动跳转登录
// - 错误 toast 默认展示，可用 suppressErrorToast 关闭
// - err.status 附带 HTTP 状态码，供业务分支处理（如 404 → "暂无日记"）
// - 自动 loading 计数器（可关闭）
import { useUiStore } from '@/stores/ui'

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | object | null
  showLoader?: boolean
  suppressErrorToast?: boolean
}

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export async function apiFetch<T = unknown>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const ui = useUiStore()
  const { showLoader = true, suppressErrorToast = false, body, ...rest } = options
  const init: RequestInit = { ...rest, credentials: rest.credentials ?? 'same-origin' }

  const headers = new Headers(rest.headers)
  // body 自动 JSON 化（非 FormData / string 时）
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || typeof body === 'string' || body instanceof Blob) {
      init.body = body as BodyInit
    } else {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      init.body = JSON.stringify(body)
    }
  }
  init.headers = headers

  if (showLoader) ui.showLoading(true)
  try {
    const res = await fetch(url, init)
    if (!res.ok) {
      if (res.status === 401) {
        if (!window.location.hash.includes('login')) {
          window.location.href = '/AdminPanel/#/login'
        }
        return new Promise<T>(() => {})
      }
      let errorData: { message?: string; error?: string; details?: string } = {}
      try { errorData = await res.json() } catch { /* not JSON */ }
      const msg = errorData.message || errorData.error || errorData.details || `HTTP error ${res.status}`
      throw new ApiError(msg, res.status, errorData)
    }
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return (await res.json()) as T
    return (await res.text()) as unknown as T
  } catch (err) {
    const error = err as Error
    if (!suppressErrorToast) {
      ui.showMessage(`操作失败: ${error.message}`, 'error')
    }
    throw err
  } finally {
    if (showLoader) ui.showLoading(false)
  }
}

export function escapeHTML(str: string): string {
  if (!str) return ''
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  return String(str).replace(/[&<>"']/g, (m) => map[m])
}
