<script setup>
const route = useRoute();
const projectId = String(route.params.id);
const currentUser = ref(null);
const project = ref(null);
const owner = ref(null);
const diagrams = ref([]);
const members = ref([]);
const activeTab = ref('diagrams');
const diagramSearch = ref('');
const diagramSort = ref('recent');
const loading = ref(true);
const error = ref('');
const unreadCount = ref(0);
const showCreateDiagram = ref(false);
const openMenu = ref(false);
const diagramForm = reactive({ name: '', description: '', dayMode: 'working' });
const toast = useToast();

watch(error, (value) => {
  if (value) toast.error(value);
});

const roleLabels = {
  owner: 'Владелец',
  manager: 'Руководитель',
  editor: 'Редактор',
  participant: 'Участник',
  viewer: 'Наблюдатель',
};

const statusLabels = {
  active: 'В работе',
  archived: 'В архиве',
  deleted: 'Удалён',
};

const visibleDiagrams = computed(() => {
  const query = diagramSearch.value.trim().toLowerCase();
  const items = diagrams.value.filter(
    (diagram) =>
      !query ||
      diagram.name?.toLowerCase().includes(query) ||
      diagram.description?.toLowerCase().includes(query),
  );
  return [...items].sort((a, b) =>
    diagramSort.value === 'name'
      ? String(a.name).localeCompare(String(b.name), 'ru')
      : new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0),
  );
});

const ownerName = computed(
  () => owner.value?.displayName || owner.value?.email || 'Владелец проекта',
);

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

async function loadProject() {
  const [projectResponse, diagramResponse, memberResponse, session] = await Promise.all([
    api(`/projects/${projectId}`),
    api(`/projects/${projectId}/diagrams?limit=200`),
    api(`/projects/${projectId}/members?limit=200`),
    api('/auth/session'),
  ]);
  project.value = projectResponse;
  diagrams.value = diagramResponse.items ?? [];
  members.value = memberResponse.items ?? [];
  currentUser.value = session?.user ?? session;
  if (projectResponse.ownerUserId) {
    owner.value = await api(`/users/${projectResponse.ownerUserId}`).catch(() => null);
  }
  try {
    unreadCount.value = (await api('/notifications/unread-count')).count ?? 0;
  } catch {
    unreadCount.value = 0;
  }
}

