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
import { computed, ref } from 'vue'
import { NAV_GROUPS, type NavGroup, type NavItem } from '@/config/navigation'

const keyword = ref('')

const filteredGroups = computed<NavGroup[]>(() => {
  if (!keyword.value.trim()) return NAV_GROUPS
  const kw = keyword.value.toLowerCase()
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.title.toLowerCase().includes(kw)) }))
    .filter((g) => g.items.length > 0)
})

function resolveTo(item: NavItem) {
  return { name: item.route, params: item.params }
}
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
