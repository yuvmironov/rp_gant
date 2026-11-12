<script setup>
const user = ref(null);
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
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if ((options.method ?? 'GET') !== 'GET') headers['X-CSRF-Token'] = csrfToken() ?? '';
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
  return response.status === 204 ? null : response.json();
}

async function load() {
  loading.value = true;
  try {
    const session = await api('/auth/session');
    user.value = session?.user ?? session;
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

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } finally {
    window.location.href = '/login';
  }
}

onMounted(load);
</script>

<template>
  <div class="app-shell">
    <AppHeader :user="user" active-page="notifications" @logout="logout" />
    <main class="page notifications-page">
      <div class="breadcrumbs">
        <a href="/projects" class="back">Проекты</a><span class="sep">/</span><strong>Уведомления</strong>
      </div>
      <header class="page-head notifications-header">
        <div>
          <p class="eyebrow">Центр событий</p>
          <h1 class="page-title">Уведомления</h1>
          <p class="page-subtitle">Важные обновления по вашим проектам и задачам.</p>
        </div>
        <div class="page-head-actions notification-actions">
          <label class="filter-toggle">
            <input v-model="unreadOnly" type="checkbox" @change="load" />
            <span>Только непрочитанные</span>
          </label>
          <button class="btn btn-secondary" type="button" :disabled="loading || !items.length" @click="markAll">
            Прочитать все
          </button>
        </div>
      </header>

      <p v-if="loading" class="loading-state">Загрузка уведомлений...</p>
      <section v-else class="card notifications-card">
        <div v-if="items.length" class="notification-list">
          <article v-for="item in items" :key="item.id" class="notification" :class="{ unread: !item.isRead }">
            <span class="notification-marker" aria-hidden="true" />
            <div class="notification-content">
              <div class="notification-heading">
                <h2>{{ item.title }}</h2>
                <span v-if="!item.isRead" class="badge badge-primary">Новое</span>
              </div>
              <p>{{ item.body }}</p>
              <div class="notification-meta">
                <span>{{ item.eventType }}</span><span class="meta-separator">·</span>
                <time>{{ item.createdAt }}</time>
              </div>
            </div>
            <button v-if="!item.isRead" class="btn btn-secondary btn-sm mark-read" type="button" @click="markRead(item)">
              Прочитать
            </button>
          </article>
        </div>
        <div v-else class="empty">
          <span class="empty-icon" aria-hidden="true">✓</span>
          <h2>Всё прочитано</h2>
          <p>Новых уведомлений пока нет.</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.notifications-page {
  max-width: 1200px;
}

.notifications-header {
  align-items: center;
}

.notification-actions {
  gap: 12px;
}

.filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.filter-toggle input {
  accent-color: var(--color-primary);
}

.notifications-card {
  overflow: hidden;
}

.notification-list {
  display: grid;
}

.notification {
  position: relative;
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  transition: background-color 140ms ease;
}

.notification:last-child {
  border-bottom: 0;
}

.notification:hover {
  background: var(--color-surface-muted);
}

.notification.unread {
  background: linear-gradient(90deg, var(--color-primary-50), var(--color-surface) 38%);
}

.notification-marker {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: transparent;
}

.notification.unread .notification-marker {
  background: var(--color-primary);
  box-shadow: 0 0 0 4px var(--color-primary-50);
}

.notification-content {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.notification-heading {
  display: flex;
  align-items: center;
  gap: 9px;
}

.notification-heading h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--text-base);
  font-weight: 650;
}

.notification-content p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.notification-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.meta-separator {
  color: var(--color-text-subtle);
}

.mark-read {
  white-space: nowrap;
}

.empty {
  display: grid;
  min-height: 240px;
  align-content: center;
  justify-items: center;
  padding: 32px;
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 42px;
  height: 42px;
  margin-bottom: 12px;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--color-success-50);
  color: var(--color-success-700);
  font-size: var(--text-lg);
  font-weight: 750;
}

.empty h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--text-lg);
}

.empty p,
.loading-state {
  margin: 7px 0 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (max-width: 760px) {
  .notifications-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .notification {
    grid-template-columns: 8px minmax(0, 1fr);
    align-items: start;
  }

  .mark-read {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