async function boot() {
  try {
    await loadProject();
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
}

function initialsFromName(name) {
  return String(name || 'П')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function userInitials() {
  return initialsFromName(currentUser.value?.displayName || currentUser.value?.email);
}

function memberInitials(member) {
  return initialsFromName(member.user?.displayName || member.user?.email || member.userId);
}

function ownerInitials() {
  return initialsFromName(ownerName.value);
}

function projectTone() {
  const code = String(projectId ?? '')
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `tone-${code % 5}`;
}

function roleLabel(role) {
  return roleLabels[role] || 'Участник';
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

function openDiagram(diagram) {
  navigateTo(`/gantt?project=${projectId}&diagram=${diagram.id}`);
}

function openGantt() {
  if (diagrams.value.length) {
    openDiagram(diagrams.value[0]);
  } else {
    openCreateDiagram();
  }
}

function openMembers() {
  navigateTo(`/members?project=${projectId}`);
}

function openCreateDiagram() {
  openMenu.value = false;
  diagramForm.name = '';
  diagramForm.description = '';
  diagramForm.dayMode = 'working';
  showCreateDiagram.value = true;
}

function closeCreateDiagram() {
  showCreateDiagram.value = false;
}

async function createDiagram() {
  if (!diagramForm.name.trim()) return;
  try {
    const diagram = await api(`/projects/${projectId}/diagrams`, {
      method: 'POST',
      body: { ...diagramForm },
    });
    closeCreateDiagram();
    toast.success('Диаграмма создана');
    await loadProject();
    openDiagram(diagram);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function archiveProject() {
  openMenu.value = false;
  if (!window.confirm(`Архивировать проект «${project.value.name}»?`)) return;
  try {
    await api(`/projects/${projectId}/archive`, { method: 'POST', body: {} });
    await loadProject();
    toast.success('Проект архивирован');
  } catch (reason) {
    error.value = reason.message;
  }
}

async function restoreProject() {
  openMenu.value = false;
  try {
    const action = project.value.status === 'deleted' ? 'restore' : 'unarchive';
    await api(`/projects/${projectId}/${action}`, { method: 'POST', body: {} });
    await loadProject();
    toast.success('Проект восстановлен');
  } catch (reason) {
    error.value = reason.message;
  }
}

async function deleteProject() {
  openMenu.value = false;
  if (!window.confirm(`Удалить проект «${project.value.name}»?`)) return;
  try {
    await api(`/projects/${projectId}`, { method: 'DELETE' });
    navigateTo('/projects');
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

onMounted(boot);
</script>

<template>
  <div class="app-shell">
    <AppHeader :user="currentUser" :unread-count="unreadCount" active-page="projects" @logout="logout" />

    <main class="page project-page">
      <div class="breadcrumbs">
        <a href="/projects">Проекты</a><span class="sep">/</span><strong>{{ project?.name || 'Проект' }}</strong>
      </div>

      <p v-if="loading" class="muted">Загрузка...</p>

      <template v-if="project">
        <div class="project-head">
          <div class="project-title-wrap">
            <span class="project-icon" :class="projectTone">▥</span>
            <div>
              <p class="eyebrow">Проект</p>
              <div class="project-title-line">
                <h1>{{ project.name }}</h1>
                <span class="status-badge" :class="project.status">{{ statusLabels[project.status] }}</span>
              </div>
              <p class="muted">{{ project.description || 'Без описания' }}</p>
              <div class="project-meta">
                <span>Роль: <strong>{{ roleLabel(project.myRole) }}</strong></span>
                <span>Владелец: <strong>{{ ownerName }}</strong></span>
                <span>Обновлён: <strong>{{ formatUpdated(project.updatedAt) }}</strong></span>
              </div>
            </div>
          </div>
          <div class="project-actions">
            <button class="btn btn-secondary" type="button" @click="openMembers">Участники</button>
            <button class="btn btn-secondary" type="button" @click="openCreateDiagram">＋ Диаграмма</button>
            <button class="btn btn-primary" type="button" :disabled="!diagrams.length" @click="openGantt">Открыть Gantt</button>
            <div class="project-menu-wrap">
              <button class="btn btn-icon btn-secondary" type="button" @click="openMenu = !openMenu">⋯</button>
              <div v-if="openMenu" class="project-menu" @click.stop>
                <button v-if="project.status === 'active'" type="button" @click="archiveProject">Архивировать</button>
                <button v-if="project.status !== 'active'" type="button" @click="restoreProject">
                  {{ project.status === 'deleted' ? 'Восстановить' : 'Вернуть из архива' }}
                </button>
                <button v-if="project.status === 'archived'" class="danger" type="button" @click="deleteProject">Удалить</button>
              </div>
            </div>
          </div>
        </div>

        <div class="project-tabs">
          <button type="button" :class="{ active: activeTab === 'diagrams' }" @click="activeTab = 'diagrams'">
            Диаграммы <span>{{ diagrams.length }}</span>
          </button>
          <button type="button" :class="{ active: activeTab === 'members' }" @click="activeTab = 'members'">
            Участники <span>{{ members.length }}</span>
          </button>
        </div>

        <section v-if="activeTab === 'diagrams'" class="details-card">
          <div class="details-controls">
            <input v-model="diagramSearch" class="input details-search" placeholder="Найти диаграмму..." />
            <select v-model="diagramSort" class="input compact-input">
              <option value="recent">Обновлены недавно</option>
              <option value="name">По названию</option>
            </select>
          </div>
          <div class="details-table diagrams-table">
            <div class="details-head">
              <span>Диаграмма</span><span>Календарь</span><span>Ревизия</span><span>Обновлена</span><span>Действия</span>
            </div>
            <div v-for="diagram in visibleDiagrams" :key="diagram.id" class="details-row" @click="openDiagram(diagram)">
              <div class="diagram-cell">
                <span class="diagram-icon">▤</span>
                <span>
                  <strong>{{ diagram.name }}</strong>
                  <small>{{ diagram.description || 'Без описания' }}</small>
                </span>
              </div>
              <span class="muted">{{ diagram.dayMode === 'calendar' ? 'Календарные' : 'Рабочие' }}</span>
              <span>{{ diagram.currentRevision ?? 0 }}</span>
              <span class="muted">{{ formatUpdated(diagram.updatedAt) }}</span>
              <span class="row-actions"><button class="btn btn-sm btn-secondary" type="button" @click.stop="openDiagram(diagram)">Открыть</button></span>
            </div>
            <p v-if="!visibleDiagrams.length" class="empty-details">Диаграмм пока нет.</p>
          </div>
          <div class="details-footer">Показано {{ visibleDiagrams.length }} из {{ diagrams.length }}</div>
        </section>

        <section v-else class="details-card">
          <div class="details-table members-table">
            <div class="details-head">
              <span>Участник</span><span>Роль</span><span>Email</span><span>В проекте с</span>
            </div>
            <div v-for="member in members" :key="member.userId" class="details-row">
              <span class="member-cell"><span class="avatar xs">{{ memberInitials(member) }}</span>{{ member.user?.displayName || member.user?.email || member.userId }}</span>
              <span class="role-chip" :class="member.role">{{ roleLabel(member.role) }}</span>
              <span class="muted">{{ member.user?.email || '—' }}</span>
              <span class="muted">{{ formatUpdated(member.joinedAt) }}</span>
            </div>
            <p v-if="!members.length" class="empty-details">Участников пока нет.</p>
          </div>
          <div class="details-footer">Показано {{ members.length }} участников</div>
        </section>
      </template>
    </main>

    <div v-if="showCreateDiagram" class="modal-backdrop" @click.self="closeCreateDiagram">
      <form class="modal-card" @submit.prevent="createDiagram">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Новая диаграмма</p>
            <h2>Создание диаграммы</h2>
          </div>
          <button class="btn btn-icon btn-ghost" type="button" @click="closeCreateDiagram">✕</button>
        </div>
        <label class="field"><span>Название *</span><input v-model="diagramForm.name" class="input" required autofocus /></label>
        <label class="field"><span>Описание</span><textarea v-model="diagramForm.description" class="textarea" rows="2" /></label>
        <label class="field">
          <span>Календарь</span>
          <select v-model="diagramForm.dayMode" class="input">
            <option value="working">Рабочие дни</option>
            <option value="calendar">Календарные дни</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" @click="closeCreateDiagram">Отмена</button>
          <button class="btn btn-primary" type="submit">Создать диаграмму</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.project-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 18px 34px 40px;
}

.breadcrumbs {
  margin-bottom: 18px;
}

.project-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.project-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
}

.project-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 11px;
  font-size: 19px;
}

.tone-0 { background: #eef2ff; color: #4f46e5; }
.tone-1 { background: #ecfdf5; color: #059669; }
.tone-2 { background: #fff7ed; color: #ea580c; }
.tone-3 { background: #eff6ff; color: #2563eb; }
.tone-4 { background: #fdf2f8; color: #db2777; }

.eyebrow {
  margin: 0;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.project-title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0 4px;
}

.project-title-line h1 {
  margin: 0;
  font-size: 32px;
  letter-spacing: -0.03em;
}

.status-badge {
  padding: 3px 8px;
  border-radius: 6px;
  background: #dcfce7;
  color: #15803d;
  font-size: 10.5px;
  font-weight: 650;
}

.status-badge.archived { background: #f1f5f9; color: #475569; }
.status-badge.deleted { background: #fee2e2; color: #b91c1c; }

.project-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-top: 10px;
  color: var(--color-text-muted);
  font-size: 11.5px;
}

.project-meta strong {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.project-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.project-menu-wrap {
  position: relative;
}

.project-menu {
  position: absolute;
  top: 36px;
  right: 0;
  z-index: 20;
  display: grid;
  min-width: 190px;
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

.project-menu button:hover { background: var(--color-surface-subtle); }
.project-menu button.danger { color: var(--color-danger); }

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

.project-tabs button span { color: var(--color-text-muted); font-weight: 500; }
.project-tabs button.active { color: var(--color-primary); }
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

.details-card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.details-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
}

.details-search { width: min(310px, 100%); }
.compact-input { width: auto; min-width: 150px; }

.details-head,
.details-row {
  display: grid;
  align-items: center;
  gap: 16px;
  padding: 0 18px;
}

.diagrams-table .details-head,
.diagrams-table .details-row {
  grid-template-columns: minmax(280px, 1.7fr) 0.8fr 0.5fr 0.9fr 100px;
}

.members-table .details-head,
.members-table .details-row {
  grid-template-columns: minmax(220px, 1.3fr) 0.7fr 1.2fr 0.9fr;
}

.details-head {
  min-height: 44px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.details-row {
  min-height: 64px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
}

.details-row:last-of-type { border-bottom: 0; }
.diagrams-table .details-row { cursor: pointer; transition: background 120ms ease; }
.diagrams-table .details-row:hover { background: #f8fbff; }

.diagram-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.diagram-cell strong,
.diagram-cell small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diagram-cell strong { font-size: 13px; }
.diagram-cell small { margin-top: 2px; color: var(--color-text-muted); font-size: 11.5px; }

.diagram-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 15px;
}

.member-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.avatar.xs {
  width: 24px;
  height: 24px;
  font-size: 9px;
}

.role-chip {
  justify-self: start;
  padding: 3px 8px;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 10.5px;
  font-weight: 650;
}

.role-chip.manager { background: #f1f5f9; color: #334155; }
.role-chip.editor { background: #f8fafc; color: #475569; }
.role-chip.participant { background: #f8fafc; color: #64748b; }
.role-chip.viewer { background: #f8fafc; color: #64748b; }

.row-actions { display: flex; justify-content: flex-end; }
.empty-details { padding: 30px 18px; color: var(--color-text-muted); text-align: center; }

.details-footer {
  padding: 12px 18px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 12px;
}

.notification-icon { position: relative; text-decoration: none; }
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

.modal-head, .modal-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-head h2 { margin: 2px 0 0; }
.modal-actions { justify-content: flex-end; margin-top: 4px; }

@media (max-width: 900px) {
  .project-page { padding: 16px; }
  .project-head { flex-direction: column; }
  .project-actions { flex-wrap: wrap; }
  .details-controls { align-items: stretch; flex-direction: column; }
  .diagrams-table .details-head,
  .diagrams-table .details-row { grid-template-columns: minmax(220px, 1fr) 0.8fr 90px; }
  .diagrams-table .details-head span:nth-child(3),
  .diagrams-table .details-head span:nth-child(4),
  .diagrams-table .details-row > :nth-child(3),
  .diagrams-table .details-row > :nth-child(4) { display: none; }
  .members-table .details-head,
  .members-table .details-row { grid-template-columns: minmax(180px, 1fr) 0.7fr 0.8fr; }
  .members-table .details-head span:nth-child(3),
  .members-table .details-row > :nth-child(3) { display: none; }
}
</style>
