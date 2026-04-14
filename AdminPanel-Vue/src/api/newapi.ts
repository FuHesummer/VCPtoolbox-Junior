// NewAPI 监控 API
// 后端只提供三个端点：/summary /trend /models
// 所有时间戳为 unix 秒（后端会自动处理毫秒）
import { apiFetch } from './client'

export interface NewApiQueryParams {
  model_name?: string
  start_timestamp?: number
  end_timestamp?: number
}

export interface NewApiSummary {
  source?: string
  start_timestamp?: number
  end_timestamp?: number
  model_name?: string | null
  total_requests: number
  total_tokens: number
  total_quota: number
  current_rpm: number
  current_tpm: number
}

export interface NewApiTrendItem {
  created_at: number       // unix 秒
  requests: number
  token_used: number
  quota: number
}

export interface NewApiModelItem {
  model_name: string
  requests: number
  token_used: number
  quota: number
}

type Resp<T> = { success: boolean; data: T; error?: string }

function qs(params: NewApiQueryParams): string {
  const u = new URLSearchParams()
  if (params.model_name) u.set('model_name', params.model_name)
  if (params.start_timestamp !== undefined) u.set('start_timestamp', String(params.start_timestamp))
  if (params.end_timestamp !== undefined) u.set('end_timestamp', String(params.end_timestamp))
  return u.toString()
}

export function getNewApiSummary(params: NewApiQueryParams = {}) {
  return apiFetch<Resp<NewApiSummary>>(
    `/admin_api/newapi-monitor/summary?${qs(params)}`,
    { suppressErrorToast: true, showLoader: false },
  )
}

export function getNewApiTrend(params: NewApiQueryParams = {}) {
  return apiFetch<Resp<{ items: NewApiTrendItem[] }>>(
    `/admin_api/newapi-monitor/trend?${qs(params)}`,
    { suppressErrorToast: true },
  )
}

export function getNewApiModels(params: NewApiQueryParams = {}) {
  return apiFetch<Resp<{ items: NewApiModelItem[] }>>(
    `/admin_api/newapi-monitor/models?${qs(params)}`,
    { suppressErrorToast: true },
  )
}
