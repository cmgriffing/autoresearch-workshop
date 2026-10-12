<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
defineProps<{ label?: string }>()
</script>

<template>
  <LabFrame kind="reference" :label="label">
    <slot />
    <div v-if="$slots.left || $slots.right" class="reference-columns">
      <div><slot name="left" /></div>
      <div><slot name="right" /></div>
    </div>
  </LabFrame>
</template>
