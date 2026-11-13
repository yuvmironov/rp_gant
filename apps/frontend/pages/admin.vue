<script setup>
import {
  SYSTEM_SETTING_FIELDS,
  SYSTEM_SETTING_GROUPS,
  changedSystemSettingItems,
  settingsDraftFromItems,
  validateSystemSettings,
} from '~/utils/system-settings.js';

const user = ref(null);
const unreadCount = ref(0);
const users = ref([]);
const audit = ref([]);
const error = ref('');
const toast = useToast();
watch(error, (value) => {
  if (value) toast.error(value);
});

const loading = ref(true);
const search = ref('');
const auditAction = ref('');
const auditActor = ref('');
const auditLoading = ref(false);
const adminTabs = [
  { id: 'users', label: 'Пользователи', eyebrow: 'Доступ и роли' },
  { id: 'audit', label: 'Журнал аудита', eyebrow: 'Контроль и история' },
  { id: 'settings', label: 'Конфигурация', eyebrow: 'Параметры безопасности' },
];
const activeTab = ref('users');
const tabRefs = ref([]);
const newUser = ref({ email: '', lastName: '', firstName: '', appAdmin: false });
const settingsItems = ref([]);
const settingsDraft = reactive({});
const settingsBaseline = ref({});
const settingsLoaded = ref(false);
const settingsSaving = ref(false);
const settingsValidationErrors = ref({});
const systemSettingKeys = new Set(SYSTEM_SETTING_FIELDS.map((field) => field.key));
const unknownSettings = computed(() =>
  settingsItems.value.filter((item) => !systemSettingKeys.has(item.key)),
);
const changedSettings = computed(() =>
  changedSystemSettingItems(settingsItems.value, settingsDraft, settingsBaseline.value),
);
const hasUnsavedSettings = computed(() => changedSettings.value.length > 0);
const usersPage = ref(1);
const usersPerPage = ref(10);
const usersTotal = ref(0);

const usersPageCount = computed(() => Math.max(1, Math.ceil(usersTotal.value / usersPerPage.value)));
const usersPageItems = computed(() => paginationItems(usersPage.value, usersPageCount.value));
const usersPaginationSummary = computed(() =>
  paginationSummary(usersPage.value, usersPerPage.value, usersTotal.value),
);
function paginationItems(currentPage, pageCount) {
  const visiblePages = Math.min(pageCount, 3);
  const firstPage = Math.min(
    Math.max(currentPage - Math.floor(visiblePages / 2), 1),
    pageCount - visiblePages + 1,
  );
  return Array.from({ length: visiblePages }, (_, index) => firstPage + index);
}

function paginationSummary(currentPage, pageSize, total) {
  if (total === 0) return 'Показано 0 из 0';
  const start = (currentPage - 1) * pageSize + 1;
  return `Показано ${start}–${Math.min(start + pageSize - 1, total)} из ${total}`;
}

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

async function loadUsers() {
  const query = new URLSearchParams({
    limit: String(usersPerPage.value),
    offset: String((usersPage.value - 1) * usersPerPage.value),
  });
  if (search.value.trim()) query.set('query', search.value.trim());
  const response = await api(`/users?${query}`);
  users.value = response.items ?? [];
  usersTotal.value = Number(response.page?.total ?? users.value.length);
  if (usersPage.value > usersPageCount.value) {
    usersPage.value = usersPageCount.value;
    return loadUsers();
  }
}

function searchUsers() {
  usersPage.value = 1;
  return run(loadUsers);
}

function setUsersPageSize() {
  usersPage.value = 1;
  return run(loadUsers);
}

function goToUsersPage(page) {
  const nextPage = Math.min(Math.max(page, 1), usersPageCount.value);
  if (nextPage === usersPage.value) return;
  usersPage.value = nextPage;
  return run(loadUsers);
}

async function loadAudit() {
  auditLoading.value = true;
  try {
    const query = new URLSearchParams({ limit: '50' });
    if (auditAction.value) query.set('actionCode', auditAction.value);
    if (auditActor.value) query.set('actorUserId', auditActor.value);
    audit.value = (await api(`/audit/events?${query}`)).items ?? [];
  } finally {
    auditLoading.value = false;
  }
}

async function loadUnread() {
  unreadCount.value = (await api('/notifications/unread-count').catch(() => ({ count: 0 }))).count ?? 0;
}

