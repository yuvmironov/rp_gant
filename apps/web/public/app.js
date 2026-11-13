const state = {
  user: null,
  projects: [],
  project: null,
  diagrams: [],
  diagram: null,
  snapshot: null,
  task: null,
  comments: [],
  users: null,
  sessions: [],
  members: [],
  invitations: [],
  pendingInvitation: null,
  syncSocket: null,
  syncConnecting: false,
  syncTimer: null,
  syncReconnect: null,
  filters: { query: '', status: '' },
};

let unreadTimer;
const $ = (selector) => document.querySelector(selector);
const authView = $('#auth-view');
const appView = $('#app-view');
const toast = $('#toast');

function csrfToken() {
  const prefix = '__Host-csrf=';
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add('hidden'), 4000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken() ?? '';
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    showAuth();
    throw new Error('Требуется вход');
  }
  if (!response.ok) {
    let detail = `Ошибка ${response.status}`;
    try {
      const problem = await response.json();
      detail = problem.detail || problem.title || detail;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    if (detail.includes('session_limit_reached')) {
      detail =
        'Достигнут лимит двух активных сессий. Перезапустите user-service или завершите сессию в другом окне.';
    }
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

function dateInput(value) {
  return value ? String(value).slice(0, 10) : '';
}

function setTableMessage(message) {
  const body = $('#gantt-table tbody');
  body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(message)}</td></tr>`;
}

async function loadDirectory() {
  if (state.users) return;
  const users = await api('/users?limit=200');
  state.users = users.items ?? [];
  if (state.users.length === 0 && state.user) {
    state.users = [
      { id: state.user.id, displayName: state.user.displayName, email: state.user.email },
    ];
  }
}

function showAuth() {
  state.user = null;
  disconnectSync();
  window.location.assign('/login');
}

function showApp() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  $('#current-user').textContent = state.user?.displayName ?? state.user?.email ?? '';
  const isAdmin = (state.user?.globalRoles ?? []).includes('app_admin');
  $('#audit-toggle').classList.toggle('hidden', !isAdmin);
  $('#admin-toggle').classList.toggle('hidden', !isAdmin);
  $('#settings-toggle').classList.toggle('hidden', !isAdmin);
  window.clearInterval(unreadTimer);
  loadUnreadCount();
  unreadTimer = window.setInterval(loadUnreadCount, 60_000);
  connectSync();
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verify');
  const resetToken = params.get('reset');
  const invitationToken = params.get('invitation');
  if (verifyToken) {
    try {
      await api('/auth/email/verify', { method: 'POST', body: { token: verifyToken } });
      showToast('Email подтверждён. Теперь можно войти.');
    } catch (error) {
      showToast(error.message);
    }
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (invitationToken) {
    state.pendingInvitation = invitationToken;
    window.localStorage.setItem('pendingInvitation', invitationToken);
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (resetToken) {
    window.history.replaceState({}, '', window.location.pathname);
    showAuth();
    $('#forgot-modal').classList.remove('hidden');
    $('#forgot-form').classList.add('hidden');
    $('#reset-form').classList.remove('hidden');
    $('#reset-form input[name=token]').value = resetToken;
    return;
  }
  try {
    state.user = await api('/auth/session');
  } catch {
    showAuth();
    return;
  }
  showApp();
  await acceptPendingInvitation();
  await loadProjects().catch((error) => showToast(error.message));
}

function setTab(registering) {
  $('#login-tab').classList.toggle('active', !registering);
  $('#register-tab').classList.toggle('active', registering);
  $('#login-form').classList.toggle('hidden', registering);
  $('#register-form').classList.toggle('hidden', !registering);
}

async function login(email, password) {
  state.user = (await api('/auth/login', { method: 'POST', body: { email, password } })).user;
  showApp();
  await acceptPendingInvitation();
  await loadProjects();
}

$('#login-tab').addEventListener('click', () => setTab(false));
$('#register-tab').addEventListener('click', () => setTab(true));

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await login(data.get('email'), data.get('password'));
  } catch (error) {
    showToast(error.message);
  }
});

$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await api('/auth/register', {
      method: 'POST',
      body: {
        email: data.get('email'),
        password: data.get('password'),
        lastName: data.get('lastName'),
        firstName: data.get('firstName'),
        displayName: `${data.get('lastName')} ${data.get('firstName')}`.trim(),
      },
    });
    await login(data.get('email'), data.get('password'));
  } catch (error) {
    showToast(error.message);
  }
});

$('#logout').addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    // The local session is discarded even if the server is unavailable.
  }
  showAuth();
});

async function loadProjects() {
  const response = await api('/projects?limit=100');
  state.projects = response.items ?? [];
  renderProjects();
}

function renderProjects() {
  const container = $('#project-list');
  if (state.projects.length === 0) {
    container.innerHTML = '<p class="empty">Проектов пока нет. Создайте первый.</p>';
    return;
  }
  container.innerHTML = state.projects
    .map(
      (project) => `
        <button class="list-item ${state.project?.id === project.id ? 'selected' : ''}" data-project="${escapeHtml(project.id)}" type="button">
          <span class="item-title">${escapeHtml(project.name)}</span>
          <span class="item-meta">${escapeHtml(project.description || project.status)}</span>
        </button>`,
    )
    .join('');
}

$('#project-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-project]');
  if (!button) return;
  state.project = state.projects.find((project) => project.id === button.dataset.project) ?? null;
  state.diagram = null;
  state.snapshot = null;
  renderProjects();
  $('#project-title').textContent = state.project?.name ?? 'Выберите проект';
  $('#members-toggle').classList.toggle('hidden', !state.project);
  $('#diagram-title').textContent = 'Диаграмма';
  $('#diagram-hint').textContent = 'Выберите диаграмму';
  $('#gantt-table').classList.add('hidden');
  $('#gantt-forms').classList.add('hidden');
  $('#import-toggle').classList.add('hidden');
  $('#import-form').classList.add('hidden');
  $('#export-json').classList.add('hidden');
  try {
    await loadDiagrams();
  } catch (error) {
    showToast(error.message);
  }
});

$('#new-project-toggle').addEventListener('click', () => {
  $('#project-form').classList.toggle('hidden');
});

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api('/projects', {
      method: 'POST',
      body: { name: data.get('name'), description: data.get('description') },
    });
    form.reset();
    $('#project-form').classList.add('hidden');
    await loadProjects();
  } catch (error) {
    showToast(error.message);
  }
});

async function loadDiagrams() {
  if (!state.project) return;
  const response = await api(`/projects/${state.project.id}/diagrams?limit=100`);
  state.diagrams = response.items ?? [];
  renderDiagrams();
}

function renderDiagrams() {
  const container = $('#diagram-list');
  if (state.diagrams.length === 0) {
    container.innerHTML = '<p class="empty">В проекте пока нет диаграмм.</p>';
    return;
  }
  container.innerHTML = state.diagrams
    .map(
      (diagram) => `
        <button class="list-item ${state.diagram?.id === diagram.id ? 'selected' : ''}" data-diagram="${escapeHtml(diagram.id)}" type="button">
          <span class="item-title">${escapeHtml(diagram.name)}</span>
          <span class="item-meta">${escapeHtml(diagram.dayMode === 'calendar' ? 'Календарь' : 'Рабочие дни')}</span>
        </button>`,
    )
    .join('');
}

$('#new-diagram-toggle').addEventListener('click', () => {
  if (!state.project) {
    showToast('Сначала выберите проект');
    return;
  }
  $('#diagram-form').classList.toggle('hidden');
});

$('#diagram-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.project) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api(`/projects/${state.project.id}/diagrams`, {
      method: 'POST',
      body: {
        name: data.get('name'),
        description: data.get('description'),
        dayMode: 'working',
      },
    });
    form.reset();
    $('#diagram-form').classList.add('hidden');
    await loadDiagrams();
  } catch (error) {
    showToast(error.message);
  }
});

$('#diagram-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-diagram]');
  if (!button) return;
  state.diagram = state.diagrams.find((diagram) => diagram.id === button.dataset.diagram) ?? null;
  renderDiagrams();
  await loadSnapshot();
});

async function loadSnapshot() {
  if (!state.diagram) return;
  $('#gantt-table').classList.remove('hidden');
  $('#gantt-filters').classList.remove('hidden');
  setTableMessage('Загрузка...');
  try {
    state.snapshot = await api(`/diagrams/${state.diagram.id}/snapshot`);
    $('#diagram-title').textContent = state.snapshot.diagram.name;
    $('#diagram-hint').textContent = `Ревизия ${state.snapshot.currentRevision}`;
    $('#export-json').href = `/api/v1/diagrams/${state.diagram.id}/export?format=json`;
    $('#export-json').classList.remove('hidden');
    $('#gantt-forms').classList.remove('hidden');
    $('#diagram-extras').classList.remove('hidden');
    $('#import-toggle').classList.remove('hidden');
    renderGantt();
    renderDependencies();
    renderHolidays();
    if (state.task) {
      const fresh = (state.snapshot.tasks ?? []).find((item) => item.id === state.task.id);
      if (fresh) openTask(fresh.id);
      else closeTask();
    }
  } catch (error) {
    setTableMessage('Не удалось загрузить диаграмму');
    showToast(error.message);
  }
}

function statusLabel(status) {
  return (
    {
      planned: 'План',
      in_progress: 'В работе',
      done: 'Готово',
      blocked: 'Блок',
    }[status] ?? status
  );
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(
    new Date(value),
  );
}

function renderGantt() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const query = state.filters.query.trim().toLowerCase();
  const status = state.filters.status;
  const tasks = [...(snapshot.tasks ?? [])]
    .filter(
      (task) =>
        (!query || `${task.wbsCode} ${task.name}`.toLowerCase().includes(query)) &&
        (!status || task.status === status),
    )
    .sort((a, b) => a.wbsCode.localeCompare(b.wbsCode));
  const directions = [...(snapshot.directions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows = [];

  for (const direction of directions) {
    const directionTasks = tasks.filter((item) => item.directionId === direction.id);
    if (directionTasks.length === 0 && (query || status)) continue;
    rows.push(`
      <tr class="direction-row">
        <td>${escapeHtml(direction.wbsCode)}</td>
        <td colspan="6"><strong>${escapeHtml(direction.name)}</strong></td>
      </tr>`);
    for (const task of directionTasks) {
      const responsible = (task.assignments ?? []).find((item) => item.role === 'responsible');
      const dates = [formatDate(task.startDate), formatDate(task.endDate)]
        .filter(Boolean)
        .join(' - ');
      rows.push(`
        <tr class="${task.level === 3 ? 'child-row' : ''}">
          <td>${escapeHtml(task.wbsCode)}</td>
          <td><button class="task-link" data-task-open="${escapeHtml(task.id)}" type="button">${escapeHtml(task.name)}</button></td>
          <td><span class="status ${escapeHtml(task.status)}">${escapeHtml(statusLabel(task.status))}</span></td>
          <td>
            <div class="progress">
              <span style="width:${Number(task.progress) || 0}%"></span>
            </div>
            <small>${Number(task.progress) || 0}%</small>
          </td>
          <td>${escapeHtml(dates)}</td>
          <td>${escapeHtml(responsible?.displayName ?? '')}</td>
          <td class="row-actions">
            <button class="ghost small" data-task-open="${escapeHtml(task.id)}" type="button">Открыть</button>
            <button class="ghost small" data-progress="${escapeHtml(task.id)}" type="button">+25%</button>
          </td>
        </tr>`);
    }
  }

  const body = $('#gantt-table tbody');
  body.innerHTML =
    rows.join('') || '<tr><td colspan="7" class="empty">Добавьте направление и задачу.</td></tr>';
  const select = $('#task-direction');
  select.innerHTML = directions
    .map(
      (direction) =>
        `<option value="${escapeHtml(direction.id)}">${escapeHtml(direction.wbsCode)} ${escapeHtml(direction.name)}</option>`,
    )
    .join('');
}

$('#gantt-table').addEventListener('click', async (event) => {
  const open = event.target.closest('[data-task-open]');
  if (open) {
    openTask(open.dataset.taskOpen);
    return;
  }
  const button = event.target.closest('[data-progress]');
  if (!button) return;
  const task = (state.snapshot?.tasks ?? []).find((item) => item.id === button.dataset.progress);
  if (!task) return;
  const next = Math.min(100, (Number(task.progress) || 0) + 25);
  const status = next >= 100 ? 'done' : 'in_progress';
  try {
    await api(`/tasks/${task.id}/progress`, {
      method: 'PATCH',
      body: { status, progress: next, expectedVersion: task.version },
    });
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
});

$('#direction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.diagram) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api(`/diagrams/${state.diagram.id}/directions`, {
      method: 'POST',
      body: { name: data.get('name') },
    });
    form.reset();
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
});

$('#task-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.diagram) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api(`/diagrams/${state.diagram.id}/tasks`, {
      method: 'POST',
      body: { directionId: data.get('directionId'), name: data.get('name') },
    });
    form.reset();
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
});

$('#refresh-diagram').addEventListener('click', () => {
  loadSnapshot().catch((error) => showToast(error.message));
});

$('#import-toggle').addEventListener('click', () => {
  $('#import-form').classList.toggle('hidden');
});

$('#import-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.diagram) return;
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    const response = await fetch(`/api/v1/diagrams/${state.diagram.id}/import`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken() ?? '' },
      credentials: 'same-origin',
      body: formData,
    });
    const job = await response.json();
    if (!response.ok) {
      throw new Error(job.detail || job.title || 'Не удалось импортировать диаграмму');
    }
    if (job.status !== 'completed') {
      throw new Error(job.errorMessage || 'Импорт завершился с ошибкой');
    }
    form.reset();
    $('#import-form').classList.add('hidden');
    await loadSnapshot();
    showToast(
      `Импортировано: направлений ${job.report?.directionsCount ?? 0}, задач ${job.report?.tasksCount ?? 0}`,
    );
  } catch (error) {
    showToast(error.message);
  }
});

$('#task-search').addEventListener('input', (event) => {
  state.filters.query = event.target.value;
  renderGantt();
});

$('#task-status-filter').addEventListener('change', (event) => {
  state.filters.status = event.target.value;
  renderGantt();
});

$('#clear-filters').addEventListener('click', () => {
  state.filters = { query: '', status: '' };
  $('#task-search').value = '';
  $('#task-status-filter').value = '';
  renderGantt();
});

function findTask(taskId) {
  return (state.snapshot?.tasks ?? []).find((task) => task.id === taskId);
}

function updateTaskInSnapshot(task) {
  const tasks = state.snapshot?.tasks ?? [];
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) tasks[index] = task;
}

async function openTask(taskId) {
  const task = findTask(taskId);
  if (!task) return;
  state.task = task;
  const drawer = $('#task-drawer');
  drawer.classList.remove('hidden');
  $('#task-drawer-title').textContent = `${task.wbsCode} ${task.name}`;
  const form = $('#task-edit-form');
  form.elements.name.value = task.name ?? '';
  form.elements.description.value = task.description ?? '';
  form.elements.priority.value = task.priority ?? 'medium';
  form.elements.jiraNumber.value = task.jiraNumber ?? '';
  form.elements.startDate.value = dateInput(task.startDate);
  form.elements.endDate.value = dateInput(task.endDate);
  $('#task-status').value = task.status ?? 'planned';
  $('#task-progress').value = Number(task.progress) || 0;
  const moveSelect = $('#task-move-direction');
  moveSelect.innerHTML = (state.snapshot?.directions ?? [])
    .map(
      (direction) =>
        `<option value="${escapeHtml(direction.id)}">${escapeHtml(direction.wbsCode)} ${escapeHtml(direction.name)}</option>`,
    )
    .join('');
  moveSelect.value = task.directionId;
  $('#task-move-sort').value = task.sortOrder ?? 1;
  renderAssignments();
  try {
    await loadDirectory();
    renderAssignmentPeople();
  } catch (error) {
    showToast(error.message);
  }
  await loadComments(task.id);
}

function closeTask() {
  state.task = null;
  state.comments = [];
  $('#task-drawer').classList.add('hidden');
}

$('#task-drawer-close').addEventListener('click', closeTask);

function assignmentRoleLabel(role) {
  return (
    {
      responsible: 'Ответственный',
      executor: 'Исполнитель',
      co_executor: 'Соисполнитель',
    }[role] ?? role
  );
}

function renderAssignments() {
  const container = $('#assignment-list');
  const assignments = state.task?.assignments ?? [];
  if (assignments.length === 0) {
    container.innerHTML = '<p class="empty">Назначений пока нет.</p>';
    return;
  }
  container.innerHTML = assignments
    .map(
      (assignment) => `
        <div class="list-item assignment-item">
          <span class="item-title">${escapeHtml(assignment.displayName || assignment.assigneeId)}</span>
          <span class="item-meta">${escapeHtml(assignmentRoleLabel(assignment.role))} · ${escapeHtml('Пользователь')}</span>
          <button class="ghost small" data-assignment-remove="${escapeHtml(assignment.id)}" type="button">Убрать</button>
        </div>`,
    )
    .join('');
}

function renderAssignmentPeople() {
  const select = $('#assignment-person');
  const items = state.users ?? [];
  select.innerHTML = items
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.fullName ?? item.displayName ?? item.email ?? item.id)}</option>`,
    )
    .join('');
}

