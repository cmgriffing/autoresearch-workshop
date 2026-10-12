<script setup lang="ts">
import { useSlideContext } from '@slidev/client'

defineProps<{ label?: string; kind?: string; grid?: boolean }>()
const { $page } = useSlideContext()
</script>

<template>
  <div class="slidev-layout lab-layout" :class="`lab-${kind || 'content'}`">
    <div v-if="grid" class="lab-grid" aria-hidden="true" />
    <div class="lab-label"><span class="lab-label-mark" aria-hidden="true" />{{ label || 'Autoresearch workshop' }}</div>
    <main class="lab-content"><slot /></main>
    <footer class="lab-footer">
      <span>Change → measure → compare → repeat</span>
      <span class="lab-footer-page">{{ String($page).padStart(2, '0') }} / 36</span>
    </footer>
  </div>
</template>
