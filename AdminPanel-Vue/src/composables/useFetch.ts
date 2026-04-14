// 通用异步请求包装 — 统一 loading/error/data 管理
import { ref, type Ref } from 'vue'

export interface UseFetchResult<T> {
  data: Ref<T | null>
  error: Ref<Error | null>
  loading: Ref<boolean>
  execute: (...args: unknown[]) => Promise<T | null>
  refresh: () => Promise<T | null>
}

export function useFetch<T>(
  fetcher: (...args: unknown[]) => Promise<T>,
  options: { immediate?: boolean; initial?: T | null } = {},
): UseFetchResult<T> {
  const data = ref<T | null>(options.initial ?? null) as Ref<T | null>
  const error = ref<Error | null>(null)
  const loading = ref(false)
  let lastArgs: unknown[] = []

  async function execute(...args: unknown[]): Promise<T | null> {
    lastArgs = args
    loading.value = true
    error.value = null
    try {
      const res = await fetcher(...args)
      data.value = res
      return res
    } catch (e) {
      error.value = e as Error
      return null
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    return execute(...lastArgs)
  }

  if (options.immediate) execute()

  return { data, error, loading, execute, refresh }
}