$('#assignment-add').addEventListener('click', async () => {
  if (!state.task) return;
  const role = $('#assignment-role').value;
  const assigneeType = 'user';
  const assigneeId = $('#assignment-person').value;
  if (!assigneeId) {
    showToast('Нет доступных исполнителей');
    return;
  }
  const current = state.task.assignments ?? [];
  if (role === 'co_executor' && current.filter((item) => item.role === role).length >= 2) {
    showToast('Можно назначить не более двух соисполнителей');
    return;
  }
  const next = current.filter((item) => item.role !== role || role === 'co_executor');
  next.push({ role, assigneeType, assigneeId });
  await saveAssignments(next);
});

$('#assignment-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-assignment-remove]');
  if (!button || !state.task) return;
  const next = (state.task.assignments ?? []).filter(
    (item) => item.id !== button.dataset.assignmentRemove,
  );
  await saveAssignments(next);
});

async function saveAssignments(assignments) {
  try {
    const task = await api(`/tasks/${state.task.id}/assignments`, {
      method: 'PUT',
      body: {
        assignments: assignments.map((item) => ({
          role: item.role,
          assigneeType: item.assigneeType,
          assigneeId: item.assigneeId,
        })),
      },
    });
    state.task = task;
    updateTaskInSnapshot(task);
    renderAssignments();
    renderGantt();
  } catch (error) {
    showToast(error.message);
  }
}

