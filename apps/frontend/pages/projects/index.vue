<script setup>
const currentUser = ref(null);
const projectsByStatus = reactive({ active: [], archived: [], deleted: [] });
const totals = reactive({ active: 0, archived: 0, deleted: 0 });
const activeTab = ref('active');
const search = ref('');
const roleFilter = ref('');
const sortMode = ref('recent');
const loading = ref(true);
const error = ref('');
const unreadCount = ref(0);
const showCreate = ref(false);
const projectForm = reactive({ name: '', description: '' });
const openMenuId = ref('');
const searchInput = ref(null);
const currentPage = ref(1);
const projectsPerPage = 50;
const projectApiPageSize = 200;
const projectApiPageBatchSize = 4;
const toast = useToast();

watch(error, (value) => {
  if (value) toast.error(value);
});

const roleLabels = {
  project_owner: 'Владелец',
  project_manager: 'Руководитель',
  project_editor: 'Редактор',
  project_participant: 'Участник',
  project_viewer: 'Наблюдатель',
};

const visibleProjects = computed(() => {
  const query = search.value.trim().toLowerCase();
  let items = [...(projectsByStatus[activeTab.value] ?? [])];
  if (query) {
    items = items.filter(
      (project) =>
        project.name?.toLowerCase().includes(query) ||
        project.description?.toLowerCase().includes(query),
    );
  }
  if (roleFilter.value) {
    items = items.filter((project) => project.myRole === roleFilter.value);
  }
  items.sort((a, b) =>
    sortMode.value === 'name'
      ? String(a.name).localeCompare(String(b.name), 'ru')
      : new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0),
  );
  return items;
});

const pageCount = computed(() =>
  Math.max(1, Math.ceil(visibleProjects.value.length / projectsPerPage)),
);
const paginatedProjects = computed(() => {
  const start = (currentPage.value - 1) * projectsPerPage;
  return visibleProjects.value.slice(start, start + projectsPerPage);
});
const paginationSummary = computed(() => {
  const total = visibleProjects.value.length;
  if (total === 0) return 'Показано 0 из 0';
  const start = (currentPage.value - 1) * projectsPerPage + 1;
  const end = Math.min(start + projectsPerPage - 1, total);
  return `Показано ${start}–${end} из ${total}`;
});
const paginationItems = computed(() => {
  const count = pageCount.value;
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

  const candidates = [
    ...new Set([1, currentPage.value - 1, currentPage.value, currentPage.value + 1, count]),
  ]
    .filter((page) => page >= 1 && page <= count)
    .sort((a, b) => a - b);
  const items = [];
  let previous = 0;
  for (const page of candidates) {
    if (page - previous > 1) items.push(`ellipsis-${previous}-${page}`);
    items.push(page);
    previous = page;
  }
  return items;
});

watch([activeTab, search, roleFilter, sortMode], () => {
  currentPage.value = 1;
});
watch(pageCount, (count) => {
  if (currentPage.value > count) currentPage.value = count;
});

function goToPage(page) {
  currentPage.value = Math.min(Math.max(page, 1), pageCount.value);
}

function csrfToken() {
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('__Host-csrf='))
    ?.slice('__Host-csrf='.length);
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if ((options.method ?? 'GET') !== 'GET') headers['X-CSRF-Token'] = csrfToken() ?? '';
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 401) window.location.assign('/login');
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
  return response.status === 204 ? null : response.json();
}

async function loadAllProjects(status) {
  const firstPage = await api(
    `/projects?limit=${projectApiPageSize}&offset=0&status=${status}`,
  );
  const items = [...(firstPage.items ?? [])];
  const reportedTotal = Number(firstPage.page?.total);
  const total = Number.isFinite(reportedTotal)
    ? Math.max(reportedTotal, items.length)
    : items.length;
  const reportedLimit = Number(firstPage.page?.limit);
  const pageSize =
    Number.isFinite(reportedLimit) && reportedLimit > 0
      ? reportedLimit
      : projectApiPageSize;
  const offsets = [];

  for (let offset = pageSize; offset < total; offset += pageSize) offsets.push(offset);
  for (let index = 0; index < offsets.length; index += projectApiPageBatchSize) {
    const pages = await Promise.all(
      offsets
        .slice(index, index + projectApiPageBatchSize)
        .map((offset) =>
          api(`/projects?limit=${pageSize}&offset=${offset}&status=${status}`),
        ),
    );
    for (const page of pages) items.push(...(page.items ?? []));
  }

  return { items: items.slice(0, total), total };
}

