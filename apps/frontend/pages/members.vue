<script setup>
import { availableProjectUsers, pendingProjectInvitations } from '~/utils/members.js';

const PAGE_SIZE = 200;
const MIN_USER_SEARCH_LENGTH = 2;
const projects = ref([]);
const currentUser = ref(null);
const unreadCount = ref(0);
const projectId = ref('');
const members = ref([]);
const invitations = ref([]);
const error = ref('');
const toast = useToast();
watch(error, (value) => {
  if (value) toast.error(value);
});

const loading = ref(true);
const membersLoading = ref(false);
const form = ref({ userId: '', role: 'editor' });
const selectedUser = ref(null);
const userSearchResults = ref([]);
const userSearchLoading = ref(false);
const pendingInvitations = computed(() =>
  pendingProjectInvitations(invitations.value, members.value),
);
const projectOptions = computed(() =>
  projects.value.map((project) => ({ value: project.id, label: project.name })),
);
const availableUserOptions = computed(() =>
  availableProjectUsers(userSearchResults.value, members.value, invitations.value).map((user) => ({
    value: user.id,
    label: user.displayName || user.email,
    description: [user.email, user.position].filter(Boolean).join(' · '),
    user,
  })),
);

let membersRequestId = 0;
let userSearchRequestId = 0;
let userSearchTimer;

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
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
  return response.status === 204 ? null : response.json();
}

