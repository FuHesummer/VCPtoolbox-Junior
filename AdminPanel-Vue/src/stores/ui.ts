import { defineStore } from 'pinia'
import { ref } from 'vue'

export type MessageType = 'info' | 'success' | 'error' | 'warning'

export interface ToastMessage {
  id: number
  text: string
  type: MessageType
}

export const useUiStore = defineStore('ui', () => {
  const loadingCount = ref(0)
  const message = ref<ToastMessage | null>(null)
  let toastTimer: number | null = null
  let toastId = 0

  function showLoading(show: boolean) {
    if (show) loadingCount.value++
    else loadingCount.value = Math.max(0, loadingCount.value - 1)
  }

  function showMessage(text: string, type: MessageType = 'info', duration = 3500) {
    message.value = { id: ++toastId, text, type }
    if (toastTimer) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      message.value = null
    }, duration)
  }

  return { loadingCount, message, showLoading, showMessage }
})
