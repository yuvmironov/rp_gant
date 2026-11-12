<script setup>
const user = ref(null);
const sessions = ref([]);
const contacts = ref({});
const preferences = ref({ internal: true, email: true, telegram: false });
const profile = ref({ displayName: '', lastName: '', firstName: '', position: '' });
const telegramCode = ref('');
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
  try {
    user.value = await api('/auth/session');
    profile.value = {
      displayName: user.value.displayName ?? '',
      lastName: user.value.lastName ?? '',
      firstName: user.value.firstName ?? '',
      position: user.value.position ?? '',
    };
    const [prefs, contact, sessionList] = await Promise.all([
      api('/notifications/preferences'),
      api('/users/me/contacts'),
      api('/auth/sessions'),
    ]);
    for (const channel of ['internal', 'email', 'telegram']) {
      const item = (prefs.items ?? []).find((entry) => entry.channel === channel);
      preferences.value[channel] = item ? item.enabled : channel !== 'telegram';
    }
    contacts.value = contact;
    sessions.value = sessionList.items ?? [];
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
}

async function run(action) {
  error.value = '';
  try {
    await action();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function saveProfile() {
  await run(async () => {
    user.value = await api('/users/me', { method: 'PATCH', body: profile.value });
    await load();
  });
}

async function savePreferences() {
  await run(async () => {
    const items = [];
    for (const eventType of ['task.assigned', 'comment.mentioned']) {
      for (const channel of ['internal', 'email', 'telegram']) {
        items.push({ eventType, channel, enabled: preferences.value[channel] });
      }
    }
    await api('/notifications/preferences', { method: 'PUT', body: { items } });
  });
}

async function createTelegramCode() {
  await run(async () => {
    const response = await api('/users/me/telegram/link-code', { method: 'POST' });
    telegramCode.value = response.code;
    const telegramUserId = window.prompt('Telegram user id для локальной привязки:');
    if (!telegramUserId) return;
    await api('/users/me/telegram', {
      method: 'POST',
      body: { code: response.code, telegramUserId, telegramUsername: 'local_user' },
    });
    await load();
  });
}

async function unlinkTelegram() {
  await run(async () => {
    await api('/users/me/telegram', { method: 'DELETE' });
    await load();
  });
}

async function revokeSession(id) {
  await run(async () => {
    await api(`/auth/sessions/${id}`, { method: 'DELETE' });
    await load();
  });
}

async function logoutAll() {
  await run(async () => {
    await api('/auth/logout-all', { method: 'POST' });
    window.location.href = '/login';
  });
}

onMounted(load);
</script>

<template>
  <main class="profile-page">
    <header class="profile-header">
      <div>
        <a href="/projects" class="back">← Проекты</a>
        <h1>Профиль</h1>
      </div>
      <span>{{ user?.email }}</span>
    </header>

    <p v-if="loading">Загрузка...</p>

    <section class="card">
      <h2>Профиль</h2>
      <form id="profile-form" class="form" @submit.prevent="saveProfile">
        <label>Отображаемое имя <input v-model="profile.displayName" name="displayName" /></label>
        <label>Фамилия <input v-model="profile.lastName" name="lastName" /></label>
        <label>Имя <input v-model="profile.firstName" name="firstName" /></label>
        <label>Должность <input v-model="profile.position" name="position" /></label>
        <button type="submit">Сохранить профиль</button>
      </form>
    </section>

    <section class="card">
      <h2>Каналы уведомлений</h2>
      <form id="preferences-form" class="inline" @submit.prevent="savePreferences">
        <label><input v-model="preferences.internal" name="internal" type="checkbox" /> В приложении</label>
        <label><input v-model="preferences.email" name="email" type="checkbox" /> Email</label>
        <label><input v-model="preferences.telegram" name="telegram" type="checkbox" /> Telegram</label>
        <button type="submit">Сохранить</button>
      </form>
      <p class="muted">
        Telegram:
        {{ contacts.telegramLinked ? contacts.telegramUsername || contacts.telegramUserId : 'не привязан' }}
      </p>
      <div class="inline">
        <button id="telegram-code" type="button" @click="createTelegramCode">Привязать Telegram</button>
        <button id="telegram-unlink" type="button" @click="unlinkTelegram">Отвязать</button>
      </div>
      <p v-if="telegramCode" class="muted">Код: {{ telegramCode }}</p>
    </section>

    <section class="card">
      <h2>Сессии</h2>
      <div class="list">
        <div v-for="session in sessions" :key="session.id" class="list-item">
          <strong>{{ session.userAgent || 'Неизвестное устройство' }}</strong>
          <span>{{ session.ip }} · {{ session.lastSeenAt }}</span>
          <button type="button" @click="revokeSession(session.id)">Отозвать</button>
        </div>
      </div>
      <button type="button" class="danger" @click="logoutAll">Выйти на всех устройствах</button>
    </section>
  </main>
</template>

<style scoped>
.profile-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
  color: #1f2937;
  font-family: Inter, system-ui, sans-serif;
}
.profile-header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.back { color: #2563eb; text-decoration: none; font-size: 14px; }
h1 { margin: 4px 0 0; font-size: 28px; }
h2 { margin: 0 0 16px; font-size: 18px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.form { display: grid; gap: 12px; }
.inline { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 10px 0; }
input, button { font: inherit; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; }
button { background: #111827; color: #fff; border-color: #111827; cursor: pointer; }
button.danger { background: #b91c1c; border-color: #b91c1c; }
.list { display: grid; gap: 8px; margin-bottom: 16px; }
.list-item { display: grid; gap: 4px; padding: 10px; background: #f9fafb; border-radius: 8px; }
.list-item span { color: #6b7280; font-size: 12px; }
.muted { color: #6b7280; font-size: 13px; }
.error { color: #b91c1c; }
@media (max-width: 640px) { .profile-page { padding: 14px; } .profile-header { flex-direction: column; } }
</style>