async function loadAllPages(path, filters = {}) {
  const items = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const query = new URLSearchParams({
      ...filters,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const response = await api(`${path}?${query}`);
    const pageItems = response.items ?? [];
    items.push(...pageItems);
    total = Number(response.page?.total ?? items.length);
    if (!pageItems.length) break;
    offset += pageItems.length;
  }
  return items;
}

function initials(name) {
  return String(name || 'Пользователь')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function roleLabel(role) {
  return {
    owner: 'Владелец',
    manager: 'Менеджер',
    editor: 'Редактор',
    participant: 'Участник',
    viewer: 'Наблюдатель',
  }[role] ?? role;
}

function resetUserSearch() {
  userSearchRequestId += 1;
  clearTimeout(userSearchTimer);
  userSearchResults.value = [];
  userSearchLoading.value = false;
}

function clearUserSelection() {
  form.value = { userId: '', role: 'editor' };
  selectedUser.value = null;
  resetUserSearch();
}

async function loadProject() {
  loading.value = true;
  try {
    const session = await api('/auth/session');
    currentUser.value = session?.user ?? session;
    projects.value = await loadAllPages('/projects');
    unreadCount.value = (await api('/notifications/unread-count').catch(() => ({ count: 0 }))).count ?? 0;
    const query = new URLSearchParams(window.location.search).get('project');
    projectId.value = query || projects.value[0]?.id || '';
    await loadMembers();
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
}

async function loadMembers() {
  const requestedProjectId = projectId.value;
  const requestId = ++membersRequestId;
  if (!requestedProjectId) {
    members.value = [];
    invitations.value = [];
    membersLoading.value = false;
    return;
  }
  membersLoading.value = true;
  try {
    const [memberResult, invitationResult] = await Promise.allSettled([
      loadAllPages(`/projects/${requestedProjectId}/members`),
      loadAllPages(`/projects/${requestedProjectId}/invitations`),
    ]);
    if (requestId !== membersRequestId || requestedProjectId !== projectId.value) return;
    if (memberResult.status === 'rejected') throw memberResult.reason;
    members.value = memberResult.value;
    invitations.value = invitationResult.status === 'fulfilled' ? invitationResult.value : [];
  } finally {
    if (requestId === membersRequestId) membersLoading.value = false;
  }
}

async function changeProject(value) {
  if (String(value ?? '') === projectId.value) return;
  projectId.value = String(value ?? '');
  members.value = [];
  invitations.value = [];
  clearUserSelection();
  error.value = '';
  try {
    await loadMembers();
  } catch (reason) {
    error.value = reason.message;
  }
}

function searchAvailableUsers(value) {
  resetUserSearch();
  const query = String(value ?? '').trim();
  if (query && selectedUser.value) {
    selectedUser.value = null;
    form.value.userId = '';
  }
  if (query.length < MIN_USER_SEARCH_LENGTH || !projectId.value) return;

  const requestId = userSearchRequestId;
  const requestedProjectId = projectId.value;
  userSearchLoading.value = true;
  userSearchTimer = setTimeout(async () => {
    try {
      const results = await loadAllPages('/users', { query });
      if (requestId === userSearchRequestId && requestedProjectId === projectId.value) {
        userSearchResults.value = results;
      }
    } catch (reason) {
      if (requestId === userSearchRequestId) error.value = reason.message;
    } finally {
      if (requestId === userSearchRequestId) userSearchLoading.value = false;
    }
  }, 250);
}

function selectUser(option) {
  selectedUser.value = option.user;
  form.value = { ...form.value, userId: String(option.value) };
}

async function run(action) {
  error.value = '';
  try {
    await action();
    await loadMembers();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function invite() {
  const user = selectedUser.value;
  if (!user) {
    error.value = 'Сначала выберите участника из списка.';
    return;
  }
  await run(async () => {
    await api(`/projects/${projectId.value}/invitations`, {
      method: 'POST',
      body: { email: user.email, role: form.value.role },
    });
    clearUserSelection();
  });
}

async function changeRole(member, role) {
  await run(async () => {
    await api(`/projects/${projectId.value}/members/${member.userId}`, {
      method: 'PATCH',
      body: { role },
    });
  });
}

async function removeMember(member) {
  if (!window.confirm(`Удалить ${member.user?.email ?? member.userId}?`)) return;
  await run(async () => {
    await api(`/projects/${projectId.value}/members/${member.userId}`, { method: 'DELETE' });
  });
}

async function resendInvitation(invitation) {
  await run(async () => {
    await api(`/invitations/${invitation.id}/resend`, { method: 'POST' });
  });
}

async function revokeInvitation(invitation) {
  await run(async () => {
    await api(`/invitations/${invitation.id}`, { method: 'DELETE' });
  });
}

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } finally {
    window.location.href = '/login';
  }
}

onBeforeUnmount(() => clearTimeout(userSearchTimer));
onMounted(loadProject);
</script>

<template>
  <div class="app-shell">
    <AppHeader :user="currentUser" :unread-count="unreadCount" active-page="members" @logout="logout" />
    <main class="page members-page">
      <div class="breadcrumbs">
        <a href="/projects" class="back">Проекты</a><span class="sep">/</span><strong>Участники</strong>
      </div>
      <header class="page-head members-header">
        <div>
          <p class="eyebrow">Команда проекта</p>
          <h1 class="page-title">Участники</h1>
          <p class="page-subtitle">Управляйте доступом и приглашениями в проект.</p>
        </div>
        <SearchableSelect
          id="project-select"
          class="project-picker"
          label="Проект"
          :model-value="projectId"
          :options="projectOptions"
          placeholder="Найти проект"
          search-placeholder="Введите название проекта"
          empty-text="Проекты не найдены."
          @update:model-value="changeProject"
        />
      </header>

      <p v-if="loading" class="loading-state">Загрузка участников...</p>
      <div v-else-if="!projectId" class="card empty-state">Нет доступных проектов.</div>
      <p v-else-if="membersLoading" class="card empty-state" role="status">Загружаем состав проекта…</p>
      <div v-else class="members-content">
        <section class="card members-card invite-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Новый доступ</p>
              <h2>Добавить участника</h2>
              <p class="section-description">Выберите активный аккаунт с подтверждённым email.</p>
            </div>
          </div>
          <form class="inline invite-form" @submit.prevent="invite">
            <SearchableSelect
              id="available-user-select"
              label="Участник"
              :model-value="form.userId"
              :options="availableUserOptions"
              :loading="userSearchLoading"
              :remote="true"
              :min-search-length="MIN_USER_SEARCH_LENGTH"
              min-search-text="Введите не менее двух символов имени или email."
              search-placeholder="Имя или email"
              empty-text="Доступные участники не найдены."
              placeholder="Поиск участника"
              @search="searchAvailableUsers"
              @update:model-value="form.userId = String($event)"
              @select="selectUser"
            />
            <label class="member-role-field">
              <span>Роль в проекте</span>
              <select id="member-role" v-model="form.role" class="input">
                <option value="manager">Менеджер</option>
                <option value="editor">Редактор</option>
                <option value="participant">Участник</option>
                <option value="viewer">Наблюдатель</option>
              </select>
            </label>
            <button class="btn btn-primary" type="submit" :disabled="!selectedUser || userSearchLoading">
              Добавить участника
            </button>
          </form>
        </section>

        <section class="card members-card">
          <div class="section-heading section-heading-row">
            <div>
              <p class="eyebrow">Доступ к проекту</p>
              <h2>Состав команды <span class="count-badge">{{ members.length }}</span></h2>
            </div>
          </div>
          <div v-if="members.length" class="list">
            <div v-for="member in members" :key="member.userId" class="list-item">
              <div class="member-identity">
                <span class="avatar">{{ initials(member.user?.displayName || member.user?.email) }}</span>
                <span class="member-copy">
                  <strong>{{ member.user?.displayName || member.user?.email }}</strong>
                  <span>{{ member.user?.email }}</span>
                </span>
                <span class="badge" :class="member.role === 'owner' ? 'badge-primary' : 'badge-neutral'">
                  {{ roleLabel(member.role) }}
                </span>
              </div>
              <div v-if="member.role !== 'owner'" class="actions">
                <select class="input role-select" :value="member.role" :aria-label="`Роль участника ${member.user?.displayName || member.user?.email}`" @change="changeRole(member, $event.target.value)">
                  <option value="manager">Менеджер</option>
                  <option value="editor">Редактор</option>
                  <option value="participant">Участник</option>
                  <option value="viewer">Наблюдатель</option>
                </select>
                <button class="btn btn-secondary btn-sm" type="button" @click="removeMember(member)">Удалить</button>
              </div>
            </div>
          </div>
          <p v-else class="empty-state">В проекте пока нет участников.</p>
        </section>

        <section class="card members-card">
          <div class="section-heading section-heading-row">
            <div>
              <p class="eyebrow">Ожидают ответа</p>
              <h2>Приглашения <span class="count-badge">{{ pendingInvitations.length }}</span></h2>
            </div>
          </div>
          <div v-if="pendingInvitations.length" class="list">
            <div v-for="invitation in pendingInvitations" :key="invitation.id" class="list-item">
              <div class="member-identity">
                <span class="avatar invitation-avatar" aria-hidden="true">✉</span>
                <span class="member-copy">
                  <strong>{{ invitation.email }}</strong>
                  <span>{{ roleLabel(invitation.role) }}</span>
                </span>
                <span class="badge badge-neutral">Ожидает ответа</span>
              </div>
              <div class="actions">
                <button class="btn btn-secondary btn-sm" type="button" @click="resendInvitation(invitation)">Отправить снова</button>
                <button class="btn btn-ghost btn-sm" type="button" @click="revokeInvitation(invitation)">Отозвать</button>
              </div>
            </div>
          </div>
          <p v-else class="empty-state">Ожидающих приглашений нет.</p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.members-page {
  max-width: 1280px;
}

.members-header {
  align-items: center;
}

.project-picker {
  display: grid;
  width: min(360px, 100%);
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: 650;
}

.members-content {
  display: grid;
  gap: 16px;
}

.members-card {
  padding: 20px;
}

.section-heading {
  margin-bottom: 16px;
}

.section-heading h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.section-description {
  margin: 5px 0 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.section-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.invite-form {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 190px auto;
  align-items: end;
  gap: 10px;
}

.member-role-field {
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: 650;
}

.list {
  display: grid;
  gap: 8px;
}

.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.member-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.member-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.member-copy strong,
.member-copy > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-copy strong {
  color: var(--color-text);
  font-size: var(--text-sm);
}

.member-copy > span {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.invitation-avatar {
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.role-select {
  width: auto;
  min-width: 132px;
  min-height: var(--control-height-sm);
  padding: 4px 8px;
  font-size: var(--text-xs);
}

.empty-state,
.loading-state {
  padding: 24px;
  color: var(--color-text-muted);
  text-align: center;
}

@media (max-width: 760px) {
  .members-header {
    align-items: stretch;
    flex-direction: column;
  }

  .project-picker {
    width: 100%;
  }

  .invite-form {
    grid-template-columns: 1fr;
  }

  .invite-form > button {
    justify-self: stretch;
  }

  .list-item {
    align-items: flex-start;
    flex-direction: column;
  }

  .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
