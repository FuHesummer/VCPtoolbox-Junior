<template>
  <router-view />
  <MessagePopup />
  <LoadingOverlay />
  <ConfirmDialog />
</template>

<script setup lang="ts">
import MessagePopup from '@/components/feedback/MessagePopup.vue'
import LoadingOverlay from '@/components/feedback/LoadingOverlay.vue'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
</script>