$('#task-edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.task) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    const task = await api(`/tasks/${state.task.id}`, {
      method: 'PATCH',
      body: {
        name: data.get('name'),
        description: data.get('description'),
        priority: data.get('priority'),
        jiraNumber: data.get('jiraNumber'),
        startDate: data.get('startDate') || null,
        endDate: data.get('endDate') || null,
        expectedVersion: state.task.version,
      },
    });
    state.task = task;
    updateTaskInSnapshot(task);
    $('#task-drawer-title').textContent = `${task.wbsCode} ${task.name}`;
    renderGantt();
    showToast('Задача сохранена');
  } catch (error) {
    showToast(error.message);
  }
});

$('#task-delete').addEventListener('click', async () => {
  if (!state.task) return;
  if (!window.confirm('Удалить задачу?')) return;
  try {
    await api(`/tasks/${state.task.id}?expectedVersion=${state.task.version}`, {
      method: 'DELETE',
    });
    closeTask();
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
});

$('#task-progress-save').addEventListener('click', async () => {
  if (!state.task) return;
  try {
    const task = await api(`/tasks/${state.task.id}/progress`, {
      method: 'PATCH',
      body: {
        status: $('#task-status').value,
        progress: Number($('#task-progress').value),
        expectedVersion: state.task.version,
      },
    });
    state.task = task;
    updateTaskInSnapshot(task);
    renderGantt();
    showToast('Прогресс обновлён');
  } catch (error) {
    showToast(error.message);
  }
});

$('#task-move').addEventListener('click', async () => {
  if (!state.task) return;
  try {
    const task = await api(`/tasks/${state.task.id}/move`, {
      method: 'POST',
      body: {
        directionId: $('#task-move-direction').value,
        sortOrder: Number($('#task-move-sort').value) || 0,
        expectedVersion: state.task.version,
      },
    });
    state.task = task;
    updateTaskInSnapshot(task);
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
});

async function loadComments(taskId) {
  try {
    const response = await api(`/comments?entityType=task&entityId=${taskId}`);
    state.comments = response.items ?? [];
    renderComments();
  } catch (error) {
    showToast(error.message);
  }
}

function renderComments() {
  const container = $('#comment-list');
  if (state.comments.length === 0) {
    container.innerHTML = '<p class="empty">Комментариев пока нет.</p>';
    return;
  }
  container.innerHTML = state.comments
    .map(
      (comment) => `
        <div class="list-item comment-item">
          <span class="item-title">${escapeHtml(comment.body)}</span>
          <span class="item-meta">${escapeHtml(comment.authorUserId)} · ${formatDate(comment.createdAt)}</span>
          <button class="ghost small" data-comment-delete="${escapeHtml(comment.id)}" type="button">Удалить</button>
        </div>`,
    )
    .join('');
}

$('#comment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.task) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api('/comments', {
      method: 'POST',
      body: {
        entityType: 'task',
        entityId: state.task.id,
        body: data.get('body'),
      },
    });
    form.reset();
    await loadComments(state.task.id);
  } catch (error) {
    showToast(error.message);
  }
});