async function loadProjects() {
  const statuses = ['active', 'archived', 'deleted'];
  const responses = await Promise.all(statuses.map((status) => loadAllProjects(status)));
  statuses.forEach((status, index) => {
    projectsByStatus[status] = responses[index].items;
    totals[status] = responses[index].total;
  });
  currentPage.value = 1;
}

async function loadUnread() {
  try {
    unreadCount.value = (await api('/notifications/unread-count')).count ?? 0;
  } catch {
    unreadCount.value = 0;
  }
}

async function boot() {
  try {
    const session = await api('/auth/session');
    currentUser.value = session?.user ?? session;
    await Promise.all([loadProjects(), loadUnread()]);
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
}

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } finally {
    window.location.href = '/login';
  }
}

function openProject(project) {
  navigateTo(`/projects/${project.id}`);
}

function openGantt(project) {
  navigateTo(`/gantt?project=${project.id}`);
}

function focusFilters() {
  searchInput.value?.focus();
}

function openCreate() {
  projectForm.name = '';
  projectForm.description = '';
  showCreate.value = true;
}

function closeCreate() {
  showCreate.value = false;
}

async function createProject() {
  if (!projectForm.name.trim()) return;
  try {
    await api('/projects', {
      method: 'POST',
      body: { name: projectForm.name, description: projectForm.description },
    });
    closeCreate();
    await loadProjects();
    activeTab.value = 'active';
  } catch (reason) {
    error.value = reason.message;
  }
}

function toggleMenu(project) {
  openMenuId.value = openMenuId.value === project.id ? '' : project.id;
}

