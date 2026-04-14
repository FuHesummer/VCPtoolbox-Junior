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

export function getRagTags() {
  return apiFetch<RagTagsConfig>('/admin_api/rag-tags')
}

export function saveRagTags(tags: RagTagsConfig) {
  return apiFetch<{ message?: string }>('/admin_api/rag-tags', { method: 'POST', body: { tags } })
}

export function getRagParams() {
  return apiFetch<RagParams>('/admin_api/rag-params')
}

export function saveRagParams(params: RagParams) {
  return apiFetch<{ message?: string }>('/admin_api/rag-params', { method: 'POST', body: { params } })
}

export function getSemanticGroups() {
  return apiFetch<SemanticGroupsConfig>('/admin_api/semantic-groups')
}

export function saveSemanticGroups(groups: SemanticGroupsConfig) {
  return apiFetch<{ message?: string }>('/admin_api/semantic-groups', { method: 'POST', body: { groups } })
}

export function getThinkingChains() {
  return apiFetch<ThinkingChainsConfig>('/admin_api/thinking-chains')
}

export function saveThinkingChains(chains: ThinkingChainsConfig) {
  return apiFetch<{ message?: string }>('/admin_api/thinking-chains', { method: 'POST', body: { chains } })
}

export function getAvailableClusters() {
  return apiFetch<{ clusters: string[] }>('/admin_api/available-clusters')
}

export function getVectorDbStatus() {
  return apiFetch<{ success: boolean; status: string }>('/admin_api/vectordb-status')
}