$('#comment-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-comment-delete]');
  if (!button) return;
  try {
    await api(`/comments/${button.dataset.commentDelete}`, { method: 'DELETE' });
    await loadComments(state.task.id);
  } catch (error) {
    showToast(error.message);
  }
});

function wbsFor(entityType, entityId) {
  if (entityType === 'task') {
    return (state.snapshot?.tasks ?? []).find((task) => task.id === entityId)?.wbsCode ?? entityId;
  }
  return (
    (state.snapshot?.directions ?? []).find((direction) => direction.id === entityId)?.wbsCode ??
    entityId
  );
}

function renderDependencies() {
  const container = $('#dependency-list');
  const dependencies = state.snapshot?.dependencies ?? [];
  container.innerHTML =
    dependencies
      .map(
        (dependency) => `
          <div class="list-item dependency-item">
            <span class="item-title">${escapeHtml(wbsFor(dependency.predecessorType, dependency.predecessorId))} → ${escapeHtml(wbsFor(dependency.successorType, dependency.successorId))}</span>
            <span class="item-meta">${escapeHtml(dependency.lineStyle)} · ${escapeHtml(dependency.arrowShape)}</span>
            <button class="ghost small" data-dependency-delete="${escapeHtml(dependency.id)}" type="button">Удалить</button>
          </div>`,
      )
      .join('') || '<p class="empty">Зависимостей пока нет.</p>';

  const tasks = state.snapshot?.tasks ?? [];
  const options = tasks
    .map(
      (task) =>
        `<option value="${escapeHtml(task.id)}">${escapeHtml(task.wbsCode)} ${escapeHtml(task.name)}</option>`,
    )
    .join('');
  $('#dependency-predecessor').innerHTML = options;
  $('#dependency-successor').innerHTML = options;
}

$('#dependency-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-dependency-delete]');
  if (!button) return;
  try {
    await api(`/dependencies/${button.dataset.dependencyDelete}`, { method: 'DELETE' });
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
});

$('#dependency-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.diagram) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  if (data.get('predecessorId') === data.get('successorId')) {
    showToast('Выберите разные задачи');
    return;
  }
  try {
    await api(`/diagrams/${state.diagram.id}/dependencies`, {
      method: 'POST',
      body: {
        predecessorType: 'task',
        predecessorId: data.get('predecessorId'),
        successorType: 'task',
        successorId: data.get('successorId'),
        lineStyle: data.get('lineStyle'),
        arrowShape: data.get('arrowShape'),
      },
    });
    form.reset();
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
});