async function loadSettings() {
  const response = await api('/settings');
  settingsItems.value = response.items ?? [];
  const nextDraft = settingsDraftFromItems(settingsItems.value);
  for (const key of Object.keys(settingsDraft)) delete settingsDraft[key];
  Object.assign(settingsDraft, nextDraft);
  settingsBaseline.value = { ...nextDraft };
  settingsValidationErrors.value = {};
  settingsLoaded.value = true;
}

function activateTab(tabId, focus = false) {
  activeTab.value = tabId;
  if (tabId === 'audit') void run(loadAudit);
  if (tabId === 'settings' && !settingsLoaded.value) void run(loadSettings);
  if (focus) {
    nextTick(() => tabRefs.value[adminTabs.findIndex((tab) => tab.id === tabId)]?.focus());
  }
}

function onTabKeydown(event, index) {
  let nextIndex = index;
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % adminTabs.length;
  else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + adminTabs.length) % adminTabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = adminTabs.length - 1;
  else return;
  event.preventDefault();
  activateTab(adminTabs[nextIndex].id, true);
}

async function boot() {
  try {
    user.value = await api('/auth/session');
    if (!(user.value.globalRoles ?? []).includes('app_admin')) {
      window.location.href = '/projects';
      return;
    }
    await Promise.all([loadUsers(), loadUnread()]);
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

async function createUser() {
  await run(async () => {
    const created = await api('/admin/users', { method: 'POST', body: newUser.value });
    search.value = created.email;
    usersPage.value = 1;
    newUser.value = { email: '', lastName: '', firstName: '', appAdmin: false };
    await loadUsers();
  });
}

async function toggleAdmin(item) {
  await run(async () => {
    await api(`/admin/users/${item.id}/roles`, {
      method: 'PATCH',
      body: { appAdmin: !(item.globalRoles ?? []).includes('app_admin') },
    });
    await loadUsers();
  });
}

async function toggleBlock(item) {
  await run(async () => {
    await api(`/admin/users/${item.id}/${item.status === 'blocked' ? 'unblock' : 'block'}`, {
      method: 'PATCH',
      body: {},
    });
    await loadUsers();
  });
}

async function deleteUser(item) {
  if (!window.confirm(`Delete ${item.email}?`)) return;
  await run(async () => {
    await api(`/admin/users/${item.id}`, { method: 'DELETE' });
    await loadUsers();
  });
}

function discardSettingsChanges() {
  for (const key of Object.keys(settingsDraft)) delete settingsDraft[key];
  Object.assign(settingsDraft, settingsBaseline.value);
  settingsValidationErrors.value = {};
}

async function saveSettings() {
  if (settingsSaving.value || !hasUnsavedSettings.value) return;
  const validationErrors = validateSystemSettings(settingsDraft);
  settingsValidationErrors.value = validationErrors;
  if (Object.keys(validationErrors).length) {
    error.value = 'Проверьте значения системных настроек.';
    return;
  }

  if (
    changedSettings.value.length > 0 &&
    !window.confirm(
      'Изменения повлияют на парольную политику, блокировки, сессии или сроки действия ссылок. Продолжить сохранение?',
    )
  ) {
    return;
  }

  settingsSaving.value = true;
  error.value = '';
  try {
    const response = await api('/settings', {
      method: 'PUT',
      body: { items: changedSettings.value },
    });
    settingsItems.value = response.items ?? settingsItems.value;
    const nextDraft = settingsDraftFromItems(settingsItems.value);
    for (const key of Object.keys(settingsDraft)) delete settingsDraft[key];
    Object.assign(settingsDraft, nextDraft);
    settingsBaseline.value = { ...nextDraft };
    settingsValidationErrors.value = {};
    toast.success('Настройки сохранены. Новые значения будут применяться к последующим операциям.');
  } catch (reason) {
    error.value = reason.message;
  } finally {
    settingsSaving.value = false;
  }
}

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } finally {
    window.location.href = '/login';
  }
}

onMounted(boot);
</script>

