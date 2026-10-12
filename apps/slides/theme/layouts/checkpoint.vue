<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
import RepoQr from '../components/RepoQr.vue'
defineProps<{ label?: string; repo?: boolean }>()
</script>

<template>
  <LabFrame kind="checkpoint" :label="label">
    <div class="checkpoint-title"><slot /></div>
    <RepoQr v-if="repo" />
    <div v-else class="checkpoint-mark" aria-hidden="true">↗</div>
  </LabFrame>
</template>
