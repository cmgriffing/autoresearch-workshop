<script setup lang="ts">
import LabFrame from '../components/LabFrame.vue'
import ExperimentLoop from '../components/ExperimentLoop.vue'
defineProps<{ label?: string }>()
</script>

<template>
  <LabFrame kind="cover" :label="label" grid>
    <div><slot /></div>
    <ExperimentLoop />
  </LabFrame>
</template>
