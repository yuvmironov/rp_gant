<script setup>
const projects = ref([]);
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
    await api('/auth/session');
    projects.value = (await api('/projects?limit=100')).items ?? [];
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

onMounted(loadProject);
</script>

<template>
  <main class="members-page">
    <header class="members-header">
      <div>
        <a href="/projects" class="back">← Проекты</a>
        <h1>Участники проекта</h1>
      </div>
      <select v-model="projectId" @change="loadMembers">
        <option v-for="project in projects" :key="project.id" :value="project.id">
          {{ project.name }}
        </option>
      </select>
    </header>

    <p v-if="loading">Загрузка...</p>

    <section class="card">
      <h2>Добавить участника</h2>
      <form class="inline" @submit.prevent="invite">
        <input v-model="form.email" type="email" placeholder="Email" required />
        <select v-model="form.role">
          <option value="manager">Менеджер</option>
          <option value="editor">Редактор</option>
          <option value="participant">Участник</option>
          <option value="viewer">Наблюдатель</option>
        </select>
        <button type="submit">Добавить или пригласить</button>
      </form>
    </section>

    <section class="card">
      <h2>Состав</h2>
      <div class="list">
        <div v-for="member in members" :key="member.userId" class="list-item">
          <div>
            <strong>{{ member.user?.displayName || member.user?.email }}</strong>
            <span>{{ member.user?.email }} · {{ roleLabel(member.role) }}</span>
          </div>
          <div v-if="member.role !== 'owner'" class="actions">
            <select :value="member.role" @change="changeRole(member, $event.target.value)">
              <option value="manager">Менеджер</option>
              <option value="editor">Редактор</option>
              <option value="participant">Участник</option>
              <option value="viewer">Наблюдатель</option>
            </select>
            <button type="button" @click="removeMember(member)">Удалить</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Приглашения</h2>
      <div class="list">
        <div v-for="invitation in invitations" :key="invitation.id" class="list-item">
          <div>
            <strong>{{ invitation.email }}</strong>
            <span>{{ roleLabel(invitation.role) }} · {{ invitation.status }}</span>
          </div>
          <div v-if="invitation.status === 'pending'" class="actions">
            <button type="button" @click="resendInvitation(invitation)">Отправить снова</button>
            <button type="button" @click="revokeInvitation(invitation)">Отозвать</button>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.members-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
  color: #1f2937;
  font-family: Inter, system-ui, sans-serif;
}
.members-header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.back { color: #2563eb; text-decoration: none; font-size: 14px; }
h1 { margin: 4px 0 0; font-size: 28px; }
h2 { margin: 0 0 16px; font-size: 18px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.inline, .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
input, select, button { font: inherit; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; }
button { background: #111827; color: #fff; border-color: #111827; cursor: pointer; }
.list { display: grid; gap: 8px; }
.list-item { display: flex; justify-content: space-between; gap: 12px; padding: 10px; background: #f9fafb; border-radius: 8px; }
.list-item div:first-child { display: grid; gap: 4px; }
.list-item span { color: #6b7280; font-size: 12px; }
.error { color: #b91c1c; }
@media (max-width: 640px) {
  .members-page { padding: 14px; }
  .members-header, .list-item { flex-direction: column; }
}
</style>
