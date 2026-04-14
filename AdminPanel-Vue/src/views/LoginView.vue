<template>
  <div class="login-wrapper">
    <div class="login-card card">
      <img src="/VCPLogo2.png" alt="VCP" class="logo" />
      <h1>VCPtoolbox-Junior</h1>
      <p class="subtitle">管理面板登录</p>
      <form @submit.prevent="onSubmit">
        <div class="field">
          <label>用户名</label>
          <input v-model="username" type="text" autocomplete="username" required />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" type="password" autocomplete="current-password" required />
        </div>
        <button type="submit" class="btn submit" :disabled="loading">
          {{ loading ? '登录中...' : '登录' }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  loading.value = true
  error.value = ''
  try {
    const ok = await auth.login(username.value, password.value)
    if (ok) {
      const redirect = (route.query.redirect as string) || '/dashboard'
      router.push(redirect)
    } else {
      error.value = '用户名或密码错误'
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<style lang="scss" scoped>
.login-wrapper {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  text-align: center;
  padding: 32px;

  .logo {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    margin-bottom: 12px;
  }

  h1 {
    margin: 0 0 4px;
    color: var(--highlight-text);
    font-size: 22px;
  }

  .subtitle {
    color: var(--secondary-text);
    font-size: 13px;
    margin-bottom: 24px;
  }
}

.field {
  text-align: left;
  margin-bottom: 12px;

  label {
    display: block;
    font-size: 13px;
    color: var(--secondary-text);
    margin-bottom: 4px;
  }

  input {
    width: 100%;
  }
}

.submit {
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  font-size: 15px;
}

.error {
  color: var(--danger-color);
  font-size: 13px;
  margin-top: 12px;
}
</style>