<template>
  <div class="app-shell">
    <AppHeader :user="user" :unread-count="unreadCount" active-page="admin" @logout="logout" />
    <main class="page admin-page">
      <div class="breadcrumbs">
        <a href="/projects" class="back">Проекты</a><span class="sep">/</span><strong>Администрирование</strong>
      </div>
      <header class="page-head admin-header">
        <div>
          <p class="eyebrow">Рабочее пространство</p>
          <h1 class="page-title">Администрирование</h1>
          <p class="page-subtitle">Пользователи, аудит и политики безопасности — в одном рабочем разделе.</p>
        </div>
      </header>

      <p v-if="loading" class="loading-state">Загрузка административной панели...</p>
      <div v-else class="admin-content">
        <div class="admin-tabs-wrap">
          <div class="admin-tabs-heading">
            <p class="eyebrow">Рабочее пространство</p>
            <span>Управляйте доступом, историей действий и политиками безопасности.</span>
          </div>
          <div class="admin-tabs" role="tablist" aria-label="Разделы администрирования">
            <button
              v-for="(tab, index) in adminTabs"
              :key="tab.id"
              :id="`admin-tab-${tab.id}`"
              ref="tabRefs"
              class="admin-tab"
              :class="{ 'admin-tab-active': activeTab === tab.id }"
              type="button"
              role="tab"
              :aria-selected="activeTab === tab.id"
              :aria-controls="`admin-panel-${tab.id}`"
              :tabindex="activeTab === tab.id ? 0 : -1"
              @click="activateTab(tab.id)"
              @keydown="onTabKeydown($event, index)"
            >
              <span class="admin-tab-index">0{{ index + 1 }}</span>
              <span>{{ tab.label }}</span>
              <span v-if="tab.id === 'users'" class="count-badge">{{ usersTotal }}</span>
            </button>
          </div>
        </div>

        <section
          id="admin-panel-users"
          class="admin-tab-panel"
          role="tabpanel"
          aria-labelledby="admin-tab-users"
          v-show="activeTab === 'users'"
        >
          <section class="card admin-card users-card">
            <div class="admin-card-heading">
              <div>
                <p class="eyebrow">Доступ и роли</p>
                <h2>Пользователи <span class="count-badge">{{ usersTotal }}</span></h2>
              </div>
            </div>
            <form class="inline admin-user-form" @submit.prevent="createUser">
              <input v-model="newUser.email" class="input" type="email" placeholder="Email" required />
              <input v-model="newUser.lastName" class="input" placeholder="Фамилия" required />
              <input v-model="newUser.firstName" class="input" placeholder="Имя" required />
              <label class="admin-checkbox"><input v-model="newUser.appAdmin" type="checkbox" /> Админ</label>
              <button class="btn btn-primary" type="submit">Создать пользователя</button>
            </form>
            <div class="admin-toolbar">
              <input v-model="search" class="input" placeholder="Поиск по имени или email" @keyup.enter="searchUsers" />
              <button class="btn btn-secondary" type="button" @click="searchUsers">Найти</button>
            </div>
            <div class="table-wrap">
              <table class="table admin-table users-table">
                <thead>
                  <tr><th>Пользователь</th><th>Email</th><th>Статус</th><th>Роль</th><th>Действия</th></tr>
                </thead>
                <tbody>
                  <tr v-for="item in users" :key="item.id">
                    <td class="name-cell">{{ item.displayName }}</td>
                    <td>{{ item.email }}</td>
                    <td><span class="badge" :class="item.status === 'blocked' ? 'badge-danger' : 'badge-success'">{{ item.status === 'blocked' ? 'заблокирован' : 'активен' }}</span></td>
                    <td>{{ (item.globalRoles ?? []).includes('app_admin') ? 'админ' : 'пользователь' }}</td>
                    <td class="actions-cell">
                      <div class="actions">
                        <button class="btn btn-secondary btn-sm" type="button" @click="toggleAdmin(item)">
                          {{ (item.globalRoles ?? []).includes('app_admin') ? 'Снять админа' : 'Сделать админом' }}
                        </button>
                        <button class="btn btn-secondary btn-sm" type="button" @click="toggleBlock(item)">
                          {{ item.status === 'blocked' ? 'Разблокировать' : 'Заблокировать' }}
                        </button>
                        <button class="btn btn-ghost btn-sm" type="button" @click="deleteUser(item)">Удалить</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <footer class="admin-pagination">
              <span class="pagination-summary">{{ usersPaginationSummary }}</span>
              <div class="pagination-controls">
                <label class="page-size-control">
                  <span>Строк на странице</span>
                  <select v-model.number="usersPerPage" class="input" aria-label="Количество пользователей на странице" @change="setUsersPageSize">
                    <option :value="5">5</option>
                    <option :value="10">10</option>
                  </select>
                </label>
                <nav v-if="usersPageCount > 1" class="page-pagination" aria-label="Страницы пользователей">
                  <button class="btn btn-ghost btn-sm" type="button" aria-label="Предыдущая страница пользователей" :disabled="usersPage === 1" @click="goToUsersPage(usersPage - 1)">‹</button>
                  <button
                    v-for="page in usersPageItems"
                    :key="page"
                    class="btn btn-ghost btn-sm"
                    :class="{ 'page-current': usersPage === page }"
                    type="button"
                    :aria-label="`Страница ${page}`"
                    :aria-current="usersPage === page ? 'page' : undefined"
                    @click="goToUsersPage(page)"
                  >{{ page }}</button>
                  <button class="btn btn-ghost btn-sm" type="button" aria-label="Следующая страница пользователей" :disabled="usersPage === usersPageCount" @click="goToUsersPage(usersPage + 1)">›</button>
                </nav>
              </div>
            </footer>
            <p v-if="!users.length" class="empty-state">Пользователи не найдены.</p>
          </section>
        </section>

        <section
          id="admin-panel-audit"
          class="admin-tab-panel"
          role="tabpanel"
          aria-labelledby="admin-tab-audit"
          v-show="activeTab === 'audit'"
        >
          <section class="card admin-card">
            <div class="admin-card-heading">
              <div>
                <p class="eyebrow">Контроль</p>
                <h2>Журнал аудита</h2>
              </div>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="auditLoading" @click="run(loadAudit)">
                {{ auditLoading ? 'Обновляем…' : 'Обновить' }}
              </button>
            </div>
            <form class="audit-filters" @submit.prevent="run(loadAudit)">
              <input v-model="auditAction" class="input" placeholder="Код события" />
              <input v-model="auditActor" class="input" placeholder="ID пользователя" />
              <button class="btn btn-secondary" type="submit" :disabled="auditLoading">Применить</button>
            </form>
            <div v-if="auditLoading && !audit.length" class="empty-state" role="status">Загружаем журнал…</div>
            <div v-else-if="audit.length" class="audit-list">
              <div v-for="item in audit" :key="item.id" class="audit-row">
                <span class="audit-marker" :class="`severity-${String(item.severity).toLowerCase()}`" />
                <div><strong>{{ item.actionCode }}</strong><span>{{ item.actorUserId || 'system' }} · {{ item.occurredAt }}</span></div>
                <span class="badge badge-neutral">{{ item.severity }}</span>
              </div>
            </div>
            <p v-else class="empty-state">Событий аудита нет.</p>
          </section>
        </section>

        <section
          id="admin-panel-settings"
          class="admin-tab-panel"
          role="tabpanel"
          aria-labelledby="admin-tab-settings"
          v-show="activeTab === 'settings'"
        >
          <form class="card admin-card settings-card" @submit.prevent="saveSettings">
            <div class="admin-card-heading settings-heading">
              <div>
                <p class="eyebrow">Конфигурация</p>
                <h2>Системные настройки</h2>
                <p class="settings-intro">Новые настройки применяются при следующих операциях. Абсолютные сроки созданных сессий и уже выданных ссылок не меняются; срок бездействия сессии обновляется при следующем запросе.</p>
              </div>
              <span v-if="hasUnsavedSettings" class="unsaved-indicator"><span />Есть несохранённые изменения</span>
            </div>

            <div v-if="!settingsLoaded" class="settings-loading" role="status">
              <span class="settings-loading-mark" aria-hidden="true">↻</span>
              Загружаем конфигурацию…
            </div>
            <template v-else>
              <div class="settings-groups">
                <section v-for="group in SYSTEM_SETTING_GROUPS" :key="group.id" class="settings-group">
                  <header class="settings-group-heading">
                    <span class="settings-group-number">{{ group.number }}</span>
                    <div><h3>{{ group.title }}</h3><p>{{ group.description }}</p></div>
                  </header>
                  <div class="settings-fields">
                    <label
                      v-for="field in group.fields"
                      :key="field.key"
                      class="settings-field"
                      :class="{ 'settings-field-toggle': field.type === 'boolean', 'settings-field-wide': field.key === 'third_lockout_permanent' }"
                    >
                      <span class="settings-field-copy">
                        <span class="settings-field-label">{{ field.label }}</span>
                        <span v-if="field.description" class="settings-field-description">{{ field.description }}</span>
                      </span>
                      <span v-if="field.type === 'boolean'" class="settings-toggle-control">
                        <input v-model="settingsDraft[field.key]" type="checkbox" :aria-label="field.label" :aria-describedby="`setting-${field.key}-help`" />
                        <span>{{ settingsDraft[field.key] ? 'Включено' : 'Выключено' }}</span>
                      </span>
                      <span v-else class="settings-number-control">
                        <input
                          :id="`setting-${field.key}`"
                          v-model.number="settingsDraft[field.key]"
                          class="input"
                          type="number"
                          inputmode="numeric"
                          step="1"
                          :min="field.min"
                          :max="field.max"
                          :aria-invalid="Boolean(settingsValidationErrors[field.key])"
                          :aria-describedby="`setting-${field.key}-help${settingsValidationErrors[field.key] ? ` setting-${field.key}-error` : ''}`"
                        />
                        <span class="settings-unit">{{ field.unit }}</span>
                      </span>
                      <span v-if="settingsValidationErrors[field.key]" :id="`setting-${field.key}-error`" class="settings-field-error">{{ settingsValidationErrors[field.key] }}</span>
                      <span :id="`setting-${field.key}-help`" class="visually-hidden">{{ field.description || field.label }}</span>
                    </label>
                  </div>
                </section>
              </div>

              <details v-if="unknownSettings.length" class="unknown-settings">
                <summary>Дополнительные параметры без формы: {{ unknownSettings.length }}</summary>
                <ul>
                  <li v-for="item in unknownSettings" :key="item.key"><code>{{ item.key }}</code><span>{{ item.description || 'Сохранено без изменений.' }}</span></li>
                </ul>
              </details>

              <div class="settings-actions">
                <p class="settings-save-note">Изменения вступают в силу при следующем использовании соответствующего параметра.</p>
                <div class="settings-action-buttons">
                  <button class="btn btn-ghost" type="button" :disabled="settingsSaving || !hasUnsavedSettings" @click="discardSettingsChanges">Отменить изменения</button>
                  <button class="btn btn-primary" type="submit" :disabled="settingsSaving || !hasUnsavedSettings">
                    {{ settingsSaving ? 'Сохраняем…' : 'Сохранить конфигурацию' }}
                  </button>
                </div>
              </div>
            </template>
          </form>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.admin-page {
  max-width: 1480px;
}