function renderHolidays() {
  const container = $('#holiday-list');
  const holidays = state.snapshot?.holidays ?? [];
  container.innerHTML =
    holidays
      .map(
        (holiday) => `
          <div class="list-item">
            <span class="item-title">${escapeHtml(holiday.holidayDate)}</span>
            <span class="item-meta">${escapeHtml(holiday.name || 'Праздник')}</span>
            <button class="ghost small" data-holiday-delete="${escapeHtml(holiday.holidayDate)}" type="button">Удалить</button>
          </div>`,
      )
      .join('') || '<p class="empty">Праздников пока нет.</p>';
}

async function saveHolidays(holidays) {
  try {
    await api(`/diagrams/${state.diagram.id}/holidays`, {
      method: 'PUT',
      body: {
        items: holidays.map((holiday) => ({
          holidayDate: holiday.holidayDate,
          name: holiday.name ?? '',
        })),
      },
    });
    await loadSnapshot();
  } catch (error) {
    showToast(error.message);
  }
}

$('#holiday-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const holidays = [...(state.snapshot?.holidays ?? [])];
  if (holidays.some((holiday) => holiday.holidayDate === data.get('date'))) {
    showToast('Такой праздник уже есть');
    return;
  }
  holidays.push({ holidayDate: data.get('date'), name: data.get('name') });
  form.reset();
  await saveHolidays(holidays);
});

$('#holiday-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-holiday-delete]');
  if (!button) return;
  const holidays = (state.snapshot?.holidays ?? []).filter(
    (holiday) => holiday.holidayDate !== button.dataset.holidayDelete,
  );
  await saveHolidays(holidays);
});

async function openAudit() {
  $('#audit-modal').classList.remove('hidden');
  const container = $('#audit-list');
  container.innerHTML = '<p class="empty">Загрузка...</p>';
  try {
    const query = new URLSearchParams({ limit: '50' });
    const action = $('#audit-filter-action').value.trim();
    const actor = $('#audit-filter-actor').value.trim();
    if (action) query.set('actionCode', action);
    if (actor) query.set('actorUserId', actor);
    const response = await api(`/audit/events?${query}`);
    const items = response.items ?? [];
    container.innerHTML =
      items
        .map(
          (item) => `
            <div class="list-item">
              <span class="item-title">${escapeHtml(item.actionCode)}</span>
              <span class="item-meta">${escapeHtml(item.actorUserId || 'system')} · ${escapeHtml(item.severity)} · ${formatDate(item.occurredAt)}</span>
            </div>`,
        )
        .join('') || '<p class="empty">Событий пока нет.</p>';
  } catch (error) {
    container.innerHTML = '<p class="empty">Не удалось загрузить аудит.</p>';
    showToast(error.message);
  }
}

$('#audit-toggle').addEventListener('click', openAudit);
$('#audit-filter-apply').addEventListener('click', openAudit);
$('#audit-close').addEventListener('click', () => $('#audit-modal').classList.add('hidden'));

$('#settings-toggle').addEventListener('click', async () => {
  $('#settings-modal').classList.remove('hidden');
  try {
    const response = await api('/settings');
    $('#settings-json').value = JSON.stringify(response.items ?? [], null, 2);
  } catch (error) {
    showToast(error.message);
  }
});
$('#settings-close').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));
$('#settings-save').addEventListener('click', async () => {
  try {
    const items = JSON.parse($('#settings-json').value);
    await api('/settings', { method: 'PUT', body: { items } });
    showToast('Настройки сохранены.');
  } catch (error) {
    showToast(error.message);
  }
});

async function loadUnreadCount() {
  try {
    const response = await api('/notifications/unread-count');
    $('#unread-count').textContent = response.count ?? 0;
  } catch {
    // Notifications are optional for the main workflow.
  }
}

async function openNotifications() {
  $('#notifications-modal').classList.remove('hidden');
  const container = $('#notification-list');
  container.innerHTML = '<p class="empty">Загрузка...</p>';
  try {
    const response = await api('/notifications?limit=50');
    const items = response.items ?? [];
    container.innerHTML =
      items
        .map(
          (item) => `
            <div class="list-item ${item.isRead ? '' : 'unread'}">
              <span class="item-title">${escapeHtml(item.title)}</span>
              <span class="item-meta">${escapeHtml(item.body)}</span>
              ${item.isRead ? '' : `<button class="ghost small" data-notification-read="${escapeHtml(item.id)}" type="button">Прочитано</button>`}
            </div>`,
        )
        .join('') || '<p class="empty">Уведомлений пока нет.</p>';
    await loadUnreadCount();
  } catch (error) {
    container.innerHTML = '<p class="empty">Не удалось загрузить уведомления.</p>';
    showToast(error.message);
  }
}

$('#notifications-close').addEventListener('click', () =>
  $('#notifications-modal').classList.add('hidden'),
);

$('#notification-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-notification-read]');
  if (!button) return;
  try {
    await api(`/notifications/${button.dataset.notificationRead}/read`, { method: 'POST' });
    await openNotifications();
  } catch (error) {
    showToast(error.message);
  }
});

$('#notifications-read-all').addEventListener('click', async () => {
  try {
    await api('/notifications/read-all', { method: 'POST' });
    await openNotifications();
  } catch (error) {
    showToast(error.message);
  }
});

async function openSessions() {
  $('#sessions-modal').classList.remove('hidden');
  const container = $('#session-list');
  container.innerHTML = '<p class="empty">Загрузка...</p>';
  try {
    const response = await api('/auth/sessions');
    state.sessions = response.items ?? [];
    container.innerHTML =
      state.sessions
        .map(
          (session) => `
            <div class="list-item">
              <span class="item-title">${escapeHtml(session.userAgent || 'Неизвестное устройство')}</span>
              <span class="item-meta">${escapeHtml(session.ip || '')} · ${formatDate(session.lastSeenAt)}</span>
              <button class="ghost small" data-session-revoke="${escapeHtml(session.id)}" type="button">Завершить</button>
            </div>`,
        )
        .join('') || '<p class="empty">Активных сессий нет.</p>';
  } catch (error) {
    container.innerHTML = '<p class="empty">Не удалось загрузить сессии.</p>';
    showToast(error.message);
  }
}

