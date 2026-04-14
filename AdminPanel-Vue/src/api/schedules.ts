// 日程任务
import { apiFetch } from './client'
import type { Schedule } from './types'

export function listSchedules() {
  return apiFetch<{ schedules: Schedule[] }>('/admin_api/schedules')
}

export function createSchedule(time: string, content: string) {
  return apiFetch<{ status: string; schedule: Schedule }>('/admin_api/schedules', {
    method: 'POST',
    body: { time, content },
  })
}

export function deleteSchedule(id: string) {
  return apiFetch<{ status: string }>(`/admin_api/schedules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
