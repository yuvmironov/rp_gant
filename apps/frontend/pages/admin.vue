<script setup>
const user = ref(null);
const unreadCount = ref(0);
const users = ref([]);
const audit = ref([]);
const settings = ref('[]');
const error = ref('');
const toast = useToast();
watch(error, (value) => {
  if (value) toast.error(value);
});

const loading = ref(true);
const search = ref('');
const auditAction = ref('');
const auditActor = ref('');
const newUser = ref({ email: '', lastName: '', firstName: '', appAdmin: false });
const executors = ref([]);
const activeProjects = ref([]);
const editingExecutorId = ref('');
const newExecutor = ref({ lastName: '', firstName: '', middleName: '', position: '', projectIds: [] });
const usersPage = ref(1);
const usersPerPage = ref(10);
const usersTotal = ref(0);
const executorsPage = ref(1);
const executorsPerPage = ref(10);
const executorsTotal = ref(0);

const usersPageCount = computed(() => Math.max(1, Math.ceil(usersTotal.value / usersPerPage.value)));
const executorsPageCount = computed(() =>
  Math.max(1, Math.ceil(executorsTotal.value / executorsPerPage.value)),
);
const usersPageItems = computed(() => paginationItems(usersPage.value, usersPageCount.value));
const executorsPageItems = computed(() =>
  paginationItems(executorsPage.value, executorsPageCount.value),
);
const usersPaginationSummary = computed(() =>
  paginationSummary(usersPage.value, usersPerPage.value, usersTotal.value),
);
const executorsPaginationSummary = computed(() =>
  paginationSummary(executorsPage.value, executorsPerPage.value, executorsTotal.value),
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
  const query = new URLSearchParams({ limit: '50' });
  if (auditAction.value) query.set('actionCode', auditAction.value);
  if (auditActor.value) query.set('actorUserId', auditActor.value);
  audit.value = (await api(`/audit/events?${query}`)).items ?? [];
}

async function loadActiveProjects() {
  const items = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const response = await api(`/projects?${new URLSearchParams({ limit: '200', offset: String(offset), status: 'active' })}`);
    items.push(...(response.items ?? []));
    total = Number(response.page?.total ?? items.length);
    offset += (response.items ?? []).length;
    if (!(response.items ?? []).length) break;
  }
  activeProjects.value = items;
}

async function loadExecutors() {
  const query = new URLSearchParams({
    limit: String(executorsPerPage.value),
    offset: String((executorsPage.value - 1) * executorsPerPage.value),
    includeInactive: 'true',
  });
  const response = await api(`/executors?${query}`);
  executors.value = response.items ?? [];
  executorsTotal.value = Number(response.page?.total ?? executors.value.length);
  if (executorsPage.value > executorsPageCount.value) {
    executorsPage.value = executorsPageCount.value;
    return loadExecutors();
  }
}

function setExecutorsPageSize() {
  executorsPage.value = 1;
  return run(loadExecutors);
}

function goToExecutorsPage(page) {
  const nextPage = Math.min(Math.max(page, 1), executorsPageCount.value);
  if (nextPage === executorsPage.value) return;
  executorsPage.value = nextPage;
  return run(loadExecutors);
}

async function loadUnread() {
  unreadCount.value = (await api('/notifications/unread-count').catch(() => ({ count: 0 }))).count ?? 0;
}

async function saveExecutor() {
  await run(async () => {
    const editing = Boolean(editingExecutorId.value);
    const path = editing ? `/executors/${editingExecutorId.value}` : '/executors';
    await api(path, {
      method: editing ? 'PATCH' : 'POST',
      body: newExecutor.value,
    });
    cancelExecutorEdit();
    await loadExecutors();
  });
}

function editExecutor(item) {
  editingExecutorId.value = item.id;
  newExecutor.value = {
    lastName: item.lastName,
    firstName: item.firstName,
    middleName: item.middleName ?? '',
    position: item.position ?? '',
    projectIds: (item.projectIds ?? []).filter((id) => activeProjects.value.some((project) => project.id === id)),
  };
}