$('#sessions-toggle').addEventListener('click', openSessions);
$('#sessions-close').addEventListener('click', () => $('#sessions-modal').classList.add('hidden'));

$('#session-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-session-revoke]');
  if (!button) return;
  try {
    await api(`/auth/sessions/${button.dataset.sessionRevoke}`, { method: 'DELETE' });
    await openSessions();
  } catch (error) {
    showToast(error.message);
  }
});

$('#logout-all').addEventListener('click', async () => {
  try {
    await api('/auth/logout-all', { method: 'POST' });
    $('#sessions-modal').classList.add('hidden');
    showAuth();
  } catch (error) {
    showToast(error.message);
  }
});

function roleLabel(role) {
  return (
    {
      owner: 'Владелец',
      manager: 'Менеджер',
      editor: 'Редактор',
      participant: 'Участник',
      viewer: 'Наблюдатель',
    }[role] ?? role
  );
}

async function openMembers() {
  if (!state.project) return;
  $('#members-vue-link').href = `/members?project=${state.project.id}`;
  $('#members-modal').classList.remove('hidden');
  await refreshMembers();
}

async function refreshMembers() {
  if (!state.project) return;
  const container = $('#member-list');
  const invitations = $('#invitation-list');
  container.innerHTML = '<p class="empty">Загрузка...</p>';
  invitations.innerHTML = '';
  try {
    const [members, invites] = await Promise.all([
      api(`/projects/${state.project.id}/members?limit=200`),
      api(`/projects/${state.project.id}/invitations?limit=200`),
    ]);
    state.members = members.items ?? [];
    state.invitations = invites.items ?? [];
    renderMembers();
  } catch (error) {
    container.innerHTML = '<p class="empty">Не удалось загрузить участников.</p>';
    showToast(error.message);
  }
}

function renderMembers() {
  const container = $('#member-list');
  container.innerHTML =
    state.members
      .map((member) => {
        const user = member.user ?? {};
        const isOwner = member.role === 'owner';
        const options = ['manager', 'editor', 'participant', 'viewer']
          .map(
            (role) =>
              `<option value="${role}" ${member.role === role ? 'selected' : ''}>${roleLabel(role)}</option>`,
          )
          .join('');
        return `
          <div class="list-item">
            <span class="item-title">${escapeHtml(user.displayName || user.email || member.userId)}</span>
            <span class="item-meta">${escapeHtml(user.email || '')} · ${roleLabel(member.role)}</span>
            ${
              isOwner
                ? ''
                : `<div class="inline-fields">
                    <select data-member-role="${escapeHtml(member.userId)}">${options}</select>
                    <button class="ghost small" data-member-remove="${escapeHtml(member.userId)}" type="button">Удалить</button>
                  </div>`
            }
          </div>`;
      })
      .join('') || '<p class="empty">Участников пока нет.</p>';

  $('#invitation-list').innerHTML =
    state.invitations
      .map(
        (invitation) => `
          <div class="list-item">
            <span class="item-title">${escapeHtml(invitation.email)}</span>
            <span class="item-meta">${roleLabel(invitation.role)} · ${escapeHtml(invitation.status)}</span>
            ${
              invitation.status === 'pending'
                ? `<div class="inline-fields">
                    <button class="ghost small" data-invitation-resend="${escapeHtml(invitation.id)}" type="button">Отправить снова</button>
                    <button class="ghost small" data-invitation-revoke="${escapeHtml(invitation.id)}" type="button">Отозвать</button>
                  </div>`
                : ''
            }
          </div>`,
      )
      .join('') || '<p class="empty">Приглашений нет.</p>';
}

$('#members-toggle').addEventListener('click', openMembers);
$('#members-close').addEventListener('click', () => $('#members-modal').classList.add('hidden'));

$('#member-invite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api(`/projects/${state.project.id}/invitations`, {
      method: 'POST',
      body: { email: data.get('email'), role: data.get('role') },
    });
    form.reset();
    showToast('Участник добавлен или приглашение отправлено.');
    await refreshMembers();
  } catch (error) {
    showToast(error.message);
  }
});

$('#member-list').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-member-role]');
  if (!select) return;
  try {
    await api(`/projects/${state.project.id}/members/${select.dataset.memberRole}`, {
      method: 'PATCH',
      body: { role: select.value },
    });
    showToast('Роль обновлена.');
    await refreshMembers();
  } catch (error) {
    showToast(error.message);
    await refreshMembers();
  }
});

$('#member-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-member-remove]');
  if (!button) return;
  if (!window.confirm('Удалить участника из проекта?')) return;
  try {
    await api(`/projects/${state.project.id}/members/${button.dataset.memberRemove}`, {
      method: 'DELETE',
    });
    showToast('Участник удалён.');
    await refreshMembers();
  } catch (error) {
    showToast(error.message);
  }
});

$('#invitation-list').addEventListener('click', async (event) => {
  const resend = event.target.closest('[data-invitation-resend]');
  const revoke = event.target.closest('[data-invitation-revoke]');
  try {
    if (resend) {
      await api(`/invitations/${resend.dataset.invitationResend}/resend`, { method: 'POST' });
      showToast('Приглашение отправлено снова.');
    } else if (revoke) {
      await api(`/invitations/${revoke.dataset.invitationRevoke}`, { method: 'DELETE' });
      showToast('Приглашение отозвано.');
    } else {
      return;
    }
    await refreshMembers();
  } catch (error) {
    showToast(error.message);
  }
});

async function acceptPendingInvitation() {
  const token = state.pendingInvitation || window.localStorage.getItem('pendingInvitation');
  if (!token || !state.user) return;
  try {
    await api('/invitations/accept', { method: 'POST', body: { token } });
    showToast('Вы добавлены в проект.');
  } catch (error) {
    showToast(`Приглашение: ${error.message}`);
  } finally {
    state.pendingInvitation = null;
    window.localStorage.removeItem('pendingInvitation');
    await loadProjects().catch(() => {});
  }
}

