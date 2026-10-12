<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
import RepoQr from '../components/RepoQr.vue'
defineProps<{ label?: string }>()
</script>

<template>
  <LabFrame kind="repository" :label="label">
    <div><slot /></div>
    <RepoQr large />
  </LabFrame>
</template>