function cancelExecutorEdit() {
  editingExecutorId.value = '';
  newExecutor.value = { lastName: '', firstName: '', middleName: '', position: '', projectIds: [] };
}

function executorProjectNames(item) {
  const names = (item.projectIds ?? [])
    .map((id) => activeProjects.value.find((project) => project.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(', ') : 'Нет активных проектов — недоступен в назначениях';
}

async function deactivateExecutor(item) {
  await run(async () => {
    await api(`/executors/${item.id}`, { method: 'DELETE' });
    await loadExecutors();
  });
}

async function loadSettings() {
  settings.value = JSON.stringify((await api('/settings')).items ?? [], null, 2);
}

async function boot() {
  try {
    user.value = await api('/auth/session');
    if (!(user.value.globalRoles ?? []).includes('app_admin')) {
      window.location.href = '/projects';
      return;
    }
    await Promise.all([loadUsers(), loadAudit(), loadSettings(), loadExecutors(), loadActiveProjects(), loadUnread()]);
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

async function saveSettings() {
  await run(async () => {
    await api('/settings', { method: 'PUT', body: { items: JSON.parse(settings.value) } });
  });
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
          <p class="page-subtitle">Управление доступом, каталогом исполнителей и системными событиями.</p>
        </div>
      </header>

      <p v-if="loading" class="loading-state">Загрузка административной панели...</p>
      <div v-else class="admin-grid">
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

        <section class="card admin-card">
          <div class="admin-card-heading">
            <div>
              <p class="eyebrow">Исполнители</p>
              <h2>Каталог <span class="count-badge">{{ executorsTotal }}</span></h2>
            </div>
          </div>
          <form class="executor-form" @submit.prevent="saveExecutor">
            <div class="executor-fields">
              <input v-model="newExecutor.lastName" class="input" placeholder="Фамилия" required />
              <input v-model="newExecutor.firstName" class="input" placeholder="Имя" required />
              <input v-model="newExecutor.middleName" class="input" placeholder="Отчество" />
              <input v-model="newExecutor.position" class="input" placeholder="Должность" />
            </div>
            <label class="executor-project-picker">
              <span>Проекты, в которых доступен исполнитель <b>· обязательно</b></span>
              <select v-model="newExecutor.projectIds" class="input" multiple required size="4" aria-label="Проекты исполнителя">
                <option v-for="project in activeProjects" :key="project.id" :value="project.id">{{ project.name }}</option>
              </select>
              <small v-if="!activeProjects.length">Нет активных проектов для выбора.</small>
              <small v-else>Можно выбрать несколько проектов. Участие не выдаёт пользователю доступ к проекту.</small>
            </label>
            <div class="executor-form-actions">
              <button class="btn btn-secondary" type="submit" :disabled="!activeProjects.length">
                {{ editingExecutorId ? 'Сохранить' : 'Добавить' }}
              </button>
              <button v-if="editingExecutorId" class="btn btn-ghost" type="button" @click="cancelExecutorEdit">Отмена</button>
            </div>
          </form>
          <div class="table-wrap">
            <table class="table admin-table executor-table">
              <thead><tr><th>ФИО</th><th>Должность</th><th>Доступен в проектах</th><th>Действия</th></tr></thead>
              <tbody>
                <tr v-for="item in executors" :key="item.id">
                  <td class="name-cell">{{ item.fullName }}<span v-if="!item.isActive" class="executor-inactive">Неактивен</span></td>
                  <td>{{ item.position || '—' }}</td>
                  <td>{{ executorProjectNames(item) }}</td>
                  <td class="actions-cell">
                    <div class="actions executor-actions">
                      <button class="btn btn-secondary btn-sm" type="button" @click="editExecutor(item)">Изменить</button>
                      <button class="btn btn-ghost btn-sm" type="button" @click="deactivateExecutor(item)">Деактивировать</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer class="admin-pagination">
            <span class="pagination-summary">{{ executorsPaginationSummary }}</span>
            <div class="pagination-controls">
              <label class="page-size-control">
                <span>Строк на странице</span>
                <select v-model.number="executorsPerPage" class="input" aria-label="Количество исполнителей на странице" @change="setExecutorsPageSize">
                  <option :value="5">5</option>
                  <option :value="10">10</option>
                </select>
              </label>
              <nav v-if="executorsPageCount > 1" class="page-pagination" aria-label="Страницы исполнителей">
                <button class="btn btn-ghost btn-sm" type="button" aria-label="Предыдущая страница исполнителей" :disabled="executorsPage === 1" @click="goToExecutorsPage(executorsPage - 1)">‹</button>
                <button
                  v-for="page in executorsPageItems"
                  :key="page"
                  class="btn btn-ghost btn-sm"
                  :class="{ 'page-current': executorsPage === page }"
                  type="button"
                  :aria-label="`Страница ${page}`"
                  :aria-current="executorsPage === page ? 'page' : undefined"
                  @click="goToExecutorsPage(page)"
                >{{ page }}</button>
                <button class="btn btn-ghost btn-sm" type="button" aria-label="Следующая страница исполнителей" :disabled="executorsPage === executorsPageCount" @click="goToExecutorsPage(executorsPage + 1)">›</button>
              </nav>
            </div>
          </footer>
          <p v-if="!executors.length" class="empty-state">Каталог исполнителей пуст.</p>
        </section>

        <section class="card admin-card">
          <div class="admin-card-heading">
            <div>
              <p class="eyebrow">Контроль</p>
              <h2>Журнал аудита</h2>
            </div>
          </div>
          <form class="audit-filters" @submit.prevent="loadAudit">
            <input v-model="auditAction" class="input" placeholder="Код события" />
            <input v-model="auditActor" class="input" placeholder="ID пользователя" />
            <button class="btn btn-secondary" type="submit">Применить</button>
          </form>
          <div v-if="audit.length" class="audit-list">
            <div v-for="item in audit" :key="item.id" class="audit-row">
              <span class="audit-marker" :class="`severity-${String(item.severity).toLowerCase()}`" />
              <div><strong>{{ item.actionCode }}</strong><span>{{ item.actorUserId || 'system' }} · {{ item.occurredAt }}</span></div>
              <span class="badge badge-neutral">{{ item.severity }}</span>
            </div>
          </div>
          <p v-else class="empty-state">Событий аудита нет.</p>
        </section>

        <section class="card admin-card settings-card">
          <div class="admin-card-heading">
            <div>
              <p class="eyebrow">Конфигурация</p>
              <h2>Системные настройки</h2>
            </div>
          </div>
          <textarea v-model="settings" class="textarea settings-editor" rows="12" spellcheck="false" />
          <div class="form-actions"><button class="btn btn-primary" type="button" @click="saveSettings">Сохранить настройки</button></div>
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

.admin-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 16px;
}

.admin-card {
  min-width: 0;
  padding: 20px;
}

.users-card,
.settings-card {
  grid-column: 1 / -1;
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

.executor-form {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}

.executor-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(100px, 1fr));
  gap: 8px;
}

.executor-project-picker {
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.executor-project-picker b {
  color: var(--color-danger);
  font-weight: 600;
}

.executor-project-picker select {
  min-height: 112px;
}

.executor-project-picker small {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.executor-form-actions {
  display: flex;
  gap: 8px;
}

.executor-inactive {
  display: block;
  color: var(--color-danger);
  font-size: var(--text-xs);
}

.executor-form .input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.executor-form .btn {
  white-space: nowrap;
}

.executor-table {
  min-width: 760px;
  table-layout: fixed;
}

.executor-table th:nth-child(1) { width: 24%; }
.executor-table th:nth-child(2) { width: 16%; }
.executor-table th:nth-child(3) { width: 34%; }
.executor-table th:nth-child(4) { width: 26%; }
.executor-table .actions {
  min-width: 0;
  justify-content: flex-end;
}
.actions-cell { vertical-align: middle; }
.executor-actions { justify-content: flex-end; }
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

.settings-editor {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
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

  .executor-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .admin-grid {
    grid-template-columns: 1fr;
  }

  .users-card,
  .settings-card {
    grid-column: auto;
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
  .executor-fields,
  .audit-filters {
    grid-template-columns: 1fr;
  }

  .admin-user-form .input,
  .executor-form .input {
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