$('#password-toggle').addEventListener('click', () =>
  $('#password-modal').classList.remove('hidden'),
);
$('#password-close').addEventListener('click', () => $('#password-modal').classList.add('hidden'));
$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api('/auth/password/change', {
      method: 'POST',
      body: {
        currentPassword: data.get('currentPassword'),
        newPassword: data.get('newPassword'),
      },
    });
    form.reset();
    $('#password-modal').classList.add('hidden');
    showToast('Пароль изменён. Войдите снова.');
    showAuth();
  } catch (error) {
    showToast(error.message);
  }
});

$('#resend-verification').addEventListener('click', async () => {
  const email = $('#login-form input[name=email]').value.trim();
  if (!email) {
    showToast('Укажите email.');
    return;
  }
  try {
    await api('/auth/email/resend', { method: 'POST', body: { email } });
    showToast('Если регистрация не завершена, письмо отправлено.');
  } catch (error) {
    showToast(error.message);
  }
});

$('#forgot-toggle').addEventListener('click', () => {
  $('#forgot-modal').classList.remove('hidden');
  $('#forgot-form').classList.remove('hidden');
  $('#reset-form').classList.add('hidden');
});
$('#forgot-close').addEventListener('click', () => $('#forgot-modal').classList.add('hidden'));
$('#forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await api('/auth/password/forgot', {
      method: 'POST',
      body: { email: data.get('email') },
    });
    $('#forgot-form').classList.add('hidden');
    $('#reset-form').classList.remove('hidden');
    showToast('Если email существует, ссылка отправлена. Проверьте Mailpit.');
  } catch (error) {
    showToast(error.message);
  }
});
$('#reset-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api('/auth/password/reset', {
      method: 'POST',
      body: { token: data.get('token'), newPassword: data.get('newPassword') },
    });
    form.reset();
    $('#forgot-modal').classList.add('hidden');
    setTab(false);
    showToast('Пароль сброшен. Войдите с новым паролем.');
  } catch (error) {
    showToast(error.message);
  }
});

function syncUrl() {
  if (window.__SYNC_URL__) return window.__SYNC_URL__;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//sync.rp-gant.localhost/ws`;
}

async function connectSync() {
  if (!state.user || state.syncSocket || state.syncConnecting || !window.WebSocket) return;
  state.syncConnecting = true;
  window.__syncConnected = false;
  try {
    const issued = await api('/sync/token');
    if (!state.user) return;
    const socket = new window.WebSocket(`${syncUrl()}?token=${encodeURIComponent(issued.token)}`);
    state.syncSocket = socket;
    socket.addEventListener('open', () => {
      window.__syncConnected = true;
    });
    socket.addEventListener('message', (message) => {
      let payload;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }
      if (payload.type !== 'diagram.changed' || !payload.event) return;
      const event = payload.event;
      loadUnreadCount();
      if (
        event.diagram_id &&
        state.diagram?.id === event.diagram_id &&
        event.actor_user_id !== state.user?.id
      ) {
        window.clearTimeout(state.syncTimer);
        state.syncTimer = window.setTimeout(() => {
          loadSnapshot().catch((error) => showToast(error.message));
        }, 400);
      }
    });
    socket.addEventListener('close', () => {
      window.__syncConnected = false;
      state.syncSocket = null;
      if (state.user) window.setTimeout(connectSync, 3000);
    });
    const refreshIn = Math.max(30_000, (Number(issued.expiresIn ?? 300) - 30) * 1000);
    window.clearTimeout(state.syncReconnect);
    state.syncReconnect = window.setTimeout(() => socket.close(4001, 'token_refresh'), refreshIn);
  } catch {
    state.syncSocket = null;
    if (state.user) window.setTimeout(connectSync, 5000);
  } finally {
    state.syncConnecting = false;
  }
}

function disconnectSync() {
  window.__syncConnected = false;
  window.clearTimeout(state.syncTimer);
  window.clearTimeout(state.syncReconnect);
  if (state.syncSocket) {
    state.syncSocket.onclose = null;
    state.syncSocket.close();
    state.syncSocket = null;
  }
}

window.addEventListener('beforeunload', disconnectSync);

async function openAdmin() {
  $('#admin-modal').classList.remove('hidden');
  await loadAdminUsers();
}

async function loadAdminUsers() {
  const query = $('#admin-user-search').value.trim();
  const container = $('#admin-user-list');
  container.innerHTML = '<p class="empty">Загрузка...</p>';
  try {
    const users = await api(`/users?limit=200&query=${encodeURIComponent(query)}`);
    container.innerHTML =
      (users.items ?? [])
        .map((user) => {
          const isAdmin = (user.globalRoles ?? []).includes('app_admin');
          const isSelf = user.id === state.user?.id;
          return `
            <div class="list-item">
              <span class="item-title">${escapeHtml(user.displayName || user.email)}</span>
              <span class="item-meta">${escapeHtml(user.email)} · ${user.status === 'blocked' ? 'заблокирован' : 'активен'}${isAdmin ? ' · администратор' : ''}</span>
              ${
                isSelf
                  ? ''
                  : `<div class="inline-fields">
                      <button class="ghost small" data-admin-role="${escapeHtml(user.id)}" data-admin-role-value="${isAdmin ? 'false' : 'true'}" type="button">${isAdmin ? 'Снять админа' : 'Сделать админом'}</button>
                      <button class="ghost small" data-admin-block="${escapeHtml(user.id)}" data-admin-block-action="${user.status === 'blocked' ? 'unblock' : 'block'}" type="button">${user.status === 'blocked' ? 'Разблокировать' : 'Заблокировать'}</button>
                      <button class="ghost small" data-admin-delete="${escapeHtml(user.id)}" type="button">Удалить</button>
                    </div>`
              }
            </div>`;
        })
        .join('') || '<p class="empty">Пользователи не найдены.</p>';
  } catch (error) {
    container.innerHTML = '<p class="empty">Не удалось загрузить пользователей.</p>';
    showToast(error.message);
  }
}

