<template>
  <TopBar />
  <div class="container">
    <SideBar />
    <main class="content">
      <router-view v-slot="{ Component }">
        <Transition name="route" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import TopBar from '@/components/layout/TopBar.vue'
import SideBar from '@/components/layout/SideBar.vue'
</script>

<style lang="scss" scoped>
.container {
  display: flex;
  height: calc(100vh - var(--topbar-height));
  gap: var(--content-padding);
  padding: var(--content-padding);
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--secondary-bg);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--card-border);
}

.route-enter-active, .route-leave-active { transition: opacity 0.18s ease; }
.route-enter-from, .route-leave-to { opacity: 0; }
</style>
