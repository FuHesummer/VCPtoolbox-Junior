import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiFetch } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const authenticated = ref(false)
  const checked = ref(false)

  async function check(): Promise<boolean> {
    try {
      const res = await fetch('/admin_api/check-auth', { credentials: 'same-origin' })
      authenticated.value = res.ok
    } catch {
      authenticated.value = false
    } finally {
      checked.value = true
    }
    return authenticated.value
  }

  async function login(username: string, password: string): Promise<boolean> {
    const auth = 'Basic ' + btoa(`${username}:${password}`)
    const res = await fetch('/admin_api/verify-login', {
      method: 'POST',
      headers: { Authorization: auth },
      credentials: 'same-origin',
    })
    if (res.ok) {
      // 后端会设置 cookie
      authenticated.value = true
      return true
    }
    return false
  }

  async function logout(): Promise<void> {
    await apiFetch('/admin_api/logout', { method: 'POST', showLoader: false, suppressErrorToast: true })
    authenticated.value = false
  }

  return { authenticated, checked, check, login, logout }
})
