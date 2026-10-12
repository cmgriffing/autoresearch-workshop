<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
defineProps<{ label?: string }>()
</script>

<template>
  <LabFrame kind="instructions" :label="label">
    <slot />
    <aside v-if="$slots.note" class="lab-note"><slot name="note" /></aside>
  </LabFrame>
</template>