$('#admin-toggle').addEventListener('click', openAdmin);
$('#admin-close').addEventListener('click', () => $('#admin-modal').classList.add('hidden'));
$('#admin-user-search').addEventListener('input', () => {
  window.clearTimeout(loadAdminUsers.timer);
  loadAdminUsers.timer = window.setTimeout(loadAdminUsers, 300);
});

$('#admin-user-list').addEventListener('click', async (event) => {
  const role = event.target.closest('[data-admin-role]');
  const block = event.target.closest('[data-admin-block]');
  try {
    if (role) {
      await api(`/admin/users/${role.dataset.adminRole}/roles`, {
        method: 'PATCH',
        body: { appAdmin: role.dataset.adminRoleValue === 'true' },
      });
    } else if (block) {
      await api(`/admin/users/${block.dataset.adminBlock}/${block.dataset.adminBlockAction}`, {
        method: 'PATCH',
        body: {},
      });
    } else {
      return;
    }
    await loadAdminUsers();
  } catch (error) {
    showToast(error.message);
  }
});

$('#admin-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api('/admin/users', {
      method: 'POST',
      body: {
        email: data.get('email'),
        lastName: data.get('lastName'),
        firstName: data.get('firstName'),
        appAdmin: data.get('appAdmin') === 'on',
      },
    });
    form.reset();
    showToast('Пользователь создан, письмо для установки пароля отправлено.');
    await loadAdminUsers();
  } catch (error) {
    showToast(error.message);
  }
});

$('#admin-user-list').addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-admin-delete]');
  if (!remove) return;
  if (!window.confirm('Удалить пользователя?')) return;
  try {
    await api(`/admin/users/${remove.dataset.adminDelete}`, { method: 'DELETE' });
    showToast('Пользователь удалён.');
    await loadAdminUsers();
  } catch (error) {
    showToast(error.message);
  }
});

async function openProfile() {
  $('#profile-modal').classList.remove('hidden');
  try {
    const [user, contacts, preferences] = await Promise.all([
      api('/users/me'),
      api('/users/me/contacts'),
      api('/notifications/preferences'),
    ]);
    const profile = $('#profile-form');
    profile.querySelector('input[name=displayName]').value = user.displayName ?? '';
    profile.querySelector('input[name=lastName]').value = user.lastName ?? '';
    profile.querySelector('input[name=firstName]').value = user.firstName ?? '';
    profile.querySelector('input[name=position]').value = user.position ?? '';
    const items = preferences.items ?? [];
    const channels = ['internal', 'email', 'telegram'];
    for (const channel of channels) {
      const item = items.find((entry) => entry.channel === channel);
      $('#preferences-form input[name=' + channel + ']').checked = item
        ? item.enabled
        : channel !== 'telegram';
    }
    $('#telegram-code-value').textContent = contacts.telegramLinked
      ? `Telegram привязан: ${contacts.telegramUsername || contacts.telegramUserId}`
      : 'Telegram не привязан';
  } catch (error) {
    showToast(error.message);
  }
}

$('#profile-toggle').addEventListener('click', openProfile);
$('#profile-close').addEventListener('click', () => $('#profile-modal').classList.add('hidden'));

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api('/users/me', {
      method: 'PATCH',
      body: {
        displayName: data.get('displayName'),
        lastName: data.get('lastName'),
        firstName: data.get('firstName'),
        position: data.get('position'),
      },
    });
    showToast('Профиль сохранён.');
  } catch (error) {
    showToast(error.message);
  }
});

$('#preferences-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const items = [];
  for (const eventType of ['task.assigned', 'comment.mentioned']) {
    for (const channel of ['internal', 'email', 'telegram']) {
      items.push({
        eventType,
        channel,
        enabled: form.querySelector(`input[name=${channel}]`).checked,
      });
    }
  }
  try {
    await api('/notifications/preferences', { method: 'PUT', body: { items } });
    showToast('Настройки уведомлений сохранены.');
  } catch (error) {
    showToast(error.message);
  }
});

$('#telegram-code').addEventListener('click', async () => {
  try {
    const response = await api('/users/me/telegram/link-code', { method: 'POST' });
    $('#telegram-code-value').textContent = `Код: ${response.code} (${response.deep_link})`;
    const telegramUserId = window.prompt('Telegram user id для локальной привязки:');
    if (!telegramUserId) return;
    await api('/users/me/telegram', {
      method: 'POST',
      body: {
        code: response.code,
        telegramUserId,
        telegramUsername: 'local_user',
      },
    });
    showToast('Telegram привязан.');
  } catch (error) {
    showToast(error.message);
  }
});

$('#telegram-unlink').addEventListener('click', async () => {
  try {
    await api('/users/me/telegram', { method: 'DELETE' });
    showToast('Telegram отвязан.');
  } catch (error) {
    showToast(error.message);
  }
});

$('#delivery-log-toggle').addEventListener('click', async () => {
  const container = $('#delivery-log-list');
  container.innerHTML = '<p class="empty">Loading...</p>';
  try {
    const [log, stats] = await Promise.all([
      api('/notifications/delivery-log?limit=50'),
      api('/notifications/delivery-stats'),
    ]);
    const summary = Object.entries(stats.byStatus ?? {})
      .map(([status, count]) => `${status}: ${count}`)
      .join(' | ');
    container.innerHTML =
      `<p class="muted">${escapeHtml(summary)}</p>` +
      ((log.items ?? [])
        .map(
          (item) => `
            <div class="list-item">
              <span class="item-title">${escapeHtml(item.title || item.eventType)}</span>
              <span class="item-meta">${escapeHtml(item.channel)} / ${escapeHtml(item.status)} / attempts ${escapeHtml(item.attemptCount)}${item.lastError ? ' / ' + escapeHtml(item.lastError) : ''}</span>
            </div>`,
        )
        .join('') || '<p class="empty">No deliveries.</p>');
  } catch (error) {
    container.innerHTML = '<p class="empty">Failed to load deliveries.</p>';
    showToast(error.message);
  }
});

boot().finally(() => {
  window.__rpGantReady = true;
});
