<script setup>
const user = ref(null);
const unreadCount = ref(0);
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
    const [prefs, contact, sessionList, unread] = await Promise.all([
      api('/notifications/preferences'),
      api('/users/me/contacts'),
      api('/auth/sessions'),
      api('/notifications/unread-count').catch(() => ({ count: 0 })),
    ]);
    unreadCount.value = unread.count ?? 0;
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
    <AppHeader :user="user" :unread-count="unreadCount" active-page="profile" @logout="logout" />
    <main class="page profile-page">
      <div class="breadcrumbs">
        <a href="/projects" class="back">Проекты</a><span class="sep">/</span><strong>Профиль</strong>
      </div>
      <header class="page-head profile-header">
        <div>
          <p class="eyebrow">Личный кабинет</p>
          <h1 class="page-title">Профиль</h1>
          <p class="page-subtitle">{{ user?.email }} · управляйте данными и безопасностью аккаунта.</p>
        </div>
      </header>

      <p v-if="loading" class="loading-state">Загрузка профиля...</p>
      <div v-else class="profile-content">
        <section class="card profile-card">
          <div class="section-heading">
            <span class="section-icon" aria-hidden="true">◎</span>
            <div>
              <h2>Личные данные</h2>
              <p>Эти сведения видны участникам ваших проектов.</p>
            </div>
          </div>
          <form id="profile-form" class="profile-form" @submit.prevent="saveProfile">
            <label class="field"><span>Отображаемое имя</span><input v-model="profile.displayName" class="input" name="displayName" /></label>
            <div class="field-row">
              <label class="field"><span>Фамилия</span><input v-model="profile.lastName" class="input" name="lastName" /></label>
              <label class="field"><span>Имя</span><input v-model="profile.firstName" class="input" name="firstName" /></label>
            </div>
            <label class="field"><span>Должность</span><input v-model="profile.position" class="input" name="position" /></label>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Сохранить профиль</button></div>
          </form>
        </section>

        <section class="card profile-card">
          <div class="section-heading">
            <span class="section-icon notification-icon" aria-hidden="true">⌁</span>
            <div>
              <h2>Каналы уведомлений</h2>
              <p>Выберите, где получать события по проектам.</p>
            </div>
          </div>
          <form id="preferences-form" class="preferences-form" @submit.prevent="savePreferences">
            <label class="preference-option"><input v-model="preferences.internal" name="internal" type="checkbox" /><span><strong>В приложении</strong><small>Уведомления в центре событий</small></span></label>
            <label class="preference-option"><input v-model="preferences.email" name="email" type="checkbox" /><span><strong>Email</strong><small>Письма на {{ user?.email }}</small></span></label>
            <label class="preference-option"><input v-model="preferences.telegram" name="telegram" type="checkbox" /><span><strong>Telegram</strong><small>{{ contacts.telegramLinked ? contacts.telegramUsername || contacts.telegramUserId : 'Аккаунт не привязан' }}</small></span></label>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Сохранить настройки</button></div>
          </form>
          <div class="telegram-actions">
            <button id="telegram-code" class="btn btn-secondary btn-sm" type="button" @click="createTelegramCode">Привязать Telegram</button>
            <button id="telegram-unlink" class="btn btn-ghost btn-sm" type="button" :disabled="!contacts.telegramLinked" @click="unlinkTelegram">Отвязать</button>
          </div>
          <p v-if="telegramCode" class="telegram-code">Код привязки <strong>{{ telegramCode }}</strong></p>
        </section>

        <section class="card profile-card sessions-card">
          <div class="section-heading section-heading-row">
            <div>
              <p class="eyebrow">Безопасность</p>
              <h2>Активные сессии</h2>
              <p>Завершите сеансы на устройствах, которыми больше не пользуетесь.</p>
            </div>
            <button class="btn btn-danger btn-sm" type="button" @click="logoutAll">Завершить все</button>
          </div>
          <div v-if="sessions.length" class="session-list">
            <div v-for="session in sessions" :key="session.id" class="session-row">
              <span class="session-device" aria-hidden="true">◉</span>
              <div class="session-details">
                <strong>{{ session.userAgent || 'Неизвестное устройство' }}</strong>
                <span>{{ session.ip || 'IP неизвестен' }} · {{ session.lastSeenAt }}</span>
              </div>
              <button class="btn btn-secondary btn-sm" type="button" @click="revokeSession(session.id)">Отозвать</button>
            </div>
          </div>
          <p v-else class="empty-state">Активных сессий нет.</p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 1120px;
}

.profile-header {
  margin-bottom: 22px;
}

.profile-content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 16px;
}

.profile-card {
  padding: 20px;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.section-heading h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.section-heading p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.section-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  font-size: 20px;
}

.profile-form,
.preferences-form {
  display: grid;
  gap: 14px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.preference-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.preference-option input {
  margin-top: 3px;
  accent-color: var(--color-primary);
}

.preference-option span {
  display: grid;
  gap: 3px;
}

.preference-option strong {
  font-size: var(--text-sm);
}

.preference-option small {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.telegram-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.telegram-code {
  padding: 10px 12px;
  border: 1px solid var(--color-primary-100);
  border-radius: var(--radius-md);
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  font-size: var(--text-sm);
}

.sessions-card {
  grid-column: 1 / -1;
}

.section-heading-row {
  align-items: flex-start;
  justify-content: space-between;
}

.session-list {
  display: grid;
  gap: 8px;
}

.session-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.session-device {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-primary);
}

.session-details {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.session-details strong {
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-details span,
.empty-state,
.loading-state {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (max-width: 800px) {
  .profile-content {
    grid-template-columns: 1fr;
  }

  .sessions-card {
    grid-column: auto;
  }
}

@media (max-width: 520px) {
  .field-row {
    grid-template-columns: 1fr;
  }

  .session-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .session-row .btn {
    margin-left: 46px;
  }
}
</style>
