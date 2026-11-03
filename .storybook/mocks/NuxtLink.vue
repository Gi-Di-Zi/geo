<script setup lang="ts">
defineProps<{ to: string }>()
</script>

<template>
  <a :href="to" @click.prevent><slot /></a>
</template>
