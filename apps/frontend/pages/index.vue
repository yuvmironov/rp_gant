<script setup>
const route = useRoute();

onMounted(() => {
  const verifyToken = route.query.verify;
  if (typeof verifyToken === 'string' && verifyToken) {
    return navigateTo({ path: '/login', query: { verify: verifyToken } }, { replace: true });
  }
  return navigateTo('/projects', { replace: true });
});
</script>

<template>
  <main style="padding: 24px; font-family: system-ui, sans-serif">Переход к проектам...</main>
</template>
