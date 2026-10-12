<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
import ExperimentLoop from '../components/ExperimentLoop.vue'
defineProps<{ label?: string }>()
</script>

<template>
  <LabFrame kind="section" :label="label" grid>
    <div class="section-title"><slot /></div>
    <ExperimentLoop />
  </LabFrame>
</template>
