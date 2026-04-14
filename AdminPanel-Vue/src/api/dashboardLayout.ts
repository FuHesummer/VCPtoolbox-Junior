// 仪表盘布局持久化 API
import { apiFetch } from './client'

export type CardSize = 'sm' | 'md' | 'lg' | 'xl'

export interface CardLayout {
  id: string
  order: number
  size: CardSize
  visible: boolean
}

const SILENT = { showLoader: false, suppressErrorToast: true } as const

export function getDashboardLayout() {
  return apiFetch<{ success: boolean; layouts: CardLayout[] }>(
    '/admin_api/dashboard-layout',
    { ...SILENT },
  )
}

export function saveDashboardLayout(layouts: CardLayout[]) {
  return apiFetch<{ success: boolean; count: number }>(
    '/admin_api/dashboard-layout',
    {
      method: 'POST',
      body: JSON.stringify(layouts),
      headers: { 'Content-Type': 'application/json' },
      ...SILENT,
    },
  )
}
