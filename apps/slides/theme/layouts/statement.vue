<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
defineProps<{ label?: string }>()
</script>

<template>
  <LabFrame kind="statement" :label="label">
    <div class="statement-content"><slot /></div>
  </LabFrame>
</template>
