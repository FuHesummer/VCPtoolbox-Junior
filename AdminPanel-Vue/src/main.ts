import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useUiStore } from '@/stores/ui'
import { installPluginHost } from '@/plugin-host'

// 主面板通用组件 — 全局注册供插件 native 组件直接使用
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import BaseModal from '@/components/common/BaseModal.vue'

import './styles/theme.scss'
import './styles/global.scss'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 🔌 插件 native 模式可直接使用的全局组件
app.component('PageHeader', PageHeader)
app.component('EmptyState', EmptyState)
app.component('BaseModal', BaseModal)

// 🔌 挂载 window.__VCPPanel，供插件 native 模式使用
// 必须在 app.mount 之前完成，确保插件 panel.js 加载时 __VCPPanel 已就绪
installPluginHost(useUiStore())

app.mount('#app')
