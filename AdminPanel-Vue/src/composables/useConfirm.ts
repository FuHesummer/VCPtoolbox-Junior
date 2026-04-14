// 统一确认弹窗 — 替代 window.confirm
// 使用：const { confirm } = useConfirm(); if (await confirm('真的吗？', {title, danger})) {...}
import { ref } from 'vue'

interface ConfirmOptions {
  title?: string
  danger?: boolean
  okText?: string
  cancelText?: string
}

interface PendingConfirm {
  message: string
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

const current = ref<PendingConfirm | null>(null)

export function useConfirm() {
  function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      current.value = { message, options, resolve }
    })
  }

  function respond(ok: boolean) {
    current.value?.resolve(ok)
    current.value = null
  }

  return { confirm, current, respond }
}
