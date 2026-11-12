<script setup>
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
const form = ref({ email: '', role: 'editor' });

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

async function loadProject() {
  loading.value = true;
  try {
    const session = await api('/auth/session');
    currentUser.value = session?.user ?? session;
    projects.value = (await api('/projects?limit=100')).items ?? [];
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
  if (!projectId.value) return;
  const [memberResult, invitationResult] = await Promise.allSettled([
    api(`/projects/${projectId.value}/members?limit=200`),
    api(`/projects/${projectId.value}/invitations?limit=200`),
  ]);
  if (memberResult.status === 'rejected') throw memberResult.reason;
  members.value = memberResult.value.items ?? [];
  invitations.value =
    invitationResult.status === 'fulfilled' ? (invitationResult.value.items ?? []) : [];
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
  await run(async () => {
    await api(`/projects/${projectId.value}/invitations`, {
      method: 'POST',
      body: form.value,
    });
    form.value = { email: '', role: 'editor' };
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
        <label class="project-picker">
          <span>Проект</span>
          <select v-model="projectId" class="input" aria-label="Выбрать проект" @change="loadMembers">
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </label>
      </header>

      <p v-if="loading" class="loading-state">Загрузка участников...</p>
      <div v-else-if="!projectId" class="card empty-state">Нет доступных проектов.</div>
      <div v-else class="members-content">
        <section class="card members-card invite-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Новый доступ</p>
              <h2>Добавить участника</h2>
              <p class="section-description">Участник получит приглашение на электронную почту.</p>
            </div>
          </div>
          <form class="inline invite-form" @submit.prevent="invite">
            <input v-model="form.email" class="input" type="email" placeholder="Email" required />
            <select v-model="form.role" class="input">
              <option value="manager">Менеджер</option>
              <option value="editor">Редактор</option>
              <option value="participant">Участник</option>
              <option value="viewer">Наблюдатель</option>
            </select>
            <button class="btn btn-primary" type="submit">Добавить или пригласить</button>
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
              <h2>Приглашения <span class="count-badge">{{ invitations.length }}</span></h2>
            </div>
          </div>
          <div v-if="invitations.length" class="list">
            <div v-for="invitation in invitations" :key="invitation.id" class="list-item">
              <div class="member-identity">
                <span class="avatar invitation-avatar" aria-hidden="true">✉</span>
                <span class="member-copy">
                  <strong>{{ invitation.email }}</strong>
                  <span>{{ roleLabel(invitation.role) }}</span>
                </span>
                <span class="badge badge-neutral">{{ invitation.status }}</span>
              </div>
              <div v-if="invitation.status === 'pending'" class="actions">
                <button class="btn btn-secondary btn-sm" type="button" @click="resendInvitation(invitation)">Отправить снова</button>
                <button class="btn btn-ghost btn-sm" type="button" @click="revokeInvitation(invitation)">Отозвать</button>
              </div>
            </div>
          </div>
          <p v-else class="empty-state">Активных приглашений нет.</p>
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
  grid-template-columns: minmax(220px, 1fr) 190px auto;
  gap: 10px;
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
