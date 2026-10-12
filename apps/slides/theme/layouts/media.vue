<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
defineProps<{ label?: string }>()
</script>

<template>
  <LabFrame kind="media" :label="label">
    <div class="media-heading" v-if="$slots.default"><slot /></div>
    <figure class="media-frame"><slot name="image" /></figure>
  </LabFrame>
</template>
