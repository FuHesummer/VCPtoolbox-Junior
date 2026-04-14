// TVS 变量文件
import { apiFetch } from './client'

export function listTvsFiles() {
  return apiFetch<{ files: string[] }>('/admin_api/tvsvars')
}

export function getTvsFile(fileName: string) {
  return apiFetch<{ content: string }>(`/admin_api/tvsvars/${encodeURIComponent(fileName)}`)
}

export function saveTvsFile(fileName: string, content: string) {
  return apiFetch<{ message?: string }>(`/admin_api/tvsvars/${encodeURIComponent(fileName)}`, {
    method: 'POST',
    body: { content },
  })
}
