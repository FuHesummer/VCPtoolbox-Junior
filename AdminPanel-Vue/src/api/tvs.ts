// TVS 变量文件 API
// 后端挂载：/admin_api/tvsvars/*
// 机制：每个 .txt 文件 = 一个变量值，文件名（不含 .txt）= 文件标识
// 实际占位符（Tar*/Var*/Sar*）通过 config.env 环境变量中转引用本文件
import { apiFetch } from './client'

export function listTvsFiles() {
  return apiFetch<{ files: string[] }>('/admin_api/tvsvars')
}

export function getTvsFile(fileName: string) {
  return apiFetch<{ content: string }>(
    `/admin_api/tvsvars/${encodeURIComponent(fileName)}`,
    { suppressErrorToast: true },
  )
}

export function saveTvsFile(fileName: string, content: string) {
  // 同时充当「新建」和「覆盖」— POST 到不存在的文件名会自动创建
  return apiFetch<{ message?: string }>(`/admin_api/tvsvars/${encodeURIComponent(fileName)}`, {
    method: 'POST',
    body: { content },
  })
}

export function deleteTvsFile(fileName: string) {
  return apiFetch<{ message?: string }>(`/admin_api/tvsvars/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
  })
}