.admin-header {
  margin-bottom: 20px;
}

.admin-content {
  display: grid;
  gap: 18px;
}

.admin-tabs-wrap {
  display: grid;
  gap: 14px;
  padding: 0 2px;
}

.admin-tabs-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.admin-tabs-heading .eyebrow {
  margin: 0;
  color: var(--color-primary-700);
}

.admin-tabs {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
  scrollbar-width: thin;
}

.admin-tab {
  position: relative;
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  gap: 9px;
  flex: 0 0 auto;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 650;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease;
}

.admin-tab:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

.admin-tab:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-primary-500);
}

.admin-tab-active {
  color: var(--color-primary-700);
}

.admin-tab-active::after {
  position: absolute;
  right: 12px;
  bottom: -1px;
  left: 12px;
  height: 3px;
  border-radius: var(--radius-pill) var(--radius-pill) 0 0;
  background: var(--color-primary-600);
  content: '';
}

.admin-tab-index {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.admin-tab-active .admin-tab-index {
  color: var(--color-primary-600);
}

.admin-tab-panel {
  min-width: 0;
}

.admin-card {
  min-width: 0;
  padding: 22px;
}

.admin-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.admin-card-heading h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.count-badge {
  display: inline-grid;
  min-width: 24px;
  height: 24px;
  margin-left: 4px;
  padding: 0 6px;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  vertical-align: 2px;
}

.admin-user-form {
  display: grid;
  grid-template-columns: minmax(180px, 1.2fr) repeat(2, minmax(120px, 1fr)) auto auto;
  align-items: center;
  gap: 9px;
  margin-bottom: 12px;
}

.admin-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.admin-checkbox input {
  accent-color: var(--color-primary);
}

.admin-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.admin-toolbar .input {
  max-width: 360px;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.admin-table {
  min-width: 900px;
}

.admin-table .actions {
  min-width: 300px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.admin-table .actions .btn {
  white-space: nowrap;
}

.audit-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 12px;
}

.audit-list {
  display: grid;
  max-height: 360px;
  overflow: auto;
}

.audit-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 11px 4px;
  border-bottom: 1px solid var(--color-border);
}

.audit-row:last-child {
  border-bottom: 0;
}

.audit-marker {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
}

.audit-row > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.audit-row strong {
  color: var(--color-text);
  font-size: var(--text-sm);
}

.audit-row > div span {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audit-marker.severity-critical,
.audit-marker.severity-error {
  background: var(--color-danger-600);
}

.audit-marker.severity-warning {
  background: var(--color-warning-600);
}

.settings-heading {
  align-items: center;
  margin-bottom: 22px;
}

.settings-heading h2 {
  margin-bottom: 8px;
}

.settings-intro {
  max-width: 680px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

.unsaved-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  color: var(--color-warning-700);
  font-size: var(--text-xs);
  font-weight: 650;
}

.unsaved-indicator > span {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--color-warning-600);
  box-shadow: 0 0 0 3px var(--color-warning-100);
}

.settings-loading {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.settings-loading-mark {
  color: var(--color-primary-600);
  font-size: 20px;
  animation: settings-turn 1.2s linear infinite;
}

.settings-groups {
  display: grid;
  gap: 14px;
}

.settings-group {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

.settings-group-heading {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: start;
  gap: 13px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(105deg, var(--color-surface-muted), var(--color-surface));
}

.settings-group-number {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid var(--color-primary-100);
  border-radius: 11px;
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 750;
}

.settings-group-heading h3 {
  margin: 0 0 4px;
  color: var(--color-text);
  font-size: var(--text-md);
}

.settings-group-heading p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
}

.settings-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.settings-field {
  display: grid;
  min-width: 0;
  gap: 11px;
  padding: 17px 20px;
  border-bottom: 1px solid var(--color-border);
}

.settings-field:nth-child(odd):not(:last-child) {
  border-right: 1px solid var(--color-border);
}

.settings-field-wide {
  grid-column: 1 / -1;
  border-right: 0 !important;
}

.settings-field-copy {
  display: grid;
  gap: 4px;
}

.settings-field-label {
  color: var(--color-text);
  font-size: var(--text-sm);
  font-weight: 650;
}

.settings-field-description {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
}

.settings-number-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-number-control .input {
  width: min(100%, 190px);
}

.settings-unit {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.settings-toggle-control {
  display: inline-flex;
  width: fit-content;
  min-height: 38px;
  align-items: center;
  gap: 10px;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: 600;
}

.settings-toggle-control input {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary-600);
}

.settings-field-error {
  color: var(--color-danger-700);
  font-size: var(--text-xs);
}

.unknown-settings {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.unknown-settings summary {
  color: var(--color-text-secondary);
  font-weight: 650;
  cursor: pointer;
}

.unknown-settings ul {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding-left: 20px;
}

.unknown-settings li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--color-border);
}

.settings-save-note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
}

.settings-action-buttons {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.settings-action-buttons .btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

@keyframes settings-turn {
  to { transform: rotate(360deg); }
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.empty-state,
.loading-state {
  padding: 18px;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.admin-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 4px 0;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.pagination-summary { white-space: nowrap; }
.pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-left: auto;
}
.page-size-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.page-size-control .input {
  width: 68px;
  min-height: var(--control-height-sm);
  padding: 4px 8px;
}
.page-pagination {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.page-pagination .btn {
  min-width: 34px;
  justify-content: center;
}
.page-pagination .page-current {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}
.page-pagination .btn:disabled { opacity: 0.45; }

@media (max-width: 1100px) {
  .admin-user-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-user-form .btn {
    justify-self: start;
  }

}

@media (max-width: 820px) {
  .admin-card {
    padding: 18px;
  }
}

@media (max-width: 720px) {
  .admin-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-controls {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }
}

@media (max-width: 560px) {
  .admin-user-form,
  .audit-filters {
    grid-template-columns: 1fr;
  }

  .admin-user-form .input {
    width: 100%;
  }

  .admin-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .admin-toolbar .input {
    max-width: none;
  }
}
</style>