async function archiveProject(project) {
  openMenuId.value = '';
  if (!window.confirm(`Архивировать проект «${project.name}»?`)) return;
  try {
    await api(`/projects/${project.id}/archive`, { method: 'POST', body: {} });
    await loadProjects();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function restoreProject(project) {
  openMenuId.value = '';
  try {
    const action = project.status === 'deleted' ? 'restore' : 'unarchive';
    await api(`/projects/${project.id}/${action}`, { method: 'POST', body: {} });
    await loadProjects();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function deleteProject(project) {
  openMenuId.value = '';
  if (!window.confirm(`Удалить проект «${project.name}»?`)) return;
  try {
    await api(`/projects/${project.id}`, { method: 'DELETE' });
    await loadProjects();
  } catch (reason) {
    error.value = reason.message;
  }
}

function ownerName(project) {
  return project.owner?.displayName || 'Владелец';
}

function initialsFromName(name) {
  return String(name || 'П')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function initials(project) {
  return initialsFromName(ownerName(project));
}

function userInitials() {
  return initialsFromName(currentUser.value?.displayName || currentUser.value?.email);
}

function projectTone(project) {
  const code = String(project.id ?? '')
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `tone-${code % 5}`;
}

function formatUpdated(value) {
  if (!value) return '—';
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startOfToday - startOfDate) / 86_400_000);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `Сегодня, ${time}`;
  if (diff === 1) return `Вчера, ${time}`;
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`;
}

onMounted(boot);
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <a class="app-brand" href="/projects"><span class="brand-mark">▥</span><span>RP Gant</span></a>
      <nav class="app-nav">
        <a class="active" href="/projects">Проекты</a>
        <a href="/members">Участники</a>
        <a href="/notifications">Уведомления</a>
        <a href="/profile">Профиль</a>
        <a v-if="currentUser?.globalRoles?.includes('app_admin')" href="/admin">Админка</a>
      </nav>
      <div class="app-header-right">
        <a class="header-icon notification-icon" href="/notifications" aria-label="Уведомления">🔔<span v-if="unreadCount" class="notice-dot">{{ unreadCount }}</span></a>
        <div class="user-chip"><span class="avatar">{{ userInitials() }}</span><span>{{ currentUser?.displayName || currentUser?.email || 'Пользователь' }}</span></div>
        <button class="btn btn-ghost btn-sm" type="button" @click="logout">Выйти</button>
      </div>
    </header>

    <main class="page projects-page">
      <div class="breadcrumbs"><a href="/projects">Рабочее пространство</a><span class="sep">/</span><strong>Проекты</strong></div>

      <div class="projects-head">
        <div>
          <p class="eyebrow">Портфель</p>
          <h1>Проекты</h1>
          <p class="muted">Активные инициативы, сроки и команды в одном месте.</p>
        </div>
        <div class="projects-head-actions">
          <button class="btn btn-secondary" type="button" @click="focusFilters">Фильтр</button>
          <button class="btn btn-primary" type="button" @click="openCreate">＋ Создать проект</button>
        </div>
      </div>

      <div class="project-tabs">
        <button
          v-for="tab in [
            { id: 'active', label: 'Активные' },
            { id: 'archived', label: 'Архив' },
            { id: 'deleted', label: 'Удалённые' },
          ]"
          :key="tab.id"
          type="button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }} <span>{{ totals[tab.id] }}</span>
        </button>
      </div>

      <p v-if="loading" class="muted">Загрузка...</p>

      <section v-else class="projects-card">
        <div class="projects-controls">
          <input
            ref="searchInput"
            v-model="search"
            class="input projects-search"
            placeholder="Найти проект..."
          />
          <div class="projects-controls-right">
            <select v-model="roleFilter" class="input compact-input">
              <option value="">Все роли</option>
              <option v-for="(label, value) in roleLabels" :key="value" :value="value">{{ label }}</option>
            </select>
            <select v-model="sortMode" class="input compact-input">
              <option value="recent">Обновлены недавно</option>
              <option value="name">По названию</option>
            </select>
          </div>
        </div>

        <div class="projects-table">
          <div class="projects-table-head">
            <span>Проект</span>
            <span>Роль</span>
            <span>Диаграммы</span>
            <span>Владелец</span>
            <span>Обновлён</span>
            <span>Действия</span>
          </div>
          <div
            v-for="project in paginatedProjects"
            :key="project.id"
            class="project-row"
            @click="openProject(project)"
          >
            <div class="project-cell">
              <span class="project-icon" :class="projectTone(project)">▥</span>
              <span>
                <strong>{{ project.name }}</strong>
                <small>{{ project.description || 'Без описания' }}</small>
              </span>
            </div>
            <span class="role-chip" :class="project.myRole">{{ roleLabels[project.myRole] || 'Без роли' }}</span>
            <span class="diagram-count">{{ project.diagramsCount ?? 0 }}</span>
            <span class="owner-cell">
              <span class="avatar xs">{{ initials(project) }}</span>
              <span>{{ ownerName(project) }}</span>
            </span>
            <span class="updated-cell">{{ formatUpdated(project.updatedAt) }}</span>
            <span class="actions-cell">
              <button class="btn btn-icon btn-ghost" type="button" @click.stop="toggleMenu(project)">⋯</button>
              <span v-if="openMenuId === project.id" class="project-menu" @click.stop>
                <button type="button" @click="openProject(project)">Открыть проект</button>
                <button type="button" @click="openGantt(project)">Открыть Gantt</button>
                <button v-if="project.status === 'active'" type="button" @click="archiveProject(project)">Архивировать</button>
                <button v-if="project.status === 'archived'" type="button" @click="restoreProject(project)">Вернуть из архива</button>
                <button v-if="project.status === 'deleted'" type="button" @click="restoreProject(project)">Восстановить</button>
                <button v-if="project.status === 'archived'" class="danger" type="button" @click="deleteProject(project)">Удалить</button>
              </span>
            </span>
          </div>
          <p v-if="!visibleProjects.length" class="empty-projects">Проекты не найдены.</p>
        </div>

        <div class="projects-footer">
          <span>{{ paginationSummary }}</span>
          <nav v-if="pageCount > 1" class="pagination" aria-label="Страницы проектов">
            <button
              type="button"
              aria-label="Предыдущая страница"
              :disabled="currentPage === 1"
              @click="goToPage(currentPage - 1)"
            >
              ‹
            </button>
            <template v-for="item in paginationItems" :key="`page-${item}`">
              <span v-if="typeof item !== 'number'" class="pagination-ellipsis" aria-hidden="true">…</span>
              <button
                v-else
                type="button"
                :class="{ active: currentPage === item }"
                :aria-label="`Страница ${item}`"
                :aria-current="currentPage === item ? 'page' : undefined"
                @click="goToPage(item)"
              >
                {{ item }}
              </button>
            </template>
            <button
              type="button"
              aria-label="Следующая страница"
              :disabled="currentPage === pageCount"
              @click="goToPage(currentPage + 1)"
            >
              ›
            </button>
          </nav>
        </div>
      </section>
    </main>

    <div v-if="showCreate" class="modal-backdrop" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="createProject">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Новый проект</p>
            <h2>Создание проекта</h2>
          </div>
          <button class="btn btn-icon btn-ghost" type="button" @click="closeCreate">✕</button>
        </div>
        <label class="field"><span>Название *</span><input v-model="projectForm.name" class="input" required autofocus /></label>
        <label class="field"><span>Описание</span><textarea v-model="projectForm.description" class="textarea" rows="3" /></label>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" @click="closeCreate">Отмена</button>
          <button class="btn btn-primary" type="submit">Создать проект</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.projects-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 18px 34px 40px;
}

.breadcrumbs {
  margin-bottom: 18px;
}

.projects-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.projects-head h1 {
  margin: 2px 0 6px;
  font-size: 34px;
  letter-spacing: -0.03em;
}

.projects-head .eyebrow {
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.projects-head-actions {
  display: flex;
  gap: 10px;
  flex: 0 0 auto;
}

.project-tabs {
  display: flex;
  gap: 26px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 16px;
}

.project-tabs button {
  position: relative;
  padding: 10px 0 12px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.project-tabs button span {
  color: var(--color-text-muted);
  font-weight: 500;
}

.project-tabs button.active {
  color: var(--color-primary);
}

.project-tabs button.active::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--color-primary);
}

.projects-card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  overflow: visible;
}

.projects-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
}

.projects-search {
  width: min(310px, 100%);
}

.projects-controls-right {
  display: flex;
  gap: 10px;
}

.compact-input {
  width: auto;
  min-width: 150px;
}

.projects-table-head,
.project-row {
  display: grid;
  grid-template-columns: minmax(280px, 1.7fr) 0.75fr 0.55fr 1fr 0.9fr 48px;
  align-items: center;
  gap: 16px;
  padding: 0 18px;
}

.projects-table-head {
  min-height: 44px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.project-row {
  min-height: 64px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  transition: background 120ms ease;
}

.project-row:last-of-type {
  border-bottom: 0;
}

.project-row:hover {
  background: #f8fbff;
}

.project-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.project-cell strong,
.project-cell small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-cell strong {
  font-size: 13px;
}

.project-cell small {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11.5px;
}

.project-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  font-size: 15px;
}

.tone-0 { background: #eef2ff; color: #4f46e5; }
.tone-1 { background: #ecfdf5; color: #059669; }
.tone-2 { background: #fff7ed; color: #ea580c; }
.tone-3 { background: #eff6ff; color: #2563eb; }
.tone-4 { background: #fdf2f8; color: #db2777; }

.role-chip {
  justify-self: start;
  padding: 3px 8px;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 10.5px;
  font-weight: 650;
}

.role-chip.project_manager { background: #f1f5f9; color: #334155; }
.role-chip.project_editor { background: #f8fafc; color: #475569; }
.role-chip.project_participant { background: #f8fafc; color: #64748b; }
.role-chip.project_viewer { background: #f8fafc; color: #64748b; }

.diagram-count {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.owner-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}

.owner-cell > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avatar.xs {
  width: 22px;
  height: 22px;
  font-size: 9px;
}

.updated-cell {
  color: var(--color-text-muted);
  font-size: 12px;
}

.actions-cell {
  position: relative;
  justify-self: end;
}

.project-menu {
  position: absolute;
  top: 32px;
  right: 0;
  z-index: 20;
  display: grid;
  min-width: 180px;
  padding: 5px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.project-menu button {
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.project-menu button:hover {
  background: var(--color-surface-subtle);
}

.project-menu button.danger {
  color: var(--color-danger);
}

.empty-projects {
  padding: 30px 18px;
  color: var(--color-text-muted);
  text-align: center;
}

.projects-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 12px;
}

.pagination {
  display: flex;
  gap: 5px;
}

.pagination button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}

.pagination button:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.pagination button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pagination-ellipsis {
  display: grid;
  min-width: 14px;
  place-items: center;
}

.pagination button.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.notification-icon {
  position: relative;
  text-decoration: none;
}

.notice-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--color-danger);
  color: #fff;
  font-size: 9px;
  display: grid;
  place-items: center;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(15 23 42 / 38%);
}

.modal-card {
  display: grid;
  gap: 14px;
  width: min(520px, 100%);
  padding: 22px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.modal-head,
.modal-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-head h2 {
  margin: 2px 0 0;
}

.modal-actions {
  justify-content: flex-end;
  margin-top: 4px;
}

@media (max-width: 900px) {
  .projects-page { padding: 16px; }
  .projects-head { align-items: flex-start; flex-direction: column; }
  .projects-controls { align-items: stretch; flex-direction: column; }
  .projects-controls-right { flex-wrap: wrap; }
  .projects-table-head,
  .project-row { grid-template-columns: minmax(220px, 1fr) 0.8fr 0.8fr 40px; }
  .projects-table-head span:nth-child(3),
  .projects-table-head span:nth-child(5),
  .project-row > :nth-child(3),
  .project-row > :nth-child(5) { display: none; }
}
</style>
