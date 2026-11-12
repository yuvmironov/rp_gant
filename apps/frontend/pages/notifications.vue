<script setup>
const items = ref([]);
const unreadOnly = ref(false);
const error = ref('');
const toast = useToast();
watch(error, (value) => {
  if (value) toast.error(value);
});

const loading = ref(true);

function csrfToken() {
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('__Host-csrf='))
    ?.slice('__Host-csrf='.length);
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if ((options.method ?? 'GET') !== 'GET') headers['X-CSRF-Token'] = csrfToken() ?? '';
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
  return response.status === 204 ? null : response.json();
}

async function load() {
  loading.value = true;
  try {
    await api('/auth/session');
    const query = new URLSearchParams({ limit: '100' });
    if (unreadOnly.value) query.set('unreadOnly', 'true');
    items.value = (await api(`/notifications?${query}`)).items ?? [];
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
}

async function markRead(item) {
  try {
    await api(`/notifications/${item.id}/read`, { method: 'POST' });
    await load();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function markAll() {
  try {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
  } catch (reason) {
    error.value = reason.message;
  }
}

onMounted(load);
</script>

<template>
  <main class="notifications-page">
    <header class="notifications-header">
      <div>
        <a href="/projects" class="back">← Проекты</a>
        <h1>Уведомления</h1>
      </div>
      <div class="actions">
        <label><input v-model="unreadOnly" type="checkbox" @change="load" /> Только непрочитанные</label>
        <button type="button" @click="markAll">Прочитать все</button>
      </div>
    </header>

    <p v-if="loading">Загрузка...</p>

    <div v-if="!loading" class="list">
      <article v-for="item in items" :key="item.id" class="notification" :class="{ unread: !item.isRead }">
        <div class="content">
          <h2>{{ item.title }}</h2>
          <p>{{ item.body }}</p>
          <span>{{ item.eventType }} · {{ item.createdAt }}</span>
        </div>
        <button v-if="!item.isRead" type="button" @click="markRead(item)">Прочитать</button>
      </article>
      <p v-if="items.length === 0" class="empty">Уведомлений нет.</p>
    </div>
  </main>
</template>

<style scoped>
.notifications-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
  color: #1f2937;
  font-family: Inter, system-ui, sans-serif;
}
.notifications-header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.back { color: #2563eb; text-decoration: none; font-size: 14px; }
h1 { margin: 4px 0 0; font-size: 28px; }
.actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.list { display: grid; gap: 12px; }
.notification {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
}
.notification.unread { border-left: 4px solid #2563eb; }
.content { display: grid; gap: 6px; }
h2 { margin: 0; font-size: 16px; }
p { margin: 0; color: #4b5563; }
span { color: #9ca3af; font-size: 12px; }
button { font: inherit; padding: 7px 10px; border: 1px solid #111827; border-radius: 8px; background: #111827; color: #fff; cursor: pointer; }
.error { color: #b91c1c; }
.empty { color: #6b7280; }
@media (max-width: 640px) {
  .notifications-page { padding: 14px; }
  .notifications-header { flex-direction: column; }
  .notification { flex-direction: column; }
}
</style>
