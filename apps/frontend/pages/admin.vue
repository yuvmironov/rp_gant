<script setup>
const user = ref(null);
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
const newExecutor = ref({ lastName: '', firstName: '', middleName: '', position: '' });
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

async function createExecutor() {
  await run(async () => {
    await api('/executors', { method: 'POST', body: newExecutor.value });
    newExecutor.value = { lastName: '', firstName: '', middleName: '', position: '' };
    await loadExecutors();
  });
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
    await Promise.all([loadUsers(), loadAudit(), loadSettings(), loadExecutors()]);
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

onMounted(boot);
</script>

<template>
  <main class="admin-page">
    <header class="admin-header">
      <div>
        <a href="/projects" class="back">← Проекты</a>
        <h1>Администрирование</h1>
      </div>
      <span>{{ user?.displayName ?? user?.email }}</span>
    </header>

    <p v-if="loading">Загрузка...</p>

    <section class="card">
      <h2>Пользователи</h2>
      <form class="inline" @submit.prevent="createUser">
        <input v-model="newUser.email" type="email" placeholder="Email" required />
        <input v-model="newUser.lastName" placeholder="Фамилия" required />
        <input v-model="newUser.firstName" placeholder="Имя" required />
        <label><input v-model="newUser.appAdmin" type="checkbox" /> Админ</label>
        <button type="submit">Создать</button>
      </form>
      <div class="inline admin-toolbar">
        <input v-model="search" placeholder="Поиск" @keyup.enter="searchUsers" />
        <button type="button" @click="searchUsers">Найти</button>
      </div>
      <div class="table-wrap">
        <table class="users-table">
          <thead>
            <tr><th>Пользователь</th><th>Email</th><th>Статус</th><th>Роль</th><th>Действия</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in users" :key="item.id">
              <td>{{ item.displayName }}</td>
              <td>{{ item.email }}</td>
              <td>{{ item.status === 'blocked' ? 'заблокирован' : 'активен' }}</td>
              <td>{{ (item.globalRoles ?? []).includes('app_admin') ? 'админ' : 'пользователь' }}</td>
              <td class="actions-cell">
                <div class="actions">
                  <button type="button" @click="toggleAdmin(item)">
                    {{ (item.globalRoles ?? []).includes('app_admin') ? 'Снять админа' : 'Сделать админом' }}
                  </button>
                  <button type="button" @click="toggleBlock(item)">
                    {{ item.status === 'blocked' ? 'Разблокировать' : 'Заблокировать' }}
                  </button>
                  <button type="button" @click="deleteUser(item)">Удалить</button>
                </div>
              </td>
            </tr>
            <tr v-if="!users.length"><td colspan="5" class="empty-row">Пользователи не найдены.</td></tr>
          </tbody>
        </table>
      </div>
      <footer class="pagination-footer">
        <span class="pagination-summary">{{ usersPaginationSummary }}</span>
        <div class="pagination-controls">
          <label class="page-size-control">
            <span>Показывать:</span>
            <select v-model.number="usersPerPage" aria-label="Количество пользователей на странице" @change="setUsersPageSize">
              <option :value="5">5</option>
              <option :value="10">10</option>
            </select>
          </label>
          <nav v-if="usersPageCount > 1" class="page-pagination" aria-label="Страницы пользователей">
            <button type="button" aria-label="Предыдущая страница пользователей" :disabled="usersPage === 1" @click="goToUsersPage(usersPage - 1)">‹</button>
            <button
              v-for="page in usersPageItems"
              :key="page"
              type="button"
              :class="{ current: usersPage === page }"
              :aria-label="`Страница ${page}`"
              :aria-current="usersPage === page ? 'page' : undefined"
              @click="goToUsersPage(page)"
            >{{ page }}</button>
            <button type="button" aria-label="Следующая страница пользователей" :disabled="usersPage === usersPageCount" @click="goToUsersPage(usersPage + 1)">›</button>
          </nav>
        </div>
      </footer>
    </section>

    <section class="card">
      <h2>Каталог исполнителей</h2>
      <form class="executor-form" @submit.prevent="createExecutor">
        <input v-model="newExecutor.lastName" placeholder="Фамилия" required />
        <input v-model="newExecutor.firstName" placeholder="Имя" required />
        <input v-model="newExecutor.middleName" placeholder="Отчество" />
        <input v-model="newExecutor.position" placeholder="Должность" />
        <button type="submit">Добавить</button>
      </form>
      <div class="table-wrap">
        <table class="executor-table">
          <thead>
            <tr><th>ФИО</th><th>Должность</th><th>Связан с пользователем</th><th>Действия</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in executors" :key="item.id">
              <td>{{ item.fullName }}</td>
              <td>{{ item.position || '—' }}</td>
              <td><code class="linked-user-id">{{ item.linkedUserId || '—' }}</code></td>
              <td class="actions-cell">
                <div class="actions executor-actions">
                  <button type="button" @click="deactivateExecutor(item)">Деактивировать</button>
                </div>
              </td>
            </tr>
            <tr v-if="!executors.length"><td colspan="4" class="empty-row">Каталог исполнителей пуст.</td></tr>
          </tbody>
        </table>
      </div>
      <footer class="pagination-footer">
        <span class="pagination-summary">{{ executorsPaginationSummary }}</span>
        <div class="pagination-controls">
          <label class="page-size-control">
            <span>Показывать:</span>
            <select v-model.number="executorsPerPage" aria-label="Количество исполнителей на странице" @change="setExecutorsPageSize">
              <option :value="5">5</option>
              <option :value="10">10</option>
            </select>
          </label>
          <nav v-if="executorsPageCount > 1" class="page-pagination" aria-label="Страницы исполнителей">
            <button type="button" aria-label="Предыдущая страница исполнителей" :disabled="executorsPage === 1" @click="goToExecutorsPage(executorsPage - 1)">‹</button>
            <button
              v-for="page in executorsPageItems"
              :key="page"
              type="button"
              :class="{ current: executorsPage === page }"
              :aria-label="`Страница ${page}`"
              :aria-current="executorsPage === page ? 'page' : undefined"
              @click="goToExecutorsPage(page)"
            >{{ page }}</button>
            <button type="button" aria-label="Следующая страница исполнителей" :disabled="executorsPage === executorsPageCount" @click="goToExecutorsPage(executorsPage + 1)">›</button>
          </nav>
        </div>
      </footer>
    </section>

    <section class="card">
      <h2>Audit</h2>
      <div class="inline">
        <input v-model="auditAction" placeholder="Action code" />
        <input v-model="auditActor" placeholder="Actor user id" />
        <button type="button" @click="loadAudit">Применить</button>
      </div>
      <div class="list">
        <div v-for="item in audit" :key="item.id" class="list-item">
          <strong>{{ item.actionCode }}</strong>
          <span>{{ item.actorUserId || 'system' }} · {{ item.severity }} · {{ item.occurredAt }}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Системные настройки</h2>
      <textarea v-model="settings" rows="12" />
      <button type="button" @click="saveSettings">Сохранить</button>
    </section>
  </main>
</template>

<style scoped>
.admin-page {
  box-sizing: border-box;
  width: min(100%, 1200px);
  margin: 0 auto;
  padding: 24px;
  color: #1f2937;
  font-family: Inter, system-ui, sans-serif;
}
.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.back {
  color: #2563eb;
  text-decoration: none;
  font-size: 14px;
}
h1 { margin: 4px 0 0; font-size: 28px; }
h2 { margin: 0 0 16px; font-size: 18px; }
.card {
  min-width: 0;
  margin-bottom: 20px;
  padding: 20px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
}
.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
input, textarea, button, select {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
}
textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; }
button {
  border-color: #111827;
  background: #111827;
  color: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button:focus-visible, select:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.admin-toolbar input {
  width: min(100%, 340px);
}
.executor-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.executor-form input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.executor-form button {
  white-space: nowrap;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid #e5e7eb;
  border-radius: 9px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.users-table {
  min-width: 940px;
  table-layout: fixed;
}
.users-table th:nth-child(1) { width: 18%; }
.users-table th:nth-child(2) { width: 22%; }
.users-table th:nth-child(3) { width: 15%; }
.users-table th:nth-child(4) { width: 14%; }
.users-table th:nth-child(5) { width: 31%; }
.executor-table {
  min-width: 760px;
  table-layout: fixed;
}
.executor-table th:nth-child(1) { width: 24%; }
.executor-table th:nth-child(2) { width: 21%; }
.executor-table th:nth-child(3) { width: 37%; }
.executor-table th:nth-child(4) { width: 18%; }
th, td {
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: middle;
}
th {
  background: #f9fafb;
  color: #4b5563;
  font-size: 12px;
  font-weight: 650;
}
tbody tr:last-child td { border-bottom: 0; }
.actions-cell { vertical-align: middle; }
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.actions button {
  padding: 5px 8px;
  font-size: 12px;
}
.executor-actions { justify-content: flex-end; }
.linked-user-id {
  display: inline-block;
  max-width: 100%;
  color: #4b5563;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-wrap: anywhere;
}
.empty-row {
  padding: 24px 12px;
  color: #6b7280;
  text-align: center;
}
.pagination-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 2px 0;
  color: #6b7280;
  font-size: 13px;
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
  gap: 7px;
  white-space: nowrap;
}
.page-size-control select {
  min-width: 64px;
  height: 36px;
  padding: 0 8px;
  background: #fff;
  color: #1f2937;
  cursor: pointer;
}
.page-pagination {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
}
.page-pagination button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  border: 0;
  border-right: 1px solid #e5e7eb;
  border-radius: 0;
  background: transparent;
  color: #374151;
  font-size: 15px;
}
.page-pagination button:last-child { border-right: 0; }
.page-pagination button:hover:not(:disabled),
.page-pagination button.current {
  background: #eff6ff;
  color: #1d4ed8;
}
.page-pagination button.current {
  box-shadow: inset 0 -2px #2563eb;
  font-weight: 700;
}
.page-pagination button:disabled { opacity: 0.4; }
.list { display: grid; gap: 8px; max-height: 360px; overflow: auto; }
.list-item { display: grid; gap: 3px; padding: 10px; background: #f9fafb; border-radius: 8px; }
.list-item span { color: #6b7280; font-size: 12px; }
.error { color: #b91c1c; }
@media (max-width: 900px) {
  .executor-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .executor-form button { justify-self: start; }
}
@media (max-width: 720px) {
  .admin-page { padding: 14px; }
  .admin-header { align-items: flex-start; flex-direction: column; }
}
@media (max-width: 560px) {
  .card { padding: 14px; }
  .executor-form { grid-template-columns: minmax(0, 1fr); }
  .executor-form button { width: 100%; }
  .pagination-footer { align-items: flex-start; flex-direction: column; }
  .pagination-controls {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }
}
</style>
