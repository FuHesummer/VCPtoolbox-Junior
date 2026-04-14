// RAG 参数 / 语义组 / 思维链
import { apiFetch } from './client'

export interface RagTagsConfig {
  threshold?: { enabled: boolean; value: number }
  tags?: Record<string, unknown>
  [k: string]: unknown
}

export interface RagParams {
  [k: string]: unknown
}

export interface SemanticGroupsConfig {
  groups: Record<string, string[]>
  [k: string]: unknown
}

export interface ThinkingChainsConfig {
  chains: Record<string, unknown>
  [k: string]: unknown
}

// ⚠️ 注意：所有 save 端点后端都是 `fs.writeFile(req.body)` 直接落盘
// 所以前端必须发送**完整的 payload 对象本身**，绝对不要包一层 { xxx: payload }
// 否则磁盘文件会被嵌套成 { xxx: { 真实数据... } } 损坏配置结构

export function getRagTags() {
  return apiFetch<RagTagsConfig>('/admin_api/rag-tags')
}

export function saveRagTags(tags: RagTagsConfig) {
  return apiFetch<{ message?: string }>('/admin_api/rag-tags', { method: 'POST', body: tags })
}

export function getRagParams(opts: { showLoader?: boolean; suppressErrorToast?: boolean } = {}) {
  return apiFetch<RagParams>('/admin_api/rag-params', opts)
}

export function saveRagParams(params: RagParams) {
  return apiFetch<{ message?: string }>('/admin_api/rag-params', { method: 'POST', body: params })
}

export function getSemanticGroups() {
  return apiFetch<SemanticGroupsConfig>('/admin_api/semantic-groups')
}

export function saveSemanticGroups(groups: SemanticGroupsConfig) {
  return apiFetch<{ message?: string }>('/admin_api/semantic-groups', { method: 'POST', body: groups })
}

export function getThinkingChains() {
  return apiFetch<ThinkingChainsConfig>('/admin_api/thinking-chains')
}

export function saveThinkingChains(chains: ThinkingChainsConfig) {
  return apiFetch<{ message?: string }>('/admin_api/thinking-chains', { method: 'POST', body: chains })
}

export function getAvailableClusters() {
  return apiFetch<{ clusters: string[] }>('/admin_api/available-clusters')
}

// 向量库状态 — vectorDBManager 未初始化时返回 503 Unavailable，默认 silent
export function getVectorDbStatus(opts: { showLoader?: boolean; suppressErrorToast?: boolean } = {}) {
  return apiFetch<{ success: boolean; status: string }>('/admin_api/vectordb-status', {
    showLoader: false,
    suppressErrorToast: true,
    ...opts,
  })
}
