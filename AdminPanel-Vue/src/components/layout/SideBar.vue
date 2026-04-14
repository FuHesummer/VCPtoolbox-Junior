<template>
  <aside class="sidebar">
    <div class="search">
      <span class="material-symbols-outlined">search</span>
      <input v-model="keyword" type="text" placeholder="搜索导航..." />
    </div>
    <nav>
      <div v-for="group in filteredGroups" :key="group.key" class="nav-group">
        <div class="group-title">{{ group.title }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.route + JSON.stringify(item.params || {})"
          :to="resolveTo(item)"
          class="nav-item"
          active-class="active"
        >
          <span class="material-symbols-outlined">{{ item.icon }}</span>
          <span>{{ item.title }}</span>
        </router-link>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAV_GROUPS, type NavGroup, type NavItem } from '@/config/navigation'
import { listPlugins, getPluginUiPrefs } from '@/api/plugins'
import type { PluginInfo } from '@/api/types'

const keyword = ref('')
const dynamicPluginItems = ref<NavItem[]>([])

// 读取已启用插件的 adminNav 声明，根据 plugin-ui-prefs 过滤后注入到"插件"分组
async function loadPluginNav() {
  try {
    const [plugins, prefs] = await Promise.all([
      listPlugins({ showLoader: false, suppressErrorToast: true }).catch(() => [] as PluginInfo[]),
      getPluginUiPrefs({ showLoader: false, suppressErrorToast: true }).catch(() => ({} as Record<string, { adminNav?: boolean }>)),
    ])
    const list = (plugins as PluginInfo[]) ?? []
    const prefsMap = prefs as Record<string, { adminNav?: boolean }>
    const items: NavItem[] = []
    for (const p of list) {
      if (!p.enabled) continue
      const nav = p.manifest.adminNav
      if (!nav) continue
      if (prefsMap[p.manifest.name]?.adminNav === false) continue
      items.push({
        title: nav.title || p.manifest.displayName || p.manifest.name,
        route: 'plugin-nav',
        icon: nav.icon || 'extension',
        params: { name: p.manifest.name },
      })
    }
    dynamicPluginItems.value = items
  } catch (_) { /* 增强特性，静默失败 */ }
}

// 合并静态 NAV_GROUPS 与插件动态项（plugins 组追加）
const mergedGroups = computed<NavGroup[]>(() => {
  return NAV_GROUPS.map((g) => {
    if (g.key === 'plugins' && dynamicPluginItems.value.length) {
      return { ...g, items: [...g.items, ...dynamicPluginItems.value] }
    }
    return g
  })
})

const filteredGroups = computed<NavGroup[]>(() => {
  if (!keyword.value.trim()) return mergedGroups.value
  const kw = keyword.value.toLowerCase()
  return mergedGroups.value
    .map((g) => ({ ...g, items: g.items.filter((i) => i.title.toLowerCase().includes(kw)) }))
    .filter((g) => g.items.length > 0)
})

function resolveTo(item: NavItem) {
  return { name: item.route, params: item.params }
}

// 路由切换回插件管理页时，刷新动态导航（toggle 开关后及时生效）
const router = useRouter()
router.afterEach((to, from) => {
  if (from.name === 'plugin-manager' && to.name !== 'plugin-manager') {
    loadPluginNav()
  }
})

onMounted(loadPluginNav)
</script>

<style lang="scss" scoped>
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--card-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 16px;
  overflow-y: auto;
}

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  padding: 6px 12px;
  margin-bottom: 16px;

  input {
    border: none;
    background: transparent;
    flex: 1;
    padding: 0;
    font-size: 13px;
  }

  .material-symbols-outlined {
    font-size: 18px;
    color: var(--secondary-text);
  }
}

.nav-group + .nav-group {
  margin-top: 16px;
}

.group-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--secondary-text);
  padding: 0 8px 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  color: var(--primary-text);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: var(--accent-bg); text-decoration: none; }

  &.active {
    background: var(--button-bg);
    color: #fff;
  }

  .material-symbols-outlined {
    font-size: 20px;
  }
}
</style>
