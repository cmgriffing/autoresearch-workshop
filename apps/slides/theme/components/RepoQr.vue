<script setup lang="ts">
import repoQr from '../../images/repo-qr-code.svg?url'
defineProps<{ large?: boolean }>()
</script>

<template>
  <div class="repo-access" :class="{ 'repo-access-large': large }">
    <a class="repo-qr" href="https://github.com/cmgriffing/autoresearch-workshop"><img :src="repoQr" alt="QR code linking to github.com/cmgriffing/autoresearch-workshop" /></a>
    <span class="repo-qr-label">Workshop repo</span>
  </div>
</template>
