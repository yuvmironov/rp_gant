<script setup>
const projects = ref([]);
const diagrams = ref([]);
const projectId = ref('');
const diagramId = ref('');
const snapshot = ref(null);
const selectedTask = ref(null);
const comments = ref([]);
const commentsLoading = ref(false);
const commentAuthorNames = new Map();
const commentBody = ref('');
const editingCommentId = ref('');
const editCommentBody = ref('');
const progress = ref(0);
const status = ref('planned');
const savingProgress = ref(false);
const savingTask = ref(false);
const error = ref('');
const toast = useToast();
watch(error, (value) => {
  if (value) toast.error(value);
});

const loading = ref(true);
const syncConnected = ref(false);
const currentUser = ref(null);
const editingDependency = ref(null);
const showDependencyModal = ref(false);
const dependencyEdit = reactive({
  id: '',
  predecessorType: 'task',
  predecessorId: '',
  successorType: 'task',
  successorId: '',
  color: '#94a3b8',
  lineStyle: 'solid',
  arrowShape: 'orthogonal',
});
const holidayDate = ref('');
const holidayName = ref('');
const showCalendarModal = ref(false);
const sortedHolidays = computed(() =>
  [...(snapshot.value?.holidays ?? [])].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate)),
);
const importJob = ref(null);
const importing = ref(false);
const importFormat = ref('json');
const pendingImportFile = ref(null);
const importPreview = ref(null);
const showImportModal = ref(false);
const members = ref([]);
const executors = ref([]);
const unreadCount = ref(0);
const filterQuery = ref('');
const filterStatus = ref('');
const assignmentDraft = ref([]);
const assignmentForm = reactive({ role: 'executor', assigneeId: '' });
const projectForm = reactive({ name: '', description: '' });
const showProjectForm = ref(false);
const diagramForm = reactive({ name: '', description: '', dayMode: 'working' });
const showDiagramModal = ref(false);
const showDirectionModal = ref(false);
const directionEdit = reactive({
  id: '',
  version: 0,
  name: '',
  description: '',
  result: '',
  priority: 'medium',
  startDate: '',
  endDate: '',
  jiraNumber: '',
  bpFlag: false,
  spFlag: false,
  responsibleId: '',
});
const showTaskModal = ref(false);
const editingTaskId = ref('');
function updateGanttScrollMetrics() {
  const header = document.querySelector('.app-header');
  const toolbar = toolbarRef.value;
  stickyScrollTop.value = (header?.offsetHeight ?? 0) + (toolbar?.offsetHeight ?? 0) + 14;
  if (timelineRef.value) timelineScrollWidth.value = timelineRef.value.scrollWidth;
}

function syncFromTimeline(event) {
  const target = topScrollRef.value;
  if (target && Math.abs(target.scrollLeft - event.target.scrollLeft) > 1) {
    target.scrollLeft = event.target.scrollLeft;
  }
}

function syncFromTopScroll(event) {
  const target = timelineRef.value;
  if (target && Math.abs(target.scrollLeft - event.target.scrollLeft) > 1) {
    target.scrollLeft = event.target.scrollLeft;
  }
}

function modalPeopleFor(role) {
  const people = members.value.map((member) => ({
    value: `user:${member.userId}`,
    label: member.user?.displayName || member.user?.email || member.userId,
  }));
  const legacy = editingTaskId.value
    ? selectedTask.value?.assignments?.find(
        (assignment) => assignment.role === role && assignment.assigneeType === 'executor',
      )
    : null;
  if (legacy) {
    people.push({
      value: `executor:${legacy.assigneeId}`,
      label: `${legacy.displayName || legacy.assigneeId} — старое назначение (замените участником проекта)`,
    });
  }
  return people;
}
const newTask = reactive({
  estimatedHours: null,
  directionId: '',
  parentTaskId: '',
  name: '',
  description: '',
  status: 'planned',
  progress: 0,
  priority: 'medium',
  jiraNumber: '',
  startDate: '',
  endDate: '',
  actualEndDate: '',
  executorId: '',
  coExecutorId: '',
  predecessorId: '',
  bpFlag: false,
  spFlag: false,
});

const autoTaskEnd = computed(() => {
  const hours = Number(newTask.estimatedHours) || 0;
  if (hours <= 0 || !newTask.startDate) return '';
  return calculateTaskEndDate(
    newTask.startDate,
    hours,
    snapshot.value?.diagram?.dayMode ?? 'working',
    snapshot.value?.holidays ?? [],
  );
});

watch(autoTaskEnd, (value) => {
  if (value) newTask.endDate = value;
});

const moveForm = reactive({ directionId: '', sortOrder: 0 });
const taskEdit = reactive({
  name: '',
  description: '',
  priority: 'medium',
  jiraNumber: '',
  startDate: '',
  endDate: '',
  actualEndDate: '',
  bpFlag: false,
  spFlag: false,
});
const collapsed = ref([]);
const showDependencies = ref(true);
const zoom = ref(1);
const labelWidth = ref(420);
const canvasRef = ref(null);
const canvasWidth = ref(900);
watchEffect((onCleanup) => {
  const element = canvasRef.value;
  if (!element || typeof ResizeObserver === 'undefined') return;
  canvasWidth.value = element.getBoundingClientRect().width;
  const observer = new ResizeObserver(([entry]) => {
    canvasWidth.value = entry.contentRect.width;
  });
  observer.observe(element);
  onCleanup(() => observer.disconnect());
});
const linkMode = ref(false);
const linkFrom = ref(null);
const selectedExecutor = ref('');
const dragTaskId = ref('');
const dragOverId = ref('');
const dragOverMode = ref('');
const barDragPreview = ref(null);
let suppressBarClickUntil = 0;
const hoveredDependencyId = ref('');
const barTooltip = ref(null);
const barTooltipRef = ref(null);
const toolbarRef = ref(null);
const timelineRef = ref(null);
const topScrollRef = ref(null);
const timelineScrollWidth = ref(0);
const stickyScrollTop = ref(0);

watchEffect((onCleanup) => {
  const toolbar = toolbarRef.value;
  const timeline = timelineRef.value;
  if (!toolbar || !timeline) return;
  updateGanttScrollMetrics();
  const observer = new ResizeObserver(updateGanttScrollMetrics);
  observer.observe(toolbar);
  observer.observe(timeline);
  const header = document.querySelector('.app-header');
  if (header) observer.observe(header);
  onCleanup(() => observer.disconnect());
});

watch(
  [zoom, labelWidth, () => snapshot.value?.currentRevision, () => diagramId.value],
  async () => {
    await nextTick();
    updateGanttScrollMetrics();
  },
);
let syncSocket = null;
let syncReconnectTimer = null;
let syncRefreshTimer = null;
let syncReloadTimer = null;
let unreadTimer = null;

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
  if (response.status === 401 && !path.startsWith('/auth/session')) {
    window.location.assign('/login');
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
  return response.status === 204 ? null : response.json();
}

function statusLabel(value) {
  return {
    planned: 'Планируется',
    in_progress: 'В работе',
    done: 'Готово',
    blocked: 'Блокировано',
    postponed: 'Отложено',
  }[value] ?? value;
}

async function loadAllPages(path, parameters = {}) {
  const items = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const query = new URLSearchParams({ ...parameters, limit: '200', offset: String(offset) });
    const response = await api(`${path}?${query}`);
    const pageItems = response.items ?? [];
    items.push(...pageItems);
    total = Number(response.page?.total ?? items.length);
    offset += pageItems.length;
    if (!pageItems.length) break;
  }
  return items;
}

async function loadProjectContext() {
  if (!projectId.value) {
    members.value = [];
    executors.value = [];
    diagrams.value = [];
    snapshot.value = null;
    return;
  }
  const [memberItems, executorItems] = await Promise.all([
    loadAllPages(`/projects/${projectId.value}/members`).catch(() => []),
    loadAllPages('/executors', { projectId: projectId.value }).catch(() => []),
  ]);
  members.value = memberItems.filter(
    (member) => member.status === 'active' && member.user?.status === 'active',
  );
  executors.value = executorItems;
}

async function selectProject() {
  await loadProjectContext();
  await loadDiagrams();
}

async function loadProjects() {
  projects.value = (await api('/projects?limit=200')).items ?? [];
  const query = new URLSearchParams(window.location.search);
  projectId.value = query.get('project') || projects.value[0]?.id || '';
  await loadProjectContext();
  await loadDiagrams(query.get('diagram'));
}

async function loadUnread() {
  try {
    unreadCount.value = (await api('/notifications/unread-count')).count ?? 0;
  } catch {
    unreadCount.value = 0;
  }
}

function openTaskModal(prefill = {}) {
  Object.assign(newTask, {
    directionId: prefill.directionId || snapshot.value?.directions?.[0]?.id || '',
    parentTaskId: prefill.parentTaskId || '',
    name: '',
    description: '',
    status: 'planned',
    progress: 0,
    priority: 'medium',
    jiraNumber: '',
    startDate: '',
    endDate: '',
    actualEndDate: '',
    estimatedHours: null,
    executorId: '',
    coExecutorId: '',
    predecessorId: '',
    bpFlag: false,
    spFlag: false,
  });
  editingTaskId.value = '';
  showTaskModal.value = true;
}

function assignmentValue(role) {
  const assignment = (selectedTask.value?.assignments ?? []).find((item) => item.role === role);
  return assignment ? `${assignment.assigneeType}:${assignment.assigneeId}` : '';
}

async function openTaskEditor(task) {
  editingTaskId.value = task.id;
  Object.assign(newTask, {
    directionId: task.directionId,
    parentTaskId: task.parentTaskId || '',
    name: task.name ?? '',
    description: task.description ?? '',
    status: task.status ?? 'planned',
    progress: Number(task.progress) || 0,
    priority: task.priority ?? 'medium',
    jiraNumber: task.jiraNumber ?? '',
    startDate: task.startDate ? task.startDate.slice(0, 10) : '',
    endDate: task.endDate ? task.endDate.slice(0, 10) : '',
    actualEndDate: task.actualEndDate ? task.actualEndDate.slice(0, 10) : '',
    estimatedHours: task.estimatedHours ?? null,
    executorId: '',
    coExecutorId: '',
    predecessorId: '',
    bpFlag: Boolean(task.bpFlag),
    spFlag: Boolean(task.spFlag),
  });
  showTaskModal.value = true;
  await selectTask(task);
  newTask.executorId = assignmentValue('executor');
  newTask.coExecutorId = assignmentValue('co_executor');
}

function closeTaskModal() {
  showTaskModal.value = false;
  editingTaskId.value = '';
  selectedTask.value = null;
  comments.value = [];
  commentBody.value = '';
  editingCommentId.value = '';
  editCommentBody.value = '';
}

function parseModalPerson(value) {
  const [assigneeType, ...rest] = String(value).split(':');
  return { assigneeType, assigneeId: rest.join(':') };
}

function modalAssignments() {
  const assignments = [
    ['executor', newTask.executorId],
    ['co_executor', newTask.coExecutorId],
  ]
    .filter(([, value]) => value)
    .map(([role, value]) => ({ role, ...parseModalPerson(value) }));
  if (!editingTaskId.value) return assignments;

  const submittedKeys = new Set(
    assignments.map((item) => `${item.role}:${item.assigneeType}:${item.assigneeId}`),
  );
  for (const existing of selectedTask.value?.assignments ?? []) {
    const key = `${existing.role}:${existing.assigneeType}:${existing.assigneeId}`;
    if (submittedKeys.has(key)) continue;
    if (existing.role === 'co_executor') {
      const primaryValue = assignmentValue('co_executor');
      const primaryKey = primaryValue ? `co_executor:${primaryValue}` : '';
      const newCoExecutor = assignments.find((item) => item.role === 'co_executor');
      if (key !== primaryKey || !newCoExecutor) {
        assignments.push({
          role: existing.role,
          assigneeType: existing.assigneeType,
          assigneeId: existing.assigneeId,
        });
        submittedKeys.add(key);
      }
      continue;
    }
    if (
      existing.role === 'executor' &&
      existing.assigneeType === 'executor' &&
      !assignments.some((item) => item.role === existing.role)
    ) {
      assignments.push({
        role: existing.role,
        assigneeType: existing.assigneeType,
        assigneeId: existing.assigneeId,
      });
      submittedKeys.add(key);
    }
  }
  return assignments;
}

async function saveTaskModal() {
  if (Number(newTask.estimatedHours) > 0 && !newTask.startDate) {
    error.value = 'Укажите дату начала для расчёта окончания по часам';
    return;
  }
  if (editingTaskId.value) {
    await saveTaskEdit();
  } else {
    await createTaskFromModal();
  }
}

async function saveTaskEdit() {
  if (!selectedTask.value) return;
  try {
    let task = await api(`/tasks/${selectedTask.value.id}`, {
      method: 'PATCH',
      body: {
        expectedVersion: selectedTask.value.version,
        baseRevision: snapshot.value?.currentRevision ?? 0,
        name: newTask.name,
        description: newTask.description,
        priority: newTask.priority,
        jiraNumber: newTask.jiraNumber,
        startDate: newTask.startDate || null,
        endDate: newTask.endDate || null,
        actualEndDate: newTask.actualEndDate || null,
        estimatedHours: newTask.estimatedHours || null,
        bpFlag: newTask.bpFlag,
        spFlag: newTask.spFlag,
      },
    });
    if (task.directionId !== newTask.directionId || (task.parentTaskId || '') !== newTask.parentTaskId) {
      task = await api(`/tasks/${task.id}/move`, {
        method: 'POST',
        body: {
          directionId: newTask.directionId,
          parentTaskId: newTask.parentTaskId || '',
          sortOrder: task.sortOrder ?? 0,
          expectedVersion: task.version,
          baseRevision: snapshot.value?.currentRevision ?? 0,
        },
      });
    }
    task = await api(`/tasks/${task.id}/progress`, {
      method: 'PATCH',
      body: {
        status: newTask.status,
        progress: Number(newTask.progress) || 0,
        expectedVersion: task.version,
      },
    });
    task = await api(`/tasks/${task.id}/assignments`, {
      method: 'PUT',
      body: {
        assignments: modalAssignments(),
        baseRevision: snapshot.value?.currentRevision ?? 0,
      },
    });
    closeTaskModal();
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function deleteTaskFromModal() {
  if (await deleteTask()) closeTaskModal();
}

function focusNewTask() {
  openTaskModal();
}

async function createTaskFromModal() {
  if (!newTask.name.trim() || !newTask.directionId) return;
  try {
    let task = await api(`/diagrams/${diagramId.value}/tasks`, {
      method: 'POST',
      body: {
        directionId: newTask.directionId,
        parentTaskId: newTask.parentTaskId || null,
        name: newTask.name,
        description: newTask.description,
        priority: newTask.priority,
        startDate: newTask.startDate || null,
        endDate: newTask.endDate || null,
        estimatedHours: newTask.estimatedHours || null,
        jiraNumber: newTask.jiraNumber,
        bpFlag: newTask.bpFlag,
        spFlag: newTask.spFlag,
      },
    });
    task = await api(`/tasks/${task.id}/progress`, {
      method: 'PATCH',
      body: {
        status: newTask.status,
        progress: Number(newTask.progress) || 0,
        expectedVersion: task.version,
      },
    });
    const assignments = modalAssignments();
    if (assignments.length) {
      task = await api(`/tasks/${task.id}/assignments`, {
        method: 'PUT',
        body: {
          assignments,
          baseRevision: snapshot.value?.currentRevision ?? 0,
        },
      });
    }
    if (newTask.predecessorId) {
      await api(`/diagrams/${diagramId.value}/dependencies`, {
        method: 'POST',
        body: {
          predecessorType: 'task',
          predecessorId: newTask.predecessorId,
          successorType: 'task',
          successorId: task.id,
        },
      });
    }
    showTaskModal.value = false;
    await loadSnapshot();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function createProject() {
  if (!projectForm.name.trim()) return;
  try {
    await api('/projects', {
      method: 'POST',
      body: { name: projectForm.name, description: projectForm.description },
    });
    projectForm.name = '';
    projectForm.description = '';
    showProjectForm.value = false;
    await loadProjects();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function loadDiagrams(preferredDiagram) {
  if (!projectId.value) {
    diagrams.value = [];
    diagramId.value = '';
    snapshot.value = null;
    return;
  }
  diagrams.value = (await api(`/projects/${projectId.value}/diagrams?limit=200`)).items ?? [];
  diagramId.value = preferredDiagram || diagrams.value[0]?.id || '';
  await loadSnapshot();
}

async function loadSnapshot(preserveTask = false) {
  const previousId = preserveTask ? selectedTask.value?.id : null;
  if (!preserveTask) {
    snapshot.value = null;
    selectedTask.value = null;
  }
  if (!diagramId.value) return;
  const nextSnapshot = await api(`/diagrams/${diagramId.value}/snapshot`);
  if (!localStorage.getItem('oati_gantt_label_w_v1')) {
    const longest = Math.max(
      ...(nextSnapshot?.tasks ?? []).map((task) => String(task.name ?? '').length),
      30,
    );
    labelWidth.value = Math.min(800, Math.max(420, longest * 7 + 220));
  }
  snapshot.value = nextSnapshot;
  const fresh = (nextSnapshot?.tasks ?? []).find((task) => task.id === previousId);
  if (fresh) selectedTask.value = fresh;
}

function fillAssignments(task) {
  assignmentDraft.value = (task.assignments ?? [])
    .filter((item) => ['executor', 'co_executor'].includes(item.role))
    .map((item) => ({
      role: item.role,
      assigneeType: item.assigneeType,
      assigneeId: item.assigneeId,
      displayName: item.displayName,
    }));
  assignmentForm.role = 'executor';
  assignmentForm.assigneeId = '';
}

function assignmentOptions(type) {
  if (type === 'executor') {
    return executors.value.map((executor) => ({
      id: executor.id,
      displayName: executor.fullName || executor.id,
    }));
  }
  return members.value.map((member) => ({
    id: member.userId,
    displayName: member.user?.displayName || member.user?.email,
  }));
}

watch(
  () => assignmentForm.role,
  () => {
    assignmentForm.assigneeId = '';
  },
);

function assignmentName(assignment) {
  return (
    assignment.displayName ||
    assignmentOptions(assignment.assigneeType).find((item) => item.id === assignment.assigneeId)?.displayName ||
    assignment.assigneeId
  );
}

function addAssignment() {
  if (!assignmentForm.assigneeId) return;
  const assigneeType = 'user';
  const duplicate = assignmentDraft.value.some(
    (item) =>
      item.role === assignmentForm.role &&
      item.assigneeType === assigneeType &&
      item.assigneeId === assignmentForm.assigneeId,
  );
  if (duplicate) return;
  assignmentDraft.value.push({
    role: assignmentForm.role,
    assigneeType,
    assigneeId: assignmentForm.assigneeId,
  });
  assignmentForm.assigneeId = '';
}

function removeAssignment(index) {
  assignmentDraft.value.splice(index, 1);
}

async function saveAssignments() {
  if (!selectedTask.value) return;
  try {
    await api(`/tasks/${selectedTask.value.id}/assignments`, {
      method: 'PUT',
      body: {
        assignments: assignmentDraft.value.map((item) => ({
          role: item.role,
          assigneeType: item.assigneeType,
          assigneeId: item.assigneeId,
        })),
        baseRevision: snapshot.value?.currentRevision ?? 0,
      },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

function fillTaskEdit(task) {
  taskEdit.name = task.name ?? '';
  taskEdit.description = task.description ?? '';
  taskEdit.priority = task.priority ?? 'medium';
  taskEdit.jiraNumber = task.jiraNumber ?? '';
  taskEdit.startDate = task.startDate ? task.startDate.slice(0, 10) : '';
  taskEdit.endDate = task.endDate ? task.endDate.slice(0, 10) : '';
  taskEdit.actualEndDate = task.actualEndDate ? task.actualEndDate.slice(0, 10) : '';
  taskEdit.bpFlag = Boolean(task.bpFlag);
  taskEdit.spFlag = Boolean(task.spFlag);
}

async function commentAuthorName(userId) {
  if (!userId) return 'Пользователь';
  if (currentUser.value?.id === userId) {
    return currentUser.value.displayName || currentUser.value.email || 'Пользователь';
  }
  if (commentAuthorNames.has(userId)) return commentAuthorNames.get(userId);
  const user = await api(`/users/${userId}`).catch(() => null);
  const name = user?.displayName || user?.email || 'Пользователь';
  commentAuthorNames.set(userId, name);
  return name;
}

async function loadCommentsForTask(taskId) {
  comments.value = [];
  commentBody.value = '';
  editingCommentId.value = '';
  editCommentBody.value = '';
  commentsLoading.value = true;
  try {
    const response = await api(`/comments?entityType=task&entityId=${taskId}`);
    const items = (response.items ?? []).filter(
      (comment) => !comment.entityId || comment.entityId === taskId,
    );
    const authorIds = [...new Set(items.map((comment) => comment.authorUserId).filter(Boolean))];
    const names = new Map(
      await Promise.all(
        authorIds.map(async (userId) => [userId, await commentAuthorName(userId)]),
      ),
    );
    comments.value = items.map((comment) => ({
      ...comment,
      authorName: names.get(comment.authorUserId) || 'Пользователь',
    }));
  } catch (reason) {
    error.value = reason.message;
  } finally {
    commentsLoading.value = false;
  }
}

async function selectTask(task) {
  selectedTask.value = task;
  progress.value = Number(task.progress) || 0;
  status.value = task.status ?? 'planned';
  fillTaskEdit(task);
  fillAssignments(task);
  moveForm.directionId = '';
  moveForm.sortOrder = 0;
  await loadCommentsForTask(task.id);
}

function openDiagramModal() {
  diagramForm.name = '';
  diagramForm.description = '';
  diagramForm.dayMode = 'working';
  showDiagramModal.value = true;
}

function closeDiagramModal() {
  showDiagramModal.value = false;
}

async function createDiagram() {
  if (!diagramForm.name.trim() || !projectId.value) return;
  try {
    const diagram = await api(`/projects/${projectId.value}/diagrams`, {
      method: 'POST',
      body: {
        name: diagramForm.name,
        description: diagramForm.description,
        dayMode: diagramForm.dayMode,
      },
    });
    diagramForm.name = '';
    diagramForm.description = '';
    showDiagramModal.value = false;
    await loadDiagrams(diagram.id);
  } catch (reason) {
    error.value = reason.message;
  }
}

function openDirectionCreateModal() {
  Object.assign(directionEdit, {
    id: '',
    version: 0,
    name: '',
    description: '',
    result: '',
    priority: 'medium',
    startDate: '',
    endDate: '',
    jiraNumber: '',
    bpFlag: false,
    spFlag: false,
    responsibleId: '',
  });
  showDirectionModal.value = true;
}

function openDirectionModal(direction) {
  directionEdit.id = direction.id;
  directionEdit.version = direction.version ?? 0;
  directionEdit.name = direction.name ?? '';
  directionEdit.description = direction.description ?? '';
  directionEdit.result = direction.result ?? '';
  directionEdit.priority = direction.priority ?? 'medium';
  directionEdit.startDate = direction.startDate ? direction.startDate.slice(0, 10) : '';
  directionEdit.endDate = direction.endDate ? direction.endDate.slice(0, 10) : '';
  directionEdit.jiraNumber = direction.jiraNumber ?? '';
  directionEdit.bpFlag = Boolean(direction.bpFlag);
  directionEdit.spFlag = Boolean(direction.spFlag);
  directionEdit.responsibleId =
    (direction.assignments ?? []).find((item) => item.role === 'responsible')?.assigneeId ?? '';
  showDirectionModal.value = true;
}

function closeDirectionModal() {
  showDirectionModal.value = false;
}

async function saveDirectionEdit() {
  if (!directionEdit.name.trim() || !diagramId.value) return;
  try {
    const payload = {
      name: directionEdit.name,
      description: directionEdit.description,
      result: directionEdit.result,
      priority: directionEdit.priority,
      startDate: directionEdit.startDate || null,
      endDate: directionEdit.endDate || null,
      jiraNumber: directionEdit.jiraNumber,
      bpFlag: directionEdit.bpFlag,
      spFlag: directionEdit.spFlag,
    };
    let directionId = directionEdit.id;
    if (directionId) {
      await api(`/directions/${directionId}`, {
        method: 'PATCH',
        body: {
          ...payload,
          expectedVersion: directionEdit.version,
          baseRevision: snapshot.value?.currentRevision ?? 0,
        },
      });
    } else {
      const created = await api(`/diagrams/${diagramId.value}/directions`, {
        method: 'POST',
        body: payload,
      });
      directionId = created.id;
    }
    if (directionEdit.responsibleId) {
      await api(`/directions/${directionId}/responsible`, {
        method: 'PUT',
        body: {
          assignment: { assigneeType: 'user', assigneeId: directionEdit.responsibleId },
          baseRevision: snapshot.value?.currentRevision ?? 0,
        },
      });
    }
    showDirectionModal.value = false;
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function saveTask() {
  if (!selectedTask.value || !taskEdit.name.trim()) return;
  try {
    await api(`/tasks/${selectedTask.value.id}`, {
      method: 'PATCH',
      body: {
        expectedVersion: selectedTask.value.version,
        baseRevision: snapshot.value?.currentRevision ?? 0,
        name: taskEdit.name,
        description: taskEdit.description,
        priority: taskEdit.priority,
        jiraNumber: taskEdit.jiraNumber,
        startDate: taskEdit.startDate || null,
        endDate: taskEdit.endDate || null,
        actualEndDate: taskEdit.actualEndDate || null,
        bpFlag: taskEdit.bpFlag,
        spFlag: taskEdit.spFlag,
      },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function deleteTask() {
  if (!selectedTask.value) return false;
  if (!window.confirm(`Удалить задачу «${selectedTask.value.name}»?`)) return false;
  try {
    await api(
      `/tasks/${selectedTask.value.id}?expectedVersion=${selectedTask.value.version}&baseRevision=${snapshot.value?.currentRevision ?? 0}`,
      { method: 'DELETE' },
    );
    await loadSnapshot();
    return true;
  } catch (reason) {
    error.value = reason.message;
    return false;
  }
}

async function saveProgress() {
  if (!selectedTask.value || savingProgress.value) return;
  await nextTick();
  savingProgress.value = true;
  const submittedStatus = status.value;
  const submittedProgress = Number(progress.value);
  try {
    const payload = {
      status: submittedStatus,
      progress: submittedProgress,
    };
    let updated;
    try {
      updated = await api(`/tasks/${selectedTask.value.id}/progress`, {
        method: 'PATCH',
        body: { ...payload, expectedVersion: selectedTask.value.version },
      });
    } catch (reason) {
      if (!String(reason.message).includes('version_conflict')) throw reason;
      await loadSnapshot(true);
      if (!selectedTask.value) throw reason;
      updated = await api(`/tasks/${selectedTask.value.id}/progress`, {
        method: 'PATCH',
        body: { ...payload, expectedVersion: selectedTask.value.version },
      });
    }
    const responseStatus = updated.status ?? 'planned';
    const responseProgress = Number(updated.progress) || 0;
    selectedTask.value = updated;
    if (status.value === submittedStatus) status.value = responseStatus;
    if (Number(progress.value) === submittedProgress) progress.value = responseProgress;
    loadSnapshot(true).catch((reason) => (error.value = reason.message));
  } catch (reason) {
    error.value = reason.message;
  } finally {
    savingProgress.value = false;
  }
}

async function saveTaskAll() {
  if (!selectedTask.value || savingTask.value) return;
  await nextTick();
  savingTask.value = true;
  error.value = '';
  const submitted = {
    status: status.value,
    progress: Number(progress.value),
    assignments: assignmentDraft.value.map((item) => ({
      role: item.role,
      assigneeType: item.assigneeType,
      assigneeId: item.assigneeId,
    })),
  };
  try {
    let task = await api(`/tasks/${selectedTask.value.id}`, {
      method: 'PATCH',
      body: {
        expectedVersion: selectedTask.value.version,
        baseRevision: snapshot.value?.currentRevision ?? 0,
        name: taskEdit.name,
        description: taskEdit.description,
        priority: taskEdit.priority,
        jiraNumber: taskEdit.jiraNumber,
        startDate: taskEdit.startDate || null,
        endDate: taskEdit.endDate || null,
        actualEndDate: taskEdit.actualEndDate || null,
        bpFlag: taskEdit.bpFlag,
        spFlag: taskEdit.spFlag,
      },
    });
    task = await api(`/tasks/${task.id}/progress`, {
      method: 'PATCH',
      body: {
        status: submitted.status,
        progress: submitted.progress,
        expectedVersion: task.version,
      },
    });
    if (moveForm.directionId || Number(moveForm.sortOrder) > 0) {
      task = await api(`/tasks/${task.id}/move`, {
        method: 'POST',
        body: {
          directionId: moveForm.directionId || task.directionId,
          sortOrder: Number(moveForm.sortOrder) || 0,
          expectedVersion: task.version,
          baseRevision: snapshot.value?.currentRevision ?? 0,
        },
      });
    }
    task = await api(`/tasks/${task.id}/assignments`, {
      method: 'PUT',
      body: {
        assignments: submitted.assignments,
        baseRevision: snapshot.value?.currentRevision ?? 0,
      },
    });
    selectedTask.value = task;
    status.value = task.status ?? submitted.status;
    progress.value = Number(task.progress) || submitted.progress;
    moveForm.directionId = '';
    moveForm.sortOrder = 0;
    fillTaskEdit(task);
    fillAssignments(task);
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  } finally {
    savingTask.value = false;
  }
}

async function addComment() {
  const taskId = editingTaskId.value || selectedTask.value?.id;
  if (!taskId || !commentBody.value.trim()) return;
  try {
    const comment = await api('/comments', {
      method: 'POST',
      body: {
        entityType: 'task',
        entityId: taskId,
        body: commentBody.value,
      },
    });
    if (comment.entityId && comment.entityId !== taskId) {
      throw new Error('Комментарий сохранился не для выбранной задачи');
    }
    commentBody.value = '';
    await loadCommentsForTask(taskId);
  } catch (reason) {
    error.value = reason.message;
  }
}

function startEditComment(comment) {
  editingCommentId.value = comment.id;
  editCommentBody.value = comment.body;
}

async function saveComment(comment) {
  if (!editCommentBody.value.trim()) return;
  try {
    await api(`/comments/${comment.id}`, {
      method: 'PATCH',
      body: { body: editCommentBody.value },
    });
    editingCommentId.value = '';
    await loadCommentsForTask(editingTaskId.value || selectedTask.value.id);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function deleteComment(commentId) {
  const taskId = editingTaskId.value || selectedTask.value?.id;
  if (!taskId) return;
  try {
    await api(`/comments/${commentId}`, { method: 'DELETE' });
    await loadCommentsForTask(taskId);
  } catch (reason) {
    error.value = reason.message;
  }
}

function onTaskDragStart(event, task) {
  dragTaskId.value = task.id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', task.id);
}

function onTaskDragOver(event, targetRow) {
  if (!dragTaskId.value) return;
  dragOverId.value = targetRow.key;
  if (targetRow.type === 'direction') {
    dragOverMode.value = 'inside';
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  dragOverMode.value = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
}

function nextSortOrder(directionId, parentTaskId = null) {
  const siblings = (snapshot.value?.tasks ?? []).filter(
    (task) =>
      task.directionId === directionId &&
      (parentTaskId ? task.parentTaskId === parentTaskId : !task.parentTaskId),
  );
  return Math.max(0, ...siblings.map((task) => Number(task.sortOrder) || 0)) + 1;
}

async function onTaskDrop(event, targetRow) {
  event.preventDefault();
  const taskId = dragTaskId.value || event.dataTransfer.getData('text/plain');
  const mode = dragOverMode.value || 'inside';
  dragTaskId.value = '';
  dragOverId.value = '';
  dragOverMode.value = '';
  if (!taskId || taskId === targetRow.task?.id) return;
  const dragged = (snapshot.value?.tasks ?? []).find((task) => task.id === taskId);
  if (!dragged) return;
  if (targetRow.type === 'direction') {
    await moveTaskTo(
      taskId,
      targetRow.direction.id,
      null,
      nextSortOrder(targetRow.direction.id),
    );
    return;
  }
  const target = targetRow.task;
  const dropAsChild = mode === 'inside' && target.level === 2 && !dragged.childrenCount;
  if (dropAsChild) {
    await moveTaskTo(
      taskId,
      target.directionId,
      target.id,
      nextSortOrder(target.directionId, target.id),
    );
  } else {
    await moveTaskTo(
      taskId,
      target.directionId,
      target.parentTaskId,
      Number(target.sortOrder) + (mode === 'after' ? 1 : 0),
    );
  }
}

async function moveTaskTo(taskId, directionId, parentTaskId, sortOrder = 9999) {
  try {
    await api(`/tasks/${taskId}/move`, {
      method: 'POST',
      body: {
        directionId,
        parentTaskId: parentTaskId || '',
        sortOrder,
        expectedVersion: (snapshot.value?.tasks ?? []).find((task) => task.id === taskId)?.version ?? 0,
        baseRevision: snapshot.value?.currentRevision ?? 0,
      },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function moveTask() {
  if (!selectedTask.value) return;
  try {
    await api(`/tasks/${selectedTask.value.id}/move`, {
      method: 'POST',
      body: {
        directionId: moveForm.directionId || selectedTask.value.directionId,
        sortOrder: Number(moveForm.sortOrder) || 0,
        expectedVersion: selectedTask.value.version,
        baseRevision: snapshot.value?.currentRevision ?? 0,
      },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

function quickProgress() {
  if (!selectedTask.value) return;
  progress.value = Math.min(100, Number(progress.value) + 25);
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.assign('/login');
}

const projectName = computed(
  () => projects.value.find((project) => project.id === projectId.value)?.name ?? 'Проект',
);

const ganttRows = computed(() => {
  const query = filterQuery.value.trim().toLowerCase();
  const filtering = Boolean(query || filterStatus.value || selectedExecutor.value);
  const allTasks = snapshot.value?.tasks ?? [];
  const matches = (task) => {
    const matchesQuery =
      !query ||
      task.name?.toLowerCase().includes(query) ||
      task.wbsCode?.toLowerCase().includes(query);
    const matchesStatus = !filterStatus.value || task.status === filterStatus.value;
    const matchesExecutor =
      !selectedExecutor.value ||
      (task.assignments ?? []).some(
        (assignment) => assignment.role === 'executor' && assignment.assigneeId === selectedExecutor.value,
      );
    return matchesQuery && matchesStatus && matchesExecutor;
  };
  const matched = new Set(allTasks.filter(matches).map((task) => task.id));
  const byId = new Map(allTasks.map((task) => [task.id, task]));
  const context = new Set(matched);
  if (filtering) {
    for (const id of matched) {
      let current = byId.get(id);
      while (current?.parentTaskId) {
        context.add(current.parentTaskId);
        current = byId.get(current.parentTaskId);
      }
    }
  }
  const childrenByParent = new Map();
  for (const task of allTasks) {
    const key = task.parentTaskId ?? '';
    const list = childrenByParent.get(key) ?? [];
    list.push(task);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
  }
  const rows = [];
  const pushTask = (task, depth) => {
    rows.push({
      key: `task-${task.id}`,
      type: 'task',
      task,
      depth,
      isContext: filtering && !matched.has(task.id),
    });
    if (collapsed.value.includes(task.id)) return;
    for (const child of childrenByParent.get(task.id) ?? []) pushTask(child, depth + 1);
  };
  const directions = snapshot.value?.directions ?? [];
  for (const direction of directions) {
    const roots = (childrenByParent.get('') ?? []).filter((task) => task.directionId === direction.id);
    const visibleRoots = filtering
      ? roots.filter((task) => context.has(task.id))
      : roots;
    if (filtering && !visibleRoots.length) continue;
    rows.push({
      key: `direction-${direction.id}`,
      type: 'direction',
      direction,
      depth: 0,
      tasksCount: roots.reduce((sum, task) => sum + 1 + (childrenByParent.get(task.id)?.length ?? 0), 0),
    });
    if (collapsed.value.includes(direction.id)) continue;
    for (const task of visibleRoots) pushTask(task, 1);
  }
  const ungrouped = (childrenByParent.get('') ?? []).filter(
    (task) => !directions.some((direction) => direction.id === task.directionId),
  );
  const ungroupedVisible = filtering ? ungrouped.filter((task) => context.has(task.id)) : ungrouped;
  if (ungroupedVisible.length) {
    rows.push({
      key: 'direction-ungrouped',
      type: 'direction',
      direction: { name: 'Без направления' },
      depth: 0,
      tasksCount: ungroupedVisible.length,
    });
    for (const task of ungroupedVisible) pushTask(task, 1);
  }
  return rows.map((row, index) => ({ ...row, index }));
});

function toggleCollapse(id) {
  collapsed.value = collapsed.value.includes(id)
    ? collapsed.value.filter((item) => item !== id)
    : [...collapsed.value, id];
  localStorage.setItem('oati_gantt_collapsed_v1', JSON.stringify(collapsed.value));
}

function assignmentByRole(task, role) {
  const assignment = (task.assignments ?? []).find((item) => item.role === role);
  return assignment ? assignmentName(assignment) : '';
}

function priorityLabel(value) {
  return (
    {
      low: 'низкий',
      medium: 'средний',
      high: 'высокий',
      critical: 'критический',
    }[value] ?? value
  );
}

function placeBarTooltip() {
  if (!barTooltip.value) return;
  const element = barTooltipRef.value;
  if (!element) return;
  const { clientX, clientY } = barTooltip.value;
  const rect = element.getBoundingClientRect();
  let x = clientX + 16;
  let y = clientY + 16;
  if (x + rect.width > window.innerWidth - 8) x = clientX - rect.width - 16;
  if (y + rect.height > window.innerHeight - 8) y = clientY - rect.height - 16;
  barTooltip.value.x = Math.max(8, x);
  barTooltip.value.y = Math.max(8, y);
}

function showBarTooltip(event, task) {
  if (barDragPreview.value) return;
  barTooltip.value = {
    task,
    clientX: event.clientX,
    clientY: event.clientY,
    x: event.clientX + 16,
    y: event.clientY + 16,
  };
  requestAnimationFrame(placeBarTooltip);
}

function moveBarTooltip(event) {
  if (!barTooltip.value) return;
  barTooltip.value.clientX = event.clientX;
  barTooltip.value.clientY = event.clientY;
  placeBarTooltip();
}

function hideBarTooltip() {
  barTooltip.value = null;
}

function taskTooltip(task) {
  const parts = [
    `${task.wbsCode} · ${task.name}`,
    task.description,
    task.startDate || task.endDate
      ? `Срок: ${formatShortDate(task.startDate)} — ${formatShortDate(task.effectiveEndDate ?? task.endDate)} (${task.days ?? 0} дн.)`
      : '',
    task.actualEndDate ? `Факт: ${formatShortDate(task.actualEndDate)}` : '',
    Number(task.estimatedHours) > 0 ? `Часы: ${task.estimatedHours} ч` : '',
    `Статус: ${statusLabel(task.status)} · ${task.progress}% · ${task.priority}`,
    assignmentByRole(task, 'executor') ? `Исполнитель: ${assignmentByRole(task, 'executor')}` : '',
    assignmentByRole(task, 'co_executor') ? `Соисполнитель: ${assignmentByRole(task, 'co_executor')}` : '',
    task.jiraNumber ? `Jira: ${task.jiraNumber}` : '',
    task.isCritical ? 'Критический путь' : task.float != null ? `Резерв: ${task.float} дн.` : '',
    task.commentsCount ? `Комментарии: ${task.commentsCount}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

function priorityClass(priority) {
  return `priority-${priority || 'medium'}`;
}

function changeZoom(delta) {
  zoom.value = Math.min(2, Math.max(0.5, Number((zoom.value + delta).toFixed(2))));
  localStorage.setItem('oati_gantt_zoom_v1', String(zoom.value));
}

function isLinkSource(type, id) {
  return linkFrom.value?.type === type && linkFrom.value?.id === id;
}

function toggleLinkMode() {
  linkMode.value = !linkMode.value;
  linkFrom.value = null;
  error.value = '';
}

async function pickLink(type, entity) {
  if (!linkFrom.value) {
    linkFrom.value = { type, id: entity.id };
    return;
  }
  const from = linkFrom.value;
  if (from.type === type && from.id === entity.id) {
    linkFrom.value = null;
    return;
  }
  if (from.type === 'direction' && type === 'task') {
    error.value = 'От направления можно строить связь только к направлению';
    return;
  }
  try {
    error.value = '';
    await api(`/diagrams/${diagramId.value}/dependencies`, {
      method: 'POST',
      body: {
        predecessorType: from.type,
        predecessorId: from.id,
        successorType: type,
        successorId: entity.id,
      },
    });
    linkFrom.value = null;
    linkMode.value = false;
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

function onDirectionBarClick(direction) {
  if (linkMode.value) {
    pickLink('direction', direction);
  } else {
    openDirectionModal(direction);
  }
}

async function toggleFlag(task, key) {
  try {
    await api(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: {
        expectedVersion: task.version,
        baseRevision: snapshot.value?.currentRevision ?? 0,
        [key]: !task[key],
      },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

function startSubtask(task) {
  openTaskModal({ directionId: task.directionId, parentTaskId: task.id });
}

function taskFlags(task) {
  return `${task.bpFlag ? 'БП ' : ''}${task.spFlag ? 'СП' : ''}`.trim();
}

function isTaskDoneEarly(task) {
  return Number(task.doneDeltaDays) > 0;
}

const timelineRange = computed(() => {
  const tasks = snapshot.value?.tasks ?? [];
  const dates = tasks
    .flatMap((task) => [task.startDate, task.effectiveEndDate ?? task.endDate])
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  const today = new Date();
  const min = dates.length ? Math.min(...dates, today.getTime()) : today.getTime();
  const max = dates.length ? Math.max(...dates, today.getTime()) : min + 1000 * 60 * 60 * 24 * 30;
  return { min, max: Math.max(max, min + 1000 * 60 * 60 * 24 * 7) };
});

const timelineWeeks = computed(() => {
  const { min, max } = timelineRange.value;
  const span = max - min;
  const bucketCount = 8;
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(min + (span / bucketCount) * index);
    const end = new Date(min + (span / bucketCount) * (index + 1));
    return {
      label: `${start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}–${end.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`,
      left: `${(100 / bucketCount) * index}%`,
      width: `${100 / bucketCount}%`,
    };
  });
});

const weekendColumns = computed(() => {
  const { min, max } = timelineRange.value;
  const span = Math.max(max - min, 1000 * 60 * 60 * 24);
  const dayMs = 1000 * 60 * 60 * 24;
  const cursor = new Date(min);
  cursor.setUTCHours(0, 0, 0, 0);
  const columns = [];
  for (let time = cursor.getTime(); time < max; time += dayMs) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) continue;
    const left = Math.max(time, min);
    const right = Math.min(time + dayMs, max);
    if (right <= left) continue;
    columns.push({
      key: time,
      style: {
        left: `${((left - min) / span) * 100}%`,
        width: `${((right - left) / span) * 100}%`,
      },
    });
  }
  return columns;
});

const todayLeft = computed(() => {
  const { min, max } = timelineRange.value;
  return `${Math.min(100, Math.max(0, ((Date.now() - min) / (max - min)) * 100))}%`;
});

const timelineBars = computed(() => {
  const taskRows = ganttRows.value.filter((row) => row.type === 'task');
  const tasks = taskRows.map((row) => row.task);
  const { min, max } = timelineRange.value;
  const span = Math.max(max - min, 1000 * 60 * 60 * 24);
  return taskRows.map((row) => {
    const { task } = row;
    const start = task.startDate
      ? new Date(task.startDate).getTime()
      : min + (span / Math.max(tasks.length, 1)) * row.index;
    const end = task.effectiveEndDate || task.endDate
      ? new Date(task.effectiveEndDate ?? task.endDate).getTime()
      : start + span / Math.max(tasks.length, 1);
    return {
      task,
      style: {
        top: `${row.index * 38 + 8}px`,
        left: `${Math.min(98, Math.max(0, ((start - min) / span) * 100))}%`,
        width: `${Math.max(4, Math.min(100, ((end - start) / span) * 100))}%`,
      },
    };
  });
});

const directionBars = computed(() => {
  const rows = ganttRows.value.filter((row) => row.type === 'direction');
  const { min, max } = timelineRange.value;
  const span = Math.max(max - min, 1000 * 60 * 60 * 24);
  return rows
    .map((row) => {
      const startValue = row.direction.startDate;
      const endValue = row.direction.endDate;
      if (!startValue || !endValue) return null;
      const start = new Date(startValue).getTime();
      const end = new Date(endValue).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return null;
      return {
        direction: row.direction,
        style: {
          top: `${row.index * 38 + 8}px`,
          left: `${Math.min(98, Math.max(0, ((start - min) / span) * 100))}%`,
          width: `${Math.max(4, Math.min(100, ((end - start) / span) * 100))}%`,
        },
      };
    })
    .filter(Boolean);
});

const dependencyLines = computed(() => {
  const taskBars = new Map(timelineBars.value.map((bar) => [`task:${bar.task.id}`, bar]));
  const directionBarsById = new Map(
    directionBars.value.map((bar) => [`direction:${bar.direction.id}`, bar]),
  );
  const findBar = (type, id) => taskBars.get(`${type}:${id}`) ?? directionBarsById.get(`${type}:${id}`);
  return (snapshot.value?.dependencies ?? [])
    .map((dependency) => {
      const from = findBar(dependency.predecessorType, dependency.predecessorId);
      const to = findBar(dependency.successorType, dependency.successorId);
      if (!from || !to) return null;
      const fromLeft = Number.parseFloat(from.style.left);
      const fromWidth = Number.parseFloat(from.style.width);
      const fromTop = Number.parseFloat(from.style.top) + 14;
      const toLeft = Number.parseFloat(to.style.left);
      const toTop = Number.parseFloat(to.style.top) + 14;
      const x1 = ((fromLeft + fromWidth) / 100) * canvasWidth.value;
      const y1 = fromTop;
      const x2 = (toLeft / 100) * canvasWidth.value;
      const y2 = toTop;
      const midX = (x1 + x2) / 2;
      const shape = dependency.arrowShape || 'orthogonal';
      const backward = x2 < x1;
      const laneRight = Math.max(x1, Math.min(canvasWidth.value - 2, x1 + 24));
      const laneLeft = Math.min(x2, Math.max(2, x2 - 24));
      const midY = (y1 + y2) / 2;
      const path =
        shape === 'straight'
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : shape === 'curved'
            ? backward
              ? `M ${x1} ${y1} C ${laneRight} ${y1}, ${laneLeft} ${y2}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
            : backward
              ? `M ${x1} ${y1} L ${laneRight} ${y1} L ${laneRight} ${midY} L ${laneLeft} ${midY} L ${laneLeft} ${y2} L ${x2} ${y2}`
              : `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
      return {
        id: dependency.id,
        dependency,
        path,
        x1,
        y1,
        x2,
        y2,
        critical: dependency.isCritical,
        color: dependency.color || '#94a3b8',
        dash: dependency.lineStyle,
        shape,
      };
    })
    .filter(Boolean);
});

const hoveredTaskIds = computed(() => {
  const dependency = (snapshot.value?.dependencies ?? []).find(
    (item) => item.id === hoveredDependencyId.value,
  );
  const ids = new Set();
  if (!dependency) return ids;
  const add = (type, id) => {
    if (type === 'task') {
      ids.add(id);
    } else if (type === 'direction') {
      for (const task of snapshot.value?.tasks ?? []) {
        if (task.directionId === id) ids.add(task.id);
      }
    }
  };
  add(dependency.predecessorType, dependency.predecessorId);
  add(dependency.successorType, dependency.successorId);
  return ids;
});

function calculateTaskEndDate(startDate, estimatedHours, dayMode, holidays = []) {
  const totalDays = Math.ceil(Number(estimatedHours) / 8);
  if (!startDate || !Number.isFinite(totalDays) || totalDays <= 0) return '';
  const holidaySet = new Set((holidays ?? []).map((item) => item.holidayDate));
  let date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const isWorking = () =>
    ![0, 6].includes(date.getUTCDay()) && !holidaySet.has(date.toISOString().slice(0, 10));
  if (dayMode === 'working') {
    while (!isWorking()) date = new Date(date.getTime() + 86400000);
    for (let remaining = totalDays - 1; remaining > 0; ) {
      date = new Date(date.getTime() + 86400000);
      if (isWorking()) remaining -= 1;
    }
  } else {
    date = new Date(date.getTime() + (totalDays - 1) * 86400000);
  }
  return date.toISOString().slice(0, 10);
}

function snapWorkday(value, direction = 1) {
  if (snapshot.value?.diagram?.dayMode !== 'working') return value;
  const holidays = new Set((snapshot.value?.holidays ?? []).map((item) => item.holidayDate));
  const date = new Date(value);
  while (holidays.has(date.toISOString().slice(0, 10)) || [0, 6].includes(date.getUTCDay())) {
    date.setUTCDate(date.getUTCDate() + direction);
  }
  return date.toISOString().slice(0, 10);
}

async function updateTaskDates(task, startDate, endDate) {
  try {
    await api(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: {
        expectedVersion: task.version,
        baseRevision: snapshot.value?.currentRevision ?? 0,
        startDate,
        endDate,
      },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

function startBarDrag(event, bar, mode) {
  if (linkMode.value) return;
  event.preventDefault();
  event.stopPropagation();
  hideBarTooltip();
  const container = event.currentTarget.closest('.gantt-canvas');
  if (!container || !bar.task.startDate) return;
  const startX = event.clientX;
  const width = container.getBoundingClientRect().width;
  const { min, max } = timelineRange.value;
  const dayMs = 1000 * 60 * 60 * 24;
  const daysInRange = Math.max(1, (max - min) / dayMs);
  const estimatedHours = Number(bar.task.estimatedHours) || 0;
  if (mode === 'end' && estimatedHours > 0) return;
  const originalStart = new Date(bar.task.startDate);
  const originalEnd = new Date(bar.task.effectiveEndDate ?? bar.task.endDate ?? bar.task.startDate);
  let moved = false;
  const onMove = (moveEvent) => {
    if (Math.abs(moveEvent.clientX - startX) > 3) moved = true;
    const deltaDays = Math.round(((moveEvent.clientX - startX) / width) * daysInRange);
    let start = originalStart;
    let end = originalEnd;
    if (mode === 'move') {
      start = new Date(originalStart.getTime() + deltaDays * dayMs);
      end = new Date(originalEnd.getTime() + deltaDays * dayMs);
    } else if (mode === 'start') {
      start = new Date(originalStart.getTime() + deltaDays * dayMs);
      if (start > end) start = end;
    } else if (mode === 'end') {
      end = new Date(originalEnd.getTime() + deltaDays * dayMs);
      if (end < start) end = start;
    }
    const previewStart = snapWorkday(start.toISOString().slice(0, 10), 1);
    if (estimatedHours > 0) {
      const autoEnd = calculateTaskEndDate(
        previewStart,
        estimatedHours,
        snapshot.value?.diagram?.dayMode ?? 'working',
        snapshot.value?.holidays ?? [],
      );
      if (autoEnd) end = new Date(`${autoEnd}T00:00:00Z`);
    }
    const previewEnd = snapWorkday(end.toISOString().slice(0, 10), -1);
    const previewStartMs = new Date(previewStart).getTime();
    const previewEndMs = new Date(previewEnd).getTime();
    const span = Math.max(max - min, dayMs);
    barDragPreview.value = {
      taskId: bar.task.id,
      top: bar.style.top,
      left: `${Math.min(98, Math.max(0, ((previewStartMs - min) / span) * 100))}%`,
      width: `${Math.max(2, Math.min(100, ((previewEndMs - previewStartMs) / span) * 100))}%`,
      start: previewStart,
      end: previewEnd,
      label: `${formatShortDate(previewStart)}–${formatShortDate(previewEnd)}`,
    };
  };
  const finish = async (apply) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey);
    const preview = barDragPreview.value;
    const changed =
      preview &&
      (preview.start !== bar.task.startDate?.slice(0, 10) ||
        preview.end !== bar.task.endDate?.slice(0, 10));
    if (moved || changed) suppressBarClickUntil = Date.now() + 500;
    barDragPreview.value = null;
    if (!apply || !preview || !changed) return;
    await updateTaskDates(bar.task, preview.start, preview.end);
  };
  const onUp = () => finish(true);
  const onKey = (keyEvent) => {
    if (keyEvent.key !== 'Escape') return;
    finish(false);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
  window.addEventListener('keydown', onKey);
}

function onBarClick(task) {
  hideBarTooltip();
  if (Date.now() < suppressBarClickUntil) return;
  if (linkMode.value) {
    pickLink('task', task);
  } else {
    openTaskEditor(task);
  }
}

function printChart() {
  window.print();
}

async function exportPdf() {
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const element = document.querySelector('.gantt-frame');
    if (!element) return;
    const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const width = 277;
    const height = (canvas.height * width) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, width, Math.min(height, 190));
    pdf.save(`RP_GANT_диаграмма_Ганта_${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (reason) {
    error.value = reason.message;
  }
}

function formatShortDate(value) {
  return value ? new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';
}

function statusBadgeClass(statusValue) {
  return (
    {
      done: 'badge-success',
      in_progress: 'badge-primary',
      blocked: 'badge-danger',
      postponed: 'badge-postponed',
      planned: 'badge-neutral',
    }[statusValue] ?? 'badge-neutral'
  );
}

function initials(user) {
  const name = user?.displayName || user?.firstName || user?.email || '';
  return String(name).slice(0, 2).toUpperCase();
}

function entityLabel(type, id) {
  if (type === 'direction') {
    return (snapshot.value?.directions ?? []).find((item) => item.id === id)?.name ?? id;
  }
  const task = (snapshot.value?.tasks ?? []).find((item) => item.id === id);
  return task ? `${task.wbsCode} ${task.name}` : id;
}

function dependencyEntities(type) {
  if (type === 'direction') {
    return (snapshot.value?.directions ?? []).map((item) => ({ id: item.id, label: item.name }));
  }
  return (snapshot.value?.tasks ?? []).map((item) => ({
    id: item.id,
    label: `${item.wbsCode} ${item.name}`,
  }));
}

function onDependencyPredecessorTypeChange() {
  dependencyEdit.predecessorId = '';
  if (dependencyEdit.predecessorType === 'direction' && dependencyEdit.successorType === 'task') {
    dependencyEdit.successorType = 'direction';
    dependencyEdit.successorId = '';
  }
}

function onDependencySuccessorTypeChange() {
  dependencyEdit.successorId = '';
  if (dependencyEdit.successorType === 'task' && dependencyEdit.predecessorType === 'direction') {
    dependencyEdit.predecessorType = 'task';
    dependencyEdit.predecessorId = '';
  }
}

function resetDependencyDraft() {
  Object.assign(dependencyEdit, {
    id: '',
    predecessorType: 'task',
    predecessorId: '',
    successorType: 'task',
    successorId: '',
    color: '#94a3b8',
    lineStyle: 'solid',
    arrowShape: 'orthogonal',
  });
}

function openDependency(dependency = null) {
  showDependencyModal.value = true;
  editingDependency.value = dependency;
  if (!dependency) {
    resetDependencyDraft();
    return;
  }
  Object.assign(dependencyEdit, {
    id: dependency.id,
    predecessorType: dependency.predecessorType,
    predecessorId: dependency.predecessorId,
    successorType: dependency.successorType,
    successorId: dependency.successorId,
    color: dependency.color || '#94a3b8',
    lineStyle: dependency.lineStyle || 'solid',
    arrowShape: dependency.arrowShape || 'orthogonal',
  });
}

function closeDependency() {
  showDependencyModal.value = false;
  editingDependency.value = null;
}

async function saveDependency() {
  if (!dependencyEdit.predecessorId || !dependencyEdit.successorId) return;
  const payload = {
    predecessorType: dependencyEdit.predecessorType,
    predecessorId: dependencyEdit.predecessorId,
    successorType: dependencyEdit.successorType,
    successorId: dependencyEdit.successorId,
    color: dependencyEdit.color,
    lineStyle: dependencyEdit.lineStyle,
    arrowShape: dependencyEdit.arrowShape,
  };
  try {
    if (dependencyEdit.id) {
      await api(`/dependencies/${dependencyEdit.id}`, {
        method: 'PATCH',
        body: { ...payload, baseRevision: snapshot.value?.currentRevision ?? 0 },
      });
    } else {
      await api(`/diagrams/${diagramId.value}/dependencies`, {
        method: 'POST',
        body: payload,
      });
    }
    await loadSnapshot(true);
    closeDependency();
  } catch (reason) {
    error.value = reason.message;
  }
}

function resetDependencyStyle() {
  dependencyEdit.color = '#94a3b8';
  dependencyEdit.lineStyle = 'solid';
  dependencyEdit.arrowShape = 'orthogonal';
}

async function removeEditingDependency() {
  if (!dependencyEdit.id) return;
  const id = dependencyEdit.id;
  closeDependency();
  await deleteDependency(id);
}

async function updateDependencyStyle(dependency, patch) {
  try {
    await api(`/dependencies/${dependency.id}`, {
      method: 'PATCH',
      body: { ...patch, baseRevision: snapshot.value?.currentRevision ?? 0 },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function deleteDependency(dependencyId) {
  try {
    await api(`/dependencies/${dependencyId}`, { method: 'DELETE' });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function saveHolidays(items) {
  try {
    await api(`/diagrams/${diagramId.value}/holidays`, {
      method: 'PUT',
      body: { items, baseRevision: snapshot.value?.currentRevision ?? 0 },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

async function setDayMode(mode) {
  if (!diagramId.value || snapshot.value?.diagram?.dayMode === mode) return;
  try {
    await api(`/diagrams/${diagramId.value}`, {
      method: 'PATCH',
      body: { dayMode: mode, baseRevision: snapshot.value?.currentRevision ?? 0 },
    });
    await loadSnapshot(true);
  } catch (reason) {
    error.value = reason.message;
  }
}

function openCalendarModal() {
  holidayDate.value = '';
  holidayName.value = '';
  showCalendarModal.value = true;
}

function closeCalendarModal() {
  showCalendarModal.value = false;
}

async function addHolidayPreset() {
  const year = new Date().getFullYear();
  const dates = [
    `${year}-01-01`, `${year}-01-02`, `${year}-01-07`, `${year}-01-08`,
    `${year}-02-23`, `${year}-03-08`, `${year}-05-01`, `${year}-05-09`,
    `${year}-06-12`, `${year}-11-04`,
  ];
  const existing = (snapshot.value?.holidays ?? []).map((holiday) => ({
    holidayDate: holiday.holidayDate,
    name: holiday.name ?? '',
  }));
  for (const date of dates) {
    if (!existing.some((holiday) => holiday.holidayDate === date)) {
      existing.push({ holidayDate: date, name: 'Праздник' });
    }
  }
  await saveHolidays(existing);
}

async function addHoliday() {
  if (!holidayDate.value) return;
  const existing = (snapshot.value?.holidays ?? []).map((holiday) => ({
    holidayDate: holiday.holidayDate,
    name: holiday.name ?? '',
  }));
  if (existing.some((holiday) => holiday.holidayDate === holidayDate.value)) return;
  existing.push({ holidayDate: holidayDate.value, name: holidayName.value });
  await saveHolidays(existing);
  holidayDate.value = '';
  holidayName.value = '';
}

async function deleteHoliday(date) {
  const items = (snapshot.value?.holidays ?? [])
    .filter((holiday) => holiday.holidayDate !== date)
    .map((holiday) => ({ holidayDate: holiday.holidayDate, name: holiday.name ?? '' }));
  await saveHolidays(items);
}

async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !diagramId.value) return;
  pendingImportFile.value = file;
  importPreview.value = null;
  importJob.value = null;
  showImportModal.value = true;
  const text = await file.text();
  if (importFormat.value === 'csv' || file.name.toLowerCase().endsWith('.csv')) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#'));
    const delimiter = lines[0]?.includes(';') ? ';' : ',';
    const headers = (lines[0] ?? '').split(delimiter).map((value) => value.trim());
    importPreview.value = {
      fileName: file.name,
      format: 'csv',
      rows: Math.max(0, lines.length - 1),
      columns: headers.length,
      warnings: headers.length < 5 ? ['Недостаточно колонок для полного импорта'] : [],
      errors: [],
    };
    await requestServerPreview(file);
    return;
  }
  try {
    const payload = JSON.parse(text);
    const items = Array.isArray(payload.tasks) ? payload.tasks : [];
    const directions = Array.isArray(payload.directions)
      ? payload.directions.length
      : items.filter((item) => Number(item.level) === 1).length;
    const warnings = [];
    if (payload.formatVersion !== 2 && items.some((item) => item.ownerId && !/^[0-9a-f-]{36}$/i.test(item.ownerId))) {
      warnings.push('Локальные исполнители из HTML-файла будут пропущены без сопоставления с сервером');
    }
    if (payload.formatVersion !== 2 && items.some((item) => item.comments?.some((comment) => comment.author))) {
      warnings.push('Авторы комментариев будут заменены текущим пользователем');
    }
    importPreview.value = {
      fileName: file.name,
      format: payload.formatVersion === 2 ? 'server JSON' : 'standalone JSON',
      directions,
      tasks: payload.formatVersion === 2 ? items.length : items.filter((item) => Number(item.level) >= 2).length,
      dependencies:
        payload.dependencies?.length ??
        items.reduce((sum, item) => sum + String(item.dependencies ?? '').split(/[;,]/).filter(Boolean).length, 0),
      holidays: payload.workdays?.holidays?.length ?? payload.holidays?.length ?? 0,
      warnings,
      errors: items.length ? [] : ['В файле не найдено задач'],
    };
    await requestServerPreview(file);
  } catch (reason) {
    importPreview.value = { fileName: file.name, format: 'json', errors: [reason.message], warnings: [] };
  }
}

async function requestServerPreview(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('format', file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json');
    const response = await fetch(
      `/api/v1/diagrams/${diagramId.value}/import?preview=true`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken() ?? '' },
        body: formData,
      },
    );
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
    const job = await response.json();
    const issues = job.report?.issues ?? [];
    const warnings = issues
      .map((issue) => issue.message ?? issue.code)
      .filter(Boolean)
      .slice(0, 20);
    importPreview.value = {
      ...(importPreview.value ?? { fileName: file.name }),
      fileName: file.name,
      directions: job.report?.directionsCount ?? importPreview.value?.directions ?? 0,
      tasks: job.report?.tasksCount ?? importPreview.value?.tasks ?? 0,
      serverValidated: true,
      warnings: [...(importPreview.value?.warnings ?? []), ...warnings],
      errors: job.status === 'failed' ? [job.errorMessage || 'Импорт отклонён сервером'] : [],
    };
  } catch (reason) {
    importPreview.value = {
      ...(importPreview.value ?? { fileName: file.name }),
      serverValidated: false,
      errors: [...(importPreview.value?.errors ?? []), reason.message],
    };
  }
}

function closeImportModal() {
  if (importing.value) return;
  showImportModal.value = false;
  importPreview.value = null;
  importJob.value = null;
  pendingImportFile.value = null;
}

async function applyImport() {
  const file = pendingImportFile.value;
  if (!file || !diagramId.value) return;
  importing.value = true;
  importJob.value = null;
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('format', file.name.toLowerCase().endsWith('.csv') ? 'csv' : importFormat.value);
    const response = await fetch(`/api/v1/diagrams/${diagramId.value}/import`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken() ?? '' },
      body: formData,
    });
    if (!response.ok) {
      throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
    }
    importJob.value = await response.json();
    pendingImportFile.value = null;
    await pollImport(importJob.value.id);
  } catch (reason) {
    error.value = reason.message;
  } finally {
    importing.value = false;
  }
}

async function pollImport(jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    importJob.value = await api(`/import-jobs/${jobId}`);
    if (importJob.value.status === 'completed') {
      await loadSnapshot(true);
      return;
    }
    if (importJob.value.status === 'failed' || importJob.value.status === 'cancelled') return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function scheduleSnapshotReload() {
  clearTimeout(syncReloadTimer);
  syncReloadTimer = setTimeout(() => {
    if (diagramId.value) loadSnapshot(true).catch((reason) => (error.value = reason.message));
  }, 250);
}

async function connectSync() {
  clearTimeout(syncReconnectTimer);
  clearTimeout(syncRefreshTimer);
  try {
    const issued = await api('/sync/token');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.__SYNC_URL__ || `${protocol}//${window.location.host.replace('app.', 'sync.')}/ws`;
    syncSocket = new WebSocket(`${host}?token=${encodeURIComponent(issued.token)}`);
    syncSocket.addEventListener('open', () => {
      syncConnected.value = true;
    });
    syncSocket.addEventListener('close', () => {
      syncConnected.value = false;
      syncReconnectTimer = setTimeout(connectSync, 3000);
    });
    syncSocket.addEventListener('error', () => {
      syncConnected.value = false;
    });
    syncSocket.addEventListener('message', (message) => {
      let payload;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }
      if (payload.type !== 'diagram.changed' || !payload.event) return;
      if (payload.event.diagram_id !== diagramId.value) return;
      if (payload.event.actor_user_id && payload.event.actor_user_id === currentUser.value?.id) return;
      loadUnread();
      scheduleSnapshotReload();
    });
    syncRefreshTimer = setTimeout(connectSync, Math.max(60, (issued.expiresIn ?? 300) - 30) * 1000);
  } catch {
    syncConnected.value = false;
    syncReconnectTimer = setTimeout(connectSync, 3000);
  }
}

onUnmounted(() => {
  clearTimeout(syncReconnectTimer);
  clearTimeout(syncRefreshTimer);
  clearTimeout(syncReloadTimer);
  clearInterval(unreadTimer);
  syncSocket?.close();
});

onMounted(async () => {
  try {
    collapsed.value = JSON.parse(localStorage.getItem('oati_gantt_collapsed_v1') || '[]');
    zoom.value = Number(localStorage.getItem('oati_gantt_zoom_v1')) || 1;
    labelWidth.value = Number(localStorage.getItem('oati_gantt_label_w_v1')) || 420;
    const session = await api('/auth/session');
    currentUser.value = session?.user ?? session;
    await loadProjects();
    await loadUnread();
    unreadTimer = setInterval(loadUnread, 60_000);
    await connectSync();
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="app-shell gantt-shell">
    <AppHeader :user="currentUser" :unread-count="unreadCount" active-page="projects" @logout="logout">
      <template #status>
        <span class="sync-status" :class="{ online: syncConnected }">{{ syncConnected ? 'Синхронизировано' : 'Офлайн' }}</span>
      </template>
    </AppHeader>

    <main class="page gantt-page">
      <div class="gantt-context">
        <div class="breadcrumbs"><a href="/projects">Проекты</a><span class="sep">/</span><span>{{ projectName }}</span><span class="sep">/</span><strong>{{ snapshot?.diagram?.name || 'Gantt' }}</strong></div>

        <div v-if="projects.length" class="project-bar">
          <label>
            <span>Проект</span>
            <select v-model="projectId" class="input" @change="selectProject()">
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
          </label>
          <label v-if="diagrams.length">
            <span>Диаграмма</span>
            <select v-model="diagramId" class="input" @change="loadSnapshot()">
              <option v-for="diagram in diagrams" :key="diagram.id" :value="diagram.id">{{ diagram.name }}</option>
            </select>
          </label>
          <button class="btn btn-secondary btn-sm" type="button" @click="openDiagramModal">＋ Новая диаграмма</button>
          <button class="btn btn-secondary btn-sm project-create-toggle" type="button" @click="showProjectForm = !showProjectForm">
            ＋ Новый проект
          </button>
        </div>
      </div>

      <form v-if="showProjectForm" class="card project-create-form" @submit.prevent="createProject">
        <input v-model="projectForm.name" class="input" placeholder="Название проекта" required />
        <input v-model="projectForm.description" class="input" placeholder="Описание" />
        <button class="btn btn-primary" type="submit">Создать проект</button>
      </form>

      <div v-if="snapshot" class="gantt-topline">
        <div class="gantt-title-row">
          <div>
            <div class="title-line"><h1 class="gantt-title">{{ snapshot.diagram?.name }}</h1><span class="badge badge-primary badge-dot">В работе</span></div>
            <div class="muted small">
              Ревизия {{ snapshot.currentRevision }} · {{ snapshot.tasks?.length || 0 }} задач · {{ members.length }} участников
              <template v-if="snapshot.schedule">
                · готовность {{ snapshot.schedule.overallProgress }}% · {{ formatShortDate(snapshot.schedule.projectStart) }}–{{
                  formatShortDate(snapshot.schedule.projectEnd)
                }}
              </template>
            </div>
          </div>
        </div>
        <div class="gantt-top-actions">
          <span class="sync-state">{{ syncConnected ? 'Синхронизировано' : 'Не синхронизировано' }}</span>
          <a class="btn btn-secondary btn-sm" href="/members">Участники</a>
          <div class="user-chip"><span class="avatar sm">{{ initials(currentUser) || 'СО' }}</span><span>{{ currentUser?.firstName || 'Вы' }}</span></div>
        </div>
      </div>

      <div v-if="snapshot" ref="toolbarRef" class="gantt-toolbar">
        <button class="btn btn-primary btn-sm" type="button" @click="openDirectionCreateModal">＋ Направление</button>
        <button class="btn btn-secondary btn-sm" type="button" @click="focusNewTask">＋ Задача</button>
        <div class="divider"></div>
        <input v-model="filterQuery" class="input toolbar-input" placeholder="Поиск по задаче или WBS" />
        <select v-model="filterStatus" class="input toolbar-input">
          <option value="">Все статусы</option>
          <option value="planned">Планируется</option>
          <option value="in_progress">В работе</option>
          <option value="done">Готово</option>
          <option value="blocked">Блокировано</option>
            <option value="postponed">Отложено</option>
        </select>
        <select v-model="selectedExecutor" class="input toolbar-input">
          <option value="">Все исполнители</option>
          <option v-for="member in members" :key="member.userId" :value="member.userId">
            {{ member.user?.displayName || member.user?.email }}
          </option>
        </select>
        <button v-if="filterQuery || filterStatus || selectedExecutor" class="gantt-chip" type="button" @click="filterQuery = ''; filterStatus = ''; selectedExecutor = ''">Сбросить</button>
        <button class="gantt-chip" type="button" @click="openDependency()">Связи</button>
        <button class="gantt-chip" :class="{ active: linkMode }" type="button" @click="toggleLinkMode">Связать</button>
        <span v-if="linkMode" class="gantt-chip active link-hint">
          {{
            !linkFrom
              ? 'Выберите задачу или направление-предшественника'
              : linkFrom.type === 'direction'
                ? 'Выберите направление-последователя'
                : 'Выберите задачу или направление-последователя'
          }}
        </span>
        <label class="gantt-chip"><input v-model="showDependencies" type="checkbox" /> Стрелки</label>
        <button class="gantt-chip" type="button" @click="openCalendarModal">Календарь</button>
        <button class="gantt-chip" type="button" @click="changeZoom(-0.25)">−</button>
        <span class="gantt-chip">{{ Math.round(zoom * 100) }}%</span>
        <button class="gantt-chip" type="button" @click="changeZoom(0.25)">+</button>
        <button class="gantt-chip" type="button" @click="exportPdf">PDF</button>
        <button class="gantt-chip" type="button" @click="printChart">Печать</button>
        <div class="toolbar-spacer"></div>
        <label class="gantt-chip file-chip">Импорт<input type="file" accept=".json,.csv" :disabled="importing" @change="importFile" /></label>
        <a class="gantt-chip" :href="`/api/v1/diagrams/${diagramId}/export?format=json&compat=standalone`">Экспорт JSON</a>
        <a class="gantt-chip" :href="`/api/v1/diagrams/${diagramId}/export?format=csv&compat=standalone`">CSV</a>
      </div>

      <p v-if="loading" class="muted">Загрузка...</p>
      <p v-if="snapshot?.schedule?.cycles?.length" class="error">Обнаружен цикл зависимостей — проверьте связи.</p>
  

      <section v-if="!loading && !projects.length" class="card empty-project">
        <h2>Создайте первый проект</h2>
        <form class="stack" @submit.prevent="createProject">
          <input v-model="projectForm.name" class="input" placeholder="Название проекта" required />
          <input v-model="projectForm.description" class="input" placeholder="Описание" />
          <button class="btn btn-primary" type="submit">Создать проект</button>
        </form>
      </section>

      <section v-if="!loading && projectId && !snapshot" class="card empty-project">
        <h2>В проекте пока нет диаграмм</h2>
        <p class="muted">Создайте диаграмму, чтобы добавить направления и задачи.</p>
        <button class="btn btn-primary" type="button" @click="openDiagramModal">Создать диаграмму</button>
      </section>

      <div
        v-if="snapshot"
        class="gantt-top-scroll"
        :style="{ top: `${stickyScrollTop}px`, gridTemplateColumns: `${labelWidth}px minmax(420px, 1fr)` }"
      >
        <span></span>
        <div ref="topScrollRef" class="gantt-top-scroll-track" @scroll="syncFromTopScroll">
          <div :style="{ width: `${timelineScrollWidth}px` }"></div>
        </div>
      </div>

      <div v-if="snapshot" class="gantt-frame" :style="{ gridTemplateColumns: `${labelWidth}px minmax(420px, 1fr)` }">
        <div class="gantt-labels">
          <div class="gantt-label-head"><span>Структура работ</span><span class="wbs">WBS</span></div>
          <template v-for="row in ganttRows" :key="row.key">
            <div
              v-if="row.type === 'direction'"
              class="gantt-row-label direction"
              @click="toggleCollapse(row.direction.id)"
              @dragover.prevent="onTaskDragOver($event, row)"
              :class="{ 'drop-inside': dragOverId === row.key && dragOverMode === 'inside' }"
              @drop="onTaskDrop($event, row)"
            >
              <span class="caret">{{ collapsed.includes(row.direction.id) ? '›' : '⌄' }}</span>
              <span class="label-name">{{ row.direction.wbsCode ? `${row.direction.wbsCode}. ` : '' }}{{ row.direction.name }}</span>
              <span class="label-meta">
                <span class="badge badge-dot" :class="statusBadgeClass(row.direction.status)">{{ statusLabel(row.direction.status) }}</span>
                <span class="badge badge-neutral">{{ row.direction.progress ?? 0 }}%</span>
                <button
                  class="row-action"
                  type="button"
                  title="Редактировать направление"
                  @click.stop="openDirectionModal(row.direction)"
                >✎</button>
                <button
                  class="row-action"
                  type="button"
                  title="Создать задачу в направлении"
                  @click.stop="openTaskModal({ directionId: row.direction.id })"
                >＋</button>
              </span>
            </div>
            <div
              v-else
              class="gantt-row-label task"
              :class="{
                selected: selectedTask?.id === row.task.id,
                context: row.isContext,
                'link-source': isLinkSource('task', row.task.id),
                'dep-linked': hoveredTaskIds.has(row.task.id),
                'drop-before': dragOverId === row.key && dragOverMode === 'before',
                'drop-after': dragOverId === row.key && dragOverMode === 'after',
                'drop-inside': dragOverId === row.key && dragOverMode === 'inside',
              }"
              :style="{ paddingLeft: `${12 + row.depth * 18}px` }"
              :title="taskTooltip(row.task)"
              draggable="true"
              @dragstart="onTaskDragStart($event, row.task)"
              @dragover.prevent="onTaskDragOver($event, row)"
              @drop.stop="onTaskDrop($event, row)"
              @click="openTaskEditor(row.task)"
            >
              <span
                v-if="row.task.childrenCount"
                class="caret"
                @click.stop="toggleCollapse(row.task.id)"
              >{{ collapsed.includes(row.task.id) ? '›' : '⌄' }}</span>
              <span v-else class="caret placeholder">·</span>
              <span class="label-name" @click.stop="openTaskEditor(row.task)">
                {{ row.task.wbsCode }}. {{ row.task.name }}
                <span v-if="row.task.startDate || row.task.endDate" class="row-dates">
                  {{ formatShortDate(row.task.startDate) }}–{{ formatShortDate(row.task.effectiveEndDate ?? row.task.endDate) }}
                </span>
              </span>
              <span class="label-meta">
                <span class="priority-dot" :class="priorityClass(row.task.priority)" :title="row.task.priority"></span>
                <button v-if="row.task.jiraNumber" class="row-chip" type="button">{{ row.task.jiraNumber }}</button>
                <button v-if="row.task.commentsCount" class="row-chip" type="button" @click.stop="openTaskEditor(row.task)">💬 {{ row.task.commentsCount }}</button>
                <button class="row-chip flag-toggle" :class="{ 'flag-on': row.task.bpFlag }" type="button" @click.stop="toggleFlag(row.task, 'bpFlag')">БП</button>
                <button class="row-chip flag-toggle" :class="{ 'flag-on': row.task.spFlag }" type="button" @click.stop="toggleFlag(row.task, 'spFlag')">СП</button>
                <span v-if="assignmentByRole(row.task, 'executor')" class="badge badge-neutral">Исполнитель: {{ assignmentByRole(row.task, 'executor') }}</span>
                <span v-if="assignmentByRole(row.task, 'co_executor')" class="badge badge-neutral">Соисп.: {{ assignmentByRole(row.task, 'co_executor') }}</span>
                <span class="badge badge-dot" :class="statusBadgeClass(row.task.status)">{{ statusLabel(row.task.status) }}</span>
                <span class="badge badge-neutral">{{ row.task.progress }}%</span>
                <span v-if="Number(row.task.estimatedHours) > 0" class="badge badge-neutral">{{ row.task.estimatedHours }} ч</span>
                <span v-if="row.task.autoProgress" class="badge badge-primary" title="Рассчитывается по подзадачам">авто</span>
                <span v-if="isTaskDoneEarly(row.task)" class="badge badge-success">досрочно</span>
                <button v-if="row.depth === 1" class="row-action" type="button" title="Добавить подзадачу" @click.stop="startSubtask(row.task)">＋</button>
              </span>
            </div>
          </template>
        </div>
        <div ref="timelineRef" class="gantt-timeline" @scroll="syncFromTimeline">
          <div class="gantt-time-head" :style="{ minWidth: `${900 * zoom}px` }">
            <div class="gantt-month">План</div>
            <div
              v-for="week in timelineWeeks"
              :key="week.left"
              class="gantt-week"
              :style="{ left: week.left, width: week.width }"
            >{{ week.label }}</div>
          </div>
          <div ref="canvasRef" class="gantt-canvas" :style="{ minHeight: `${Math.max(320, ganttRows.length * 38 + 24)}px`, minWidth: `${900 * zoom}px` }">
            <span class="gantt-today" :style="{ left: todayLeft }"></span>
            <span v-for="column in weekendColumns" :key="column.key" class="weekend-column" :style="column.style"></span>
            <svg v-if="showDependencies" class="deps-overlay">
              <defs>
                <marker
                  v-for="line in dependencyLines"
                  :id="`dep-arrow-${line.id}`"
                  :key="`arrow-${line.id}`"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,3.5 L0,7 Z" :fill="line.critical ? '#dc2626' : line.color" />
                </marker>
              </defs>
              <g v-for="line in dependencyLines" :key="line.id">
                <path
                  class="dep-line"
                  :d="line.path"
                  fill="none"
                  :stroke="line.critical ? '#dc2626' : line.color"
                  :stroke-dasharray="line.dash === 'dashed' ? '6 4' : line.dash === 'dotted' ? '2 4' : ''"
                  :stroke-linecap="line.dash === 'dotted' ? 'round' : 'butt'"
                  :stroke-width="hoveredDependencyId === line.id ? 2.8 : 1.4"
                  :marker-end="`url(#dep-arrow-${line.id})`"
                />
                <path
                  class="dep-hit"
                  :d="line.path"
                  fill="none"
                  stroke="transparent"
                  stroke-width="14"
                  @mouseenter="hoveredDependencyId = line.id"
                  @mouseleave="hoveredDependencyId = ''"
                  @click.stop="openDependency(line.dependency)"
                />
              </g>
            </svg>
            <div
              v-for="bar in directionBars"
              :key="`direction-bar-${bar.direction.id}`"
              class="gantt-bar direction-bar"
              :class="[bar.direction.status, { 'link-source': isLinkSource('direction', bar.direction.id) }]"
              :style="bar.style"
              @click="onDirectionBarClick(bar.direction)"
            >
              <span class="gantt-bar-label">
                {{ bar.direction.wbsCode ? `${bar.direction.wbsCode}. ` : '' }}{{ bar.direction.name }}
                · {{ bar.direction.progress ?? 0 }}%
              </span>
              <span class="fill" :style="{ width: `${bar.direction.progress ?? 0}%` }"></span>
            </div>
            <div
              v-for="bar in timelineBars"
              :key="bar.task.id"
              class="gantt-bar"
              :class="[bar.task.status, { critical: bar.task.isCritical, dragging: barDragPreview?.taskId === bar.task.id, 'link-source': isLinkSource('task', bar.task.id), 'dep-linked': hoveredTaskIds.has(bar.task.id) }]"
              :style="bar.style"
              @pointerdown="startBarDrag($event, bar, 'move')"
              @mouseenter="showBarTooltip($event, bar.task)"
              @mousemove="moveBarTooltip"
              @mouseleave="hideBarTooltip"
              @click="onBarClick(bar.task)"
            >
              <span class="bar-handle left" @pointerdown.stop="startBarDrag($event, bar, 'start')"></span>
              <span class="bar-handle right" :class="{ 'auto-end': Number(bar.task.estimatedHours) > 0 }" @pointerdown.stop="startBarDrag($event, bar, 'end')"></span>
              <span class="gantt-bar-label">{{ bar.task.wbsCode }} · {{ bar.task.progress }}%</span>
              <span class="fill" :style="{ width: `${bar.task.progress}%` }"></span>
            </div>
            <div v-if="barDragPreview" class="gantt-bar-preview" :style="{ top: barDragPreview.top, left: barDragPreview.left, width: barDragPreview.width }">
              <span>{{ barDragPreview.label }}</span>
            </div>
          </div>
        </div>
      </div>

    </main>

    <aside v-if="selectedTask && !showTaskModal" class="gantt-drawer drawer">
      <div class="drawer-head">
        <div><h3>Задача</h3><p class="muted small">{{ selectedTask.wbsCode }}. {{ selectedTask.name }}</p></div>
        <button class="btn btn-icon btn-ghost" type="button" @click="selectedTask = null">✕</button>
      </div>
      <div class="drawer-body">
        <div class="inline">
          <select v-model="status" class="input">
            <option value="planned">Планируется</option>
            <option value="in_progress">В работе</option>
            <option value="done">Готово</option>
            <option value="blocked">Блокировано</option>
            <option value="postponed">Отложено</option>
          </select>
          <input v-model.number="progress" class="input" type="number" min="0" max="100" step="5" />
          <button class="btn btn-secondary btn-sm" type="button" @click="quickProgress">+25%</button>
        </div>
        <div class="stack task-edit">
          <input v-model="taskEdit.name" class="input" placeholder="Название задачи" />
          <textarea v-model="taskEdit.description" class="textarea" rows="2" placeholder="Описание" />
          <select v-model="taskEdit.priority" class="input">
            <option value="low">Низкий приоритет</option>
            <option value="medium">Средний приоритет</option>
            <option value="high">Высокий приоритет</option>
            <option value="critical">Критический</option>
          </select>
          <input v-model="taskEdit.jiraNumber" class="input" placeholder="Jira" />
          <div class="dates"><input v-model="taskEdit.startDate" class="input" type="date" /><input v-model="taskEdit.endDate" class="input" type="date" /></div>
          <label class="field"><span>Факт завершения</span><input v-model="taskEdit.actualEndDate" class="input" type="date" /></label>
          <label class="checkbox-line"><input v-model="taskEdit.bpFlag" type="checkbox" /> БП</label>
          <label class="checkbox-line"><input v-model="taskEdit.spFlag" type="checkbox" /> СП</label>

        </div>
        <h3>Перемещение</h3>
        <div class="stack">
          <select v-model="moveForm.directionId" class="input">
            <option value="">Текущее направление</option>
            <option v-for="direction in snapshot?.directions ?? []" :key="direction.id" :value="direction.id">
              {{ direction.name }}
            </option>
          </select>
          <input v-model.number="moveForm.sortOrder" class="input" type="number" min="0" placeholder="Порядок" />
        </div>
        <h3>Назначения</h3>
        <div class="stack">
          <div class="manage-list">
            <div v-for="(assignment, index) in assignmentDraft" :key="`${assignment.role}-${assignment.assigneeType}-${assignment.assigneeId}`" class="manage-item">
              <span>{{ assignment.role === 'executor' ? 'Исполнитель' : 'Соисполнитель' }}: {{ assignmentName(assignment) }}</span>
              <button class="btn btn-ghost btn-sm" type="button" @click="removeAssignment(index)">Удалить</button>
            </div>
            <p v-if="!assignmentDraft.length" class="muted small">Назначений нет.</p>
          </div>
          <select v-model="assignmentForm.role" class="input">
            <option value="executor">Исполнитель</option>
            <option value="co_executor">Соисполнитель</option>
          </select>
          <p class="muted small">Назначить можно только активного участника этого проекта.</p>
          <select v-model="assignmentForm.assigneeId" class="input">
            <option value="">Выберите</option>
            <option v-for="option in assignmentOptions('user')" :key="option.id" :value="option.id">{{ option.displayName }}</option>
          </select>
          <button class="btn btn-secondary" type="button" @click="addAssignment">Добавить назначение</button>
        </div>
        <h3>Комментарии</h3>
        <div class="comments">
          <div v-for="comment in comments" :key="comment.id" class="comment">
            <span class="avatar sm">К</span>
            <div>
              <div class="comment-head"><span class="comment-name">{{ comment.authorUserId }}</span><span class="muted small">{{ formatShortDate(comment.createdAt) }}</span></div>
              <template v-if="editingCommentId === comment.id">
                <textarea v-model="editCommentBody" class="textarea" rows="2" />
                <div class="comment-actions">
                  <button class="link-button" type="button" @click="saveComment(comment)">Сохранить</button>
                  <button class="link-button" type="button" @click="editingCommentId = ''">Отмена</button>
                </div>
              </template>
              <template v-else>
                <p class="comment-text">{{ comment.body }}</p>
                <div class="comment-actions">
                  <button class="link-button" type="button" @click="startEditComment(comment)">Изменить</button>
                  <button class="link-button" type="button" @click="deleteComment(comment.id)">Удалить</button>
                </div>
              </template>
            </div>
          </div>
          <p v-if="!comments.length" class="muted small">Комментариев пока нет.</p>
        </div>
        <form class="comment-form composer" @submit.prevent="addComment">
          <textarea v-model="commentBody" class="textarea" rows="3" placeholder="Написать комментарий..." />
          <div class="composer-footer"><button class="btn btn-primary btn-sm" type="submit">Добавить</button></div>
        </form>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost danger" type="button" @click="deleteTask">Удалить</button>
        <button class="btn btn-primary" type="button" :disabled="savingTask" @click="saveTaskAll">
          {{ savingTask ? 'Сохранение...' : 'Сохранить' }}
        </button>
      </div>
    </aside>

    <div v-if="showTaskModal" class="task-modal-bg" @click.self="closeTaskModal">
      <form class="task-modal" @submit.prevent="saveTaskModal">
        <div class="task-modal-head">
          <div>
            <p class="eyebrow">{{ editingTaskId ? 'Задача' : 'Новая запись' }}</p>
            <h3>{{ editingTaskId ? 'Редактирование задачи' : 'Создание задачи' }}</h3>
          </div>
          <button class="btn btn-icon btn-ghost" type="button" @click="closeTaskModal">✕</button>
        </div>
        <div class="task-modal-grid">
          <label class="field full">
            <span>Название *</span>
            <input v-model="newTask.name" class="input task-modal-name" required />
          </label>
          <label class="field full">
            <span>Описание</span>
            <textarea v-model="newTask.description" class="textarea" rows="2" />
          </label>
          <label class="field">
            <span>Направление *</span>
            <select v-model="newTask.directionId" class="input task-modal-direction" required>
              <option v-for="direction in snapshot?.directions ?? []" :key="direction.id" :value="direction.id">
                {{ direction.name }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Родительская задача</span>
            <select v-model="newTask.parentTaskId" class="input">
              <option value="">Верхний уровень</option>
              <option
                v-for="task in (snapshot?.tasks ?? []).filter(
                (item) => item.level === 2 && item.directionId === newTask.directionId && item.id !== editingTaskId,
              )"
                :key="task.id"
                :value="task.id"
              >{{ task.wbsCode }} {{ task.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>Статус</span>
            <select v-model="newTask.status" class="input task-modal-status">
              <option value="planned">Планируется</option>
              <option value="in_progress">В работе</option>
              <option value="done">Готово</option>
              <option value="blocked">Блокировано</option>
              <option value="postponed">Отложено</option>
            </select>
          </label>
          <label class="field">
            <span>Процент</span>
            <input v-model.number="newTask.progress" class="input task-modal-progress" type="number" min="0" max="100" step="5" />
          </label>
          <label class="field">
            <span>Часы</span>
            <input
              v-model.number="newTask.estimatedHours"
              class="input task-modal-hours"
              type="number"
              min="0"
              step="0.5"
              placeholder="0"
            />
          </label>
          <label class="field">
            <span>Приоритет</span>
            <select v-model="newTask.priority" class="input">
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
            </select>
          </label>
          <label class="field">
            <span>Jira</span>
            <input v-model="newTask.jiraNumber" class="input" placeholder="OATI-123" />
          </label>
          <label class="field">
            <span>Начало</span>
            <input v-model="newTask.startDate" class="input task-modal-start" type="date" />
          </label>
          <label class="field">
            <span>Окончание</span>
            <input v-model="newTask.endDate" class="input task-modal-end" type="date" :disabled="Boolean(autoTaskEnd)" />
          </label>
          <label v-if="editingTaskId" class="field">
            <span>Факт завершения</span>
            <input v-model="newTask.actualEndDate" class="input" type="date" />
          </label>
          <label class="field">
            <span>Исполнитель</span>
            <select v-model="newTask.executorId" class="input">
              <option value="">Не назначен</option>
              <option v-for="person in modalPeopleFor('executor')" :key="person.value" :value="person.value">
                {{ person.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Соисполнитель</span>
            <select v-model="newTask.coExecutorId" class="input">
              <option value="">Не назначен</option>
              <option v-for="person in modalPeopleFor('co_executor')" :key="person.value" :value="person.value">
                {{ person.label }}
              </option>
            </select>
          </label>
          <label v-if="!editingTaskId" class="field">
            <span>Зависит от</span>
            <select v-model="newTask.predecessorId" class="input">
              <option value="">Без зависимости</option>
              <option v-for="task in snapshot?.tasks ?? []" :key="task.id" :value="task.id">
                {{ task.wbsCode }} {{ task.name }}
              </option>
            </select>
          </label>
          <label class="checkbox-line"><input v-model="newTask.bpFlag" type="checkbox" /> БП</label>
          <label class="checkbox-line"><input v-model="newTask.spFlag" type="checkbox" /> СП</label>
        </div>
        <p v-if="autoTaskEnd" class="muted small">
          Окончание рассчитано автоматически: {{ formatShortDate(autoTaskEnd) }} ({{ newTask.estimatedHours }} ч,
          8 ч/день).
        </p>
        <div v-if="editingTaskId" class="task-modal-comments">
          <div class="comments-head"><strong>Комментарии</strong><span class="muted">{{ comments.length }}</span></div>
          <div class="comment-list">
            <p v-if="commentsLoading" class="muted small">Загрузка комментариев...</p>
            <div v-for="comment in comments" :key="comment.id" class="comment">
              <div class="comment-head">
                <div class="comment-author">
                  <strong class="comment-name">{{ comment.authorName || comment.authorUserId }}</strong>
                  <span class="comment-date">{{ formatShortDate(comment.createdAt) }}</span>
                </div>
                <div v-if="editingCommentId === comment.id" class="comment-actions">
                  <button class="btn btn-sm comment-action" type="button" @click="editingCommentId = ''">Отмена</button>
                  <button class="btn btn-sm comment-action comment-save" type="button" @click="saveComment(comment)">Сохранить</button>
                </div>
                <div v-else class="comment-actions">
                  <button class="btn btn-sm comment-action" type="button" @click="startEditComment(comment)">Изменить</button>
                  <button class="btn btn-sm comment-action comment-delete" type="button" @click="deleteComment(comment.id)">Удалить</button>
                </div>
              </div>
              <textarea v-if="editingCommentId === comment.id" v-model="editCommentBody" class="textarea comment-editor" rows="2" />
              <p v-else class="comment-text">{{ comment.body }}</p>
            </div>
            <p v-if="!comments.length" class="muted">Комментариев пока нет.</p>
          </div>
          <textarea v-model="commentBody" class="textarea" rows="2" placeholder="Новый комментарий" />
          <button class="btn btn-secondary btn-sm" type="button" @click="addComment">Добавить комментарий</button>
        </div>
        <div class="task-modal-actions">
          <button v-if="editingTaskId" class="btn btn-danger" type="button" @click="deleteTaskFromModal">
            Удалить
          </button>
          <button class="btn btn-secondary" type="button" @click="closeTaskModal">Отмена</button>
          <button class="btn btn-primary" type="submit">{{ editingTaskId ? 'Сохранить' : 'Создать задачу' }}</button>
        </div>
      </form>
    </div>

    <div v-if="showImportModal" class="task-modal-bg" @click.self="closeImportModal">
      <div class="task-modal import-modal">
        <div class="task-modal-head">
          <div>
            <p class="eyebrow">Импорт</p>
            <h3>Загрузка диаграммы</h3>
          </div>
          <button class="btn btn-icon btn-ghost" type="button" :disabled="importing" @click="closeImportModal">✕</button>
        </div>
        <div v-if="importPreview" class="import-preview">
          <p class="muted small">{{ importPreview.fileName }} · {{ importPreview.format }}</p>
          <p class="muted small">
            Направления: {{ importPreview.directions ?? 0 }}, задачи: {{ importPreview.tasks ?? importPreview.rows ?? 0 }},
            связи: {{ importPreview.dependencies ?? 0 }}, праздники: {{ importPreview.holidays ?? 0 }}
          </p>
          <p v-for="warning in importPreview.warnings" :key="warning" class="import-warning">⚠ {{ warning }}</p>
          <p v-for="issue in importPreview.errors" :key="issue" class="error">{{ issue }}</p>
          <button
            v-if="!importJob"
            class="btn btn-primary"
            type="button"
            :disabled="importPreview.errors?.length || importing"
            @click="applyImport"
          >Применить импорт</button>
        </div>
        <p v-if="importing" class="muted">Импорт выполняется...</p>
        <template v-else-if="importJob">
          <p class="muted small">{{ importJob.fileName }}: {{ importJob.status }}</p>
          <p v-if="importJob.report" class="muted small">
            Направления: {{ importJob.report.directionsCount }}, задачи: {{ importJob.report.tasksCount }},
            назначения: {{ importJob.report.assignmentsCount }}.
          </p>
          <p v-if="importJob.report?.issues?.length" class="muted small">
            Замечания: {{ importJob.report.issues.length }}
          </p>
          <p v-if="importJob.errorMessage" class="error">{{ importJob.errorMessage }}</p>
        </template>
        <p v-if="!importPreview && !importJob && !importing" class="muted">Выберите файл для импорта.</p>
        <div class="task-modal-actions">
          <button class="btn btn-secondary" type="button" :disabled="importing" @click="closeImportModal">Закрыть</button>
        </div>
      </div>
    </div>

    <div v-if="showDiagramModal" class="task-modal-bg" @click.self="closeDiagramModal">
      <form class="task-modal diagram-modal" @submit.prevent="createDiagram">
        <div class="task-modal-head">
          <div>
            <p class="eyebrow">Новая диаграмма</p>
            <h3>Создание диаграммы</h3>
          </div>
          <button class="btn btn-icon btn-ghost" type="button" @click="closeDiagramModal">✕</button>
        </div>
        <div class="task-modal-grid">
          <label class="field full">
            <span>Название *</span>
            <input v-model="diagramForm.name" class="input diagram-modal-name" required autofocus />
          </label>
          <label class="field full">
            <span>Описание</span>
            <textarea v-model="diagramForm.description" class="textarea" rows="2" />
          </label>
          <label class="field full">
            <span>Календарь</span>
            <select v-model="diagramForm.dayMode" class="input diagram-modal-day-mode">
              <option value="working">Рабочие дни</option>
              <option value="calendar">Календарные дни</option>
            </select>
          </label>
        </div>
        <div class="task-modal-actions">
          <button class="btn btn-secondary" type="button" @click="closeDiagramModal">Отмена</button>
          <button class="btn btn-primary" type="submit">Создать диаграмму</button>
        </div>
      </form>
    </div>

    <div v-if="showCalendarModal" class="task-modal-bg" @click.self="closeCalendarModal">
      <form class="task-modal calendar-modal" @submit.prevent="addHoliday">
        <div class="task-modal-head">
          <div>
            <p class="eyebrow">Календарь</p>
            <h3>Производственный календарь</h3>
          </div>
          <button class="btn btn-icon btn-ghost" type="button" @click="closeCalendarModal">✕</button>
        </div>
        <div class="calendar-mode">
          <button
            type="button"
            :class="{ active: snapshot?.diagram?.dayMode === 'working' }"
            @click="setDayMode('working')"
          >Рабочие дни</button>
          <button
            type="button"
            :class="{ active: snapshot?.diagram?.dayMode === 'calendar' }"
            @click="setDayMode('calendar')"
          >Календарные дни</button>
        </div>
        <p class="muted small">Праздники исключаются из расчёта рабочих дней.</p>
        <div class="task-modal-grid">
          <label class="field">
            <span>Дата</span>
            <input v-model="holidayDate" class="input calendar-date" type="date" required />
          </label>
          <label class="field">
            <span>Название</span>
            <input v-model="holidayName" class="input calendar-name" maxlength="60" placeholder="Например: Новый год" />
          </label>
        </div>
        <div class="calendar-add-actions">
          <button class="btn btn-primary" type="submit">Добавить праздник</button>
          <button class="btn btn-secondary" type="button" @click="addHolidayPreset">Праздники РФ</button>
        </div>
        <div class="holiday-list">
          <div v-for="holiday in sortedHolidays" :key="holiday.id ?? holiday.holidayDate" class="holiday-item">
            <span class="holiday-date">{{ holiday.holidayDate }}</span>
            <span class="holiday-name-text">{{ holiday.name || 'Праздник' }}</span>
            <button class="btn btn-icon btn-ghost holiday-delete" type="button" title="Удалить" @click="deleteHoliday(holiday.holidayDate)">✕</button>
          </div>
          <p v-if="!sortedHolidays.length" class="muted small">Праздников нет — все будние дни считаются рабочими.</p>
        </div>
        <div class="task-modal-actions">
          <button class="btn btn-secondary" type="button" @click="closeCalendarModal">Готово</button>
        </div>
      </form>
    </div>

    <div v-if="showDirectionModal" class="task-modal-bg" @click.self="closeDirectionModal">
      <form class="task-modal direction-modal" @submit.prevent="saveDirectionEdit">
        <div class="task-modal-head">
          <div>
            <p class="eyebrow">{{ directionEdit.id ? 'Направление' : 'Новое направление' }}</p>
            <h3>{{ directionEdit.id ? 'Редактирование направления' : 'Создание направления' }}</h3>
          </div>
          <button class="btn btn-icon btn-ghost" type="button" @click="closeDirectionModal">✕</button>
        </div>
        <div class="task-modal-grid">
          <label class="field full">
            <span>Название *</span>
            <input v-model="directionEdit.name" class="input direction-modal-name" required />
          </label>
          <label class="field full">
            <span>Описание</span>
            <textarea v-model="directionEdit.description" class="textarea" rows="2" />
          </label>
          <label class="field full">
            <span>Результат</span>
            <textarea v-model="directionEdit.result" class="textarea" rows="2" />
          </label>
          <label class="field">
            <span>Приоритет</span>
            <select v-model="directionEdit.priority" class="input">
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
            </select>
          </label>
          <label class="field">
            <span>Jira</span>
            <input v-model="directionEdit.jiraNumber" class="input" />
          </label>
          <label class="field">
            <span>Начало</span>
            <input v-model="directionEdit.startDate" class="input" type="date" />
          </label>
          <label class="field">
            <span>Окончание</span>
            <input v-model="directionEdit.endDate" class="input" type="date" />
          </label>
          <label class="field full">
            <span>Ответственный</span>
            <select v-model="directionEdit.responsibleId" class="input">
              <option value="">Не назначен</option>
              <option v-for="member in members" :key="member.userId" :value="member.userId">
                {{ member.user?.displayName || member.user?.email || member.userId }}
              </option>
            </select>
          </label>
          <label class="checkbox-line"><input v-model="directionEdit.bpFlag" type="checkbox" /> БП</label>
          <label class="checkbox-line"><input v-model="directionEdit.spFlag" type="checkbox" /> СП</label>
        </div>
        <div class="task-modal-actions">
          <button class="btn btn-secondary" type="button" @click="closeDirectionModal">Отмена</button>
          <button class="btn btn-primary" type="submit">{{ directionEdit.id ? 'Сохранить' : 'Создать направление' }}</button>
        </div>
      </form>
    </div>

    <div v-if="showDependencyModal" class="dependency-modal-bg" @click.self="closeDependency">
      <div class="dependency-modal dependency-modal-wide">
        <div class="dependency-modal-head">
          <div>
            <p class="eyebrow">Связи проекта</p>
            <h3>Управление связями</h3>
            <p class="muted small">{{ snapshot?.dependencies?.length ?? 0 }} связей</p>
          </div>
          <div class="dependency-head-actions">
            <button class="btn btn-secondary btn-sm" type="button" @click="openDependency()">＋ Новая связь</button>
            <button class="btn btn-icon btn-ghost" type="button" @click="closeDependency">✕</button>
          </div>
        </div>
        <div class="dependency-manager">
          <div class="dependency-manager-list">
            <button
              v-for="dependency in snapshot?.dependencies ?? []"
              :key="dependency.id"
              class="dependency-list-item"
              :class="{ active: dependencyEdit.id === dependency.id }"
              type="button"
              @click="openDependency(dependency)"
            >
              <span>{{ entityLabel(dependency.predecessorType, dependency.predecessorId) }} → {{ entityLabel(dependency.successorType, dependency.successorId) }}</span>
              <small>{{ dependency.lineStyle }} · {{ dependency.arrowShape }}</small>
            </button>
            <p v-if="!snapshot?.dependencies?.length" class="muted small">Связей пока нет.</p>
          </div>
          <div class="dependency-manager-form">
            <h4>{{ dependencyEdit.id ? 'Редактирование связи' : 'Новая связь' }}</h4>
            <div class="dependency-form-grid">
              <label class="field">
                <span>Предшественник</span>
                <select v-model="dependencyEdit.predecessorType" class="input" @change="onDependencyPredecessorTypeChange">
                  <option value="task">Задача</option>
                  <option value="direction">Направление</option>
                </select>
              </label>
              <label class="field">
                <span>Последователь</span>
                <select v-model="dependencyEdit.successorType" class="input" @change="onDependencySuccessorTypeChange">
                  <option value="task" :disabled="dependencyEdit.predecessorType === 'direction'">Задача</option>
                  <option value="direction">Направление</option>
                </select>
              </label>
              <label class="field">
                <span>От</span>
                <select v-model="dependencyEdit.predecessorId" class="input">
                  <option value="" disabled>Выберите</option>
                  <option v-for="entity in dependencyEntities(dependencyEdit.predecessorType)" :key="entity.id" :value="entity.id">{{ entity.label }}</option>
                </select>
              </label>
              <label class="field">
                <span>К</span>
                <select v-model="dependencyEdit.successorId" class="input">
                  <option value="" disabled>Выберите</option>
                  <option v-for="entity in dependencyEntities(dependencyEdit.successorType)" :key="entity.id" :value="entity.id">{{ entity.label }}</option>
                </select>
              </label>
            </div>
            <p v-if="dependencyEdit.predecessorType === 'direction'" class="muted small">
              От направления можно строить связь только к направлению.
            </p>
            <div class="dependency-form-grid">
              <label class="field">
                <span>Цвет</span>
                <input v-model="dependencyEdit.color" class="dependency-color" type="color" />
              </label>
              <label class="field">
                <span>Стиль линии</span>
                <select v-model="dependencyEdit.lineStyle" class="input dependency-line-style">
                  <option value="solid">Сплошная</option>
                  <option value="dashed">Пунктир</option>
                  <option value="dotted">Точки</option>
                </select>
              </label>
              <label class="field">
                <span>Стрелка</span>
                <select v-model="dependencyEdit.arrowShape" class="input dependency-arrow-shape">
                  <option value="orthogonal">Ортогональная</option>
                  <option value="straight">Прямая</option>
                  <option value="curved">Изогнутая</option>
                </select>
              </label>
            </div>
            <div class="dependency-modal-actions">
              <div>
                <button v-if="dependencyEdit.id" class="btn btn-ghost danger" type="button" @click="removeEditingDependency">Удалить связь</button>
                <button class="btn btn-ghost" type="button" @click="resetDependencyStyle">Сбросить стиль</button>
              </div>
              <div>
                <button class="btn btn-secondary" type="button" @click="closeDependency">Отмена</button>
                <button class="btn btn-primary" type="button" @click="saveDependency">Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="barTooltip" ref="barTooltipRef" class="bar-tooltip" :style="{ left: `${barTooltip.x}px`, top: `${barTooltip.y}px` }">
      <div class="bar-tooltip-title">{{ barTooltip.task.wbsCode }} · {{ barTooltip.task.name }}</div>
      <div v-if="barTooltip.task.description">
        <span class="bar-tooltip-key">Описание:</span> {{ barTooltip.task.description }}
      </div>
      <div>
        <span class="bar-tooltip-key">Срок:</span>
        {{ formatShortDate(barTooltip.task.startDate) }} — {{ formatShortDate(barTooltip.task.effectiveEndDate ?? barTooltip.task.endDate) }}
        <span class="bar-tooltip-key">({{ barTooltip.task.days ?? 0 }} дн.)</span>
      </div>
      <div v-if="Number(barTooltip.task.estimatedHours) > 0">
        <span class="bar-tooltip-key">Часы:</span> {{ barTooltip.task.estimatedHours }} ч
        <span class="bar-tooltip-key">· 8 ч/день</span>
      </div>
      <div v-if="barTooltip.task.actualEndDate">
        <span class="bar-tooltip-key">Факт:</span> {{ formatShortDate(barTooltip.task.actualEndDate) }}
        <template v-if="Number(barTooltip.task.doneDeltaDays) > 0">
          · <span class="bar-tooltip-good">досрочно на {{ barTooltip.task.doneDeltaDays }} дн.</span>
        </template>
        <template v-else-if="Number(barTooltip.task.doneDeltaDays) < 0">
          · <span class="bar-tooltip-bad">просрочка {{ Math.abs(barTooltip.task.doneDeltaDays) }} дн.</span>
        </template>
        <template v-else> · точно в срок</template>
      </div>
      <div>
        <span class="bar-tooltip-key">Статус:</span> {{ statusLabel(barTooltip.task.status) }} · {{ barTooltip.task.progress }}%
        <span class="bar-tooltip-key">· приоритет: {{ priorityLabel(barTooltip.task.priority) }}</span>
      </div>
      <div v-if="assignmentByRole(barTooltip.task, 'executor')">
        <span class="bar-tooltip-key">Исполнитель:</span> {{ assignmentByRole(barTooltip.task, 'executor') }}
      </div>
      <div v-if="assignmentByRole(barTooltip.task, 'co_executor')">
        <span class="bar-tooltip-key">Соисполнитель:</span> {{ assignmentByRole(barTooltip.task, 'co_executor') }}
      </div>
      <div v-if="barTooltip.task.jiraNumber">
        <span class="bar-tooltip-key">Jira:</span> {{ barTooltip.task.jiraNumber }}
      </div>
      <div v-if="barTooltip.task.result">
        <span class="bar-tooltip-key">Результат:</span> {{ barTooltip.task.result }}
      </div>
      <div>
        <span class="bar-tooltip-key">Документы:</span>
        {{ barTooltip.task.bpFlag ? 'есть БП' : 'нет БП' }} · {{ barTooltip.task.spFlag ? 'есть СП' : 'нет СП' }}
      </div>
      <div v-if="barTooltip.task.commentsCount">
        <span class="bar-tooltip-key">Комментарии:</span> {{ barTooltip.task.commentsCount }}
      </div>
      <div v-if="barTooltip.task.isCritical" class="bar-tooltip-bad">Критическая задача</div>
      <div v-else-if="barTooltip.task.float != null">
        <span class="bar-tooltip-key">Резерв:</span> {{ barTooltip.task.float }} дн.
      </div>
    </div>
  </div>
</template>

<style scoped>
.gantt-shell { min-height: 100vh; }
.gantt-page { padding-bottom: 120px; }
.gantt-page.has-drawer { padding-right: 420px; }
.brand-mark { display: inline-grid; place-items: center; }
.sync-status { font-size: 12px; color: var(--color-text-muted); }
.sync-status.online { color: var(--color-success); }
.gantt-context { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.gantt-context .breadcrumbs { margin: 0; }
.gantt-context .project-bar { margin: 0; align-items: center; gap: 8px; }
.project-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.project-create-toggle { margin-bottom: 1px; }
.project-create-form { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.project-create-form .input { max-width: 280px; }
.toolbar-input { width: 170px; min-height: 32px; padding: 5px 8px; font-size: 12px; }
.row-dates { color: var(--color-text-muted); font-size: 10px; margin-left: 6px; }
.notification-icon { position: relative; text-decoration: none; }
.notice-dot { position: absolute; top: -4px; right: -4px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--color-danger); color: #fff; font-size: 9px; display: grid; place-items: center; }
.project-bar label { display: flex; align-items: center; min-width: 0; }
.project-bar label span { display: none; }
.project-bar select { min-width: 180px; min-height: 32px; padding: 5px 8px; font-size: 12px; }
.gantt-topline { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 18px; }
.gantt-title-row { display: flex; gap: 12px; align-items: center; }
.title-line { display: flex; gap: 10px; align-items: center; }
.gantt-title { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
.gantt-top-actions { display: flex; gap: 10px; align-items: center; }
.small { font-size: 12px; }
.gantt-toolbar { position: sticky; top: var(--header-height); z-index: 19; display: flex; gap: 8px; align-items: center; padding: 10px 12px; margin-bottom: 14px; background: rgb(255 255 255 / 96%); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); backdrop-filter: blur(10px); flex-wrap: wrap; }
.gantt-chip { display: inline-flex; gap: 6px; align-items: center; min-height: 32px; padding: 6px 11px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font-size: 12px; cursor: pointer; text-decoration: none; }
.gantt-chip.active { background: var(--color-primary-soft); border-color: #bfdbfe; color: var(--color-primary); }
.file-chip input { display: none; }
.gantt-frame { display: grid; grid-template-columns: minmax(380px, 46%) 1fr; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.gantt-labels { border-right: 1px solid var(--color-border); min-width: 0; }
.gantt-label-head, .gantt-row-label { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 8px; align-items: center; height: 38px; min-height: 38px; max-height: 38px; overflow: hidden; padding: 0 12px; border-bottom: 1px solid var(--color-border); }
.gantt-label-head { height: 56px; min-height: 56px; max-height: 56px; background: var(--color-surface-subtle); color: var(--color-text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.gantt-label-head { grid-template-columns: minmax(0, 1fr) auto; }
.gantt-label-head .wbs { margin-left: auto; }
.gantt-row-label { cursor: pointer; font-size: 13px; grid-template-columns: 24px minmax(0, 1fr) auto; }
.gantt-row-label.direction { background: var(--color-surface-subtle); font-weight: 600; cursor: pointer; }
.gantt-row-label.context { opacity: 0.55; }
.gantt-row-label.drop-before { box-shadow: inset 0 2px 0 var(--color-primary); }
.gantt-row-label.drop-after { box-shadow: inset 0 -2px 0 var(--color-primary); }
.gantt-row-label.drop-inside { background: var(--color-primary-soft); outline: 1px dashed var(--color-primary); outline-offset: -2px; }
.row-chip, .row-action { border: 1px solid var(--color-border); background: var(--color-surface); border-radius: 5px; padding: 1px 5px; font-size: 10px; cursor: pointer; }
.row-chip.flag-on { background: #dcfce7; border-color: #86efac; color: #15803d; }
.row-chip.flag-toggle { width: 0; min-width: 0; padding: 0; border: 0; margin: 0; overflow: hidden; opacity: 0; pointer-events: none; }
.gantt-row-label:hover .row-chip.flag-toggle, .gantt-row-label:focus-within .row-chip.flag-toggle, .row-chip.flag-toggle.flag-on {
  width: auto;
  min-width: 24px;
  padding: 1px 5px;
  border: 1px solid var(--color-border);
  opacity: 1;
  pointer-events: auto;
}
.badge-postponed { background: #e5e7eb; color: #4b5563; }
.priority-dot { width: 8px; height: 8px; transform: rotate(45deg); border-radius: 1px; display: inline-block; }
.priority-low { background: #94a3b8; }
.priority-medium { background: #f59e0b; }
.priority-high { background: #f97316; }
.priority-critical { background: #dc2626; }
.row-action { color: var(--color-primary); }
.day-mode { padding: 0; overflow: hidden; }
.day-mode button { border: 0; background: transparent; padding: 5px 8px; font-size: 11px; cursor: pointer; }
.day-mode button.active { background: var(--color-primary); color: #fff; }
.bar-handle { position: absolute; top: 0; bottom: 0; width: 7px; cursor: ew-resize; z-index: 3; }
.bar-handle.left { left: 0; }
.bar-handle.right { right: 0; }
.bar-handle.auto-end { display: none; }
.gantt-bar.direction-bar { background: #334155; border-color: #1e293b; color: #f8fafc; z-index: 3; }
.gantt-bar.direction-bar .fill { background: rgb(255 255 255 / 18%); }
.gantt-bar.direction-bar.done { background: #166534; border-color: #14532d; }
.gantt-bar.direction-bar.blocked { background: #991b1b; border-color: #7f1d1d; }
.gantt-bar.dragging { opacity: 0.28; }
.gantt-bar.link-source { outline: 3px solid #2563eb; outline-offset: 2px; box-shadow: 0 0 0 5px rgb(37 99 235 / 18%); }
.gantt-bar.dep-linked { outline: 3px solid #0ea5e9; outline-offset: 2px; box-shadow: 0 0 0 5px rgb(14 165 233 / 20%); z-index: 5; }
.gantt-row-label.link-source { background: #dbeafe; outline: 2px solid #60a5fa; outline-offset: -2px; }
.gantt-row-label.dep-linked { background: #e0f2fe; box-shadow: inset 3px 0 0 #0ea5e9; }
.link-hint { border-style: dashed; }
.bar-tooltip { position: fixed; z-index: 120; max-width: min(420px, calc(100vw - 16px)); padding: 10px 12px; border-radius: 8px; background: #0f172a; color: #e2e8f0; box-shadow: 0 8px 24px rgb(15 23 42 / 35%); font-size: 12px; line-height: 1.5; pointer-events: none; overflow-wrap: anywhere; }
.bar-tooltip-title { margin-bottom: 4px; color: #fff; font-size: 13px; font-weight: 700; }
.bar-tooltip-key { color: #94a3b8; }
.bar-tooltip-good { color: #4ade80; font-weight: 700; }
.bar-tooltip-bad { color: #fca5a5; font-weight: 700; }
.gantt-bar-preview { position: absolute; height: 28px; z-index: 6; display: flex; align-items: center; padding: 0 8px; border: 2px dashed #2563eb; border-radius: var(--radius-md); background: rgb(219 234 254 / 82%); color: #1d4ed8; font-size: 11px; pointer-events: none; box-shadow: 0 4px 12px rgb(37 99 235 / 18%); }
.gantt-bar.critical { border-width: 2px; border-color: #dc2626; }
.gantt-row-label.task .label-meta { flex-wrap: nowrap; justify-content: flex-end; overflow: hidden; }
.gantt-row-label.direction .caret { color: var(--color-text-muted); }
.gantt-row-label .caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: -3px;
  border-radius: 4px;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
  user-select: none;
}
.gantt-row-label .caret:hover { background: #e2e8f0; color: #0f172a; }
.gantt-row-label .caret.placeholder { cursor: default; }
.gantt-row-label .caret.placeholder:hover { background: transparent; color: var(--color-text-muted); }
.gantt-row-label:hover, .gantt-row-label.selected { background: #eff6ff; }
.label-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.label-meta { display: flex; gap: 5px; align-items: center; flex-wrap: nowrap; white-space: nowrap; }
.gantt-top-scroll { position: sticky; z-index: 18; display: grid; align-items: center; height: 14px; margin-bottom: 6px; background: var(--color-bg); }
.gantt-top-scroll-track { overflow-x: auto; overflow-y: hidden; scrollbar-gutter: stable; }
.gantt-top-scroll-track > div { height: 1px; }
.gantt-top-scroll-track::-webkit-scrollbar { height: 12px; }
.gantt-top-scroll-track::-webkit-scrollbar-track { background: var(--color-surface-subtle); border-radius: 999px; }
.gantt-top-scroll-track::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.gantt-top-scroll-track::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
.gantt-timeline { min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-gutter: stable; }
.gantt-timeline::-webkit-scrollbar { height: 12px; }
.gantt-timeline::-webkit-scrollbar-track { background: var(--color-surface-subtle); border-top: 1px solid var(--color-border); }
.gantt-timeline::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.gantt-timeline::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
.gantt-time-head { display: grid; grid-template-columns: 1.2fr repeat(8, 1fr); height: 56px; min-height: 56px; max-height: 56px; border-bottom: 1px solid var(--color-border); background: var(--color-surface-subtle); font-size: 11px; color: var(--color-text-muted); }
.gantt-time-head > * { display: flex; align-items: center; padding: 0 8px; border-right: 1px solid var(--color-border); }
.deps-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; overflow: visible; }
.dep-hit { pointer-events: stroke; cursor: pointer; }
.gantt-canvas { position: relative; background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(14.285% - 1px), var(--color-border) calc(14.285% - 1px), var(--color-border) 14.285%); }
.gantt-today { position: absolute; top: 0; bottom: 0; left: 50%; border-left: 2px solid var(--color-danger); z-index: 1; }
.gantt-today::before { content: "Сегодня"; position: absolute; top: 2px; left: 4px; padding: 1px 4px; border-radius: 4px; background: var(--color-surface); color: var(--color-danger); font-size: 10px; font-weight: 600; white-space: nowrap; box-shadow: var(--shadow-xs); }
.weekend-column { position: absolute; top: 0; bottom: 0; background: rgb(148 163 184 / 18%); border-right: 1px solid rgb(100 116 139 / 10%); pointer-events: none; z-index: 0; }
.gantt-bar { position: absolute; height: 28px; border-radius: var(--radius-md); background: #dbeafe; color: #1d4ed8; border: 1px solid #93c5fd; cursor: pointer; overflow: hidden; z-index: 2; }
.gantt-bar .fill { position: absolute; inset: 0 auto 0 0; background: rgb(37 99 235 / 18%); }
.gantt-bar-label { position: relative; z-index: 1; display: block; padding: 5px 8px; font-size: 11px; white-space: nowrap; }
.gantt-bar.done { background: #dcfce7; border-color: #86efac; color: #15803d; }
.gantt-bar.blocked { background: #fee2e2; border-color: #fca5a5; color: #b91c1c; }
.gantt-bar.planned { background: #f1f5f9; border-color: #cbd5e1; color: #64748b; }
.gantt-bar.postponed { background: #e5e7eb; border-color: #9ca3af; color: #4b5563; }
.manage-card { margin-top: 18px; padding: 14px 18px; }
.manage-card summary { cursor: pointer; font-weight: 600; }
.manage-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin-top: 18px; }
.manage-list { display: grid; gap: 8px; }
.import-preview { margin-top: 8px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-subtle); }
.import-warning { color: #b45309; font-size: 11px; margin: 4px 0; }
.dep-controls { display: flex; gap: 4px; margin-top: 4px; }
.dep-controls select { font-size: 10px; padding: 2px 4px; }
.dep-controls input[type=color] { width: 24px; height: 24px; padding: 0; border: 1px solid var(--color-border); }
.manage-item { display: flex; justify-content: space-between; gap: 8px; padding: 8px; border-radius: var(--radius-md); background: var(--color-surface-subtle); font-size: 12px; }
.stack { display: grid; gap: 8px; margin-top: 8px; }
.dates { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.task-edit { padding-bottom: 12px; border-bottom: 1px solid var(--color-border); }
.danger { color: var(--color-danger); }
.gantt-drawer { position: fixed; top: 0; right: 0; z-index: 30; width: 420px; height: 100vh; display: flex; flex-direction: column; background: var(--color-surface); border-left: 1px solid var(--color-border); box-shadow: -20px 0 60px rgb(15 35 64 / 12%); }
.drawer-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 18px; border-bottom: 1px solid var(--color-border); }
.drawer-head h3 { margin: 0 0 3px; }
.drawer-body { padding: 18px; overflow: auto; flex: 1; }
.drawer-footer { display: flex; justify-content: space-between; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--color-border); background: var(--color-surface); }
.inline { display: flex; gap: 8px; flex-wrap: wrap; }
.comments { display: grid; gap: 12px; margin-top: 10px; }
.comment { display: block; padding: 12px 0; }
.comment + .comment { border-top: 1px solid var(--color-border); }
.comment-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.comment-author { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.comment-name { overflow: hidden; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.comment-date { color: var(--color-text-muted); font-size: 11px; white-space: nowrap; }
.comment-text { margin: 0; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 8px; background: #f8fafc; color: var(--color-text); font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-editor { margin-top: 0; }
.comment-actions { display: flex; flex-shrink: 0; gap: 6px; margin: 0; }
.comment-actions .comment-action { padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f1f5f9; color: #334155; font-size: 10.5px; }
.comment-actions .comment-action:hover { background: #e2e8f0; }
.comment-actions .comment-save { border-color: #2563eb; background: #2563eb; color: #fff; }
.comment-actions .comment-save:hover { background: #1d4ed8; }
.comment-actions .comment-delete { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.comment-actions .comment-delete:hover { background: #fee2e2; }
.composer { margin-top: 12px; }
.composer-footer { display: flex; justify-content: flex-end; margin-top: 8px; }
.empty-project { max-width: 440px; margin: 40px auto; }
.task-modal-bg { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 38%); overflow: auto; }
.task-modal { width: min(760px, 100%); max-height: calc(100vh - 40px); overflow: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: 22px; box-shadow: var(--shadow-lg); }
.direction-modal { width: min(620px, 100%); }
.diagram-modal { width: min(560px, 100%); }
.import-modal { width: min(620px, 100%); }
.calendar-modal { width: min(560px, 100%); }
.calendar-mode { display: flex; gap: 4px; padding: 4px; background: var(--color-surface-muted, #f1f5f9); border-radius: var(--radius-lg, 10px); }
.calendar-mode button { flex: 1; border: 0; background: transparent; padding: 7px 10px; border-radius: var(--radius-md, 8px); color: var(--color-text-muted); cursor: pointer; }
.calendar-mode button.active { background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-sm); font-weight: 600; }
.calendar-add-actions { display: flex; gap: 8px; margin-top: 12px; }
.holiday-list { display: grid; gap: 2px; margin-top: 12px; max-height: 260px; overflow: auto; border: 1px solid var(--color-border); border-radius: var(--radius-lg, 10px); padding: 4px; }
.holiday-item { display: grid; grid-template-columns: 100px 1fr auto; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--color-border); }
.holiday-item:last-child { border-bottom: 0; }
.holiday-date { font-variant-numeric: tabular-nums; color: var(--color-text-muted); font-size: 12px; }
.holiday-name-text { font-size: 13px; }
.holiday-delete { color: var(--color-text-muted); }
.task-modal-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.task-modal-head h3 { margin: 2px 0 0; }
.task-modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.task-modal-grid .full { grid-column: 1 / -1; }
.task-modal-comments { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--color-border); display: grid; gap: 8px; }
.comments-head { display: flex; align-items: baseline; gap: 8px; }
.btn-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
.task-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--color-border); }
.dependency-modal-bg { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 38%); }
.dependency-modal { width: min(520px, 100%); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: 20px; box-shadow: var(--shadow-lg); }
.dependency-modal-wide { width: min(960px, 100%); }
.dependency-modal-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.dependency-head-actions { display: flex; gap: 8px; align-items: center; }
.dependency-manager { display: grid; grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.4fr); gap: 18px; }
.dependency-manager-list { display: grid; align-content: start; gap: 6px; max-height: 480px; overflow: auto; padding-right: 4px; }
.dependency-list-item { display: grid; gap: 3px; padding: 9px 10px; text-align: left; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); cursor: pointer; font-size: 12px; }
.dependency-list-item small { color: var(--color-text-muted); }
.dependency-list-item.active { border-color: var(--color-primary); background: var(--color-primary-soft); }
.dependency-manager-form h4 { margin: 0 0 12px; }
.dependency-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dependency-modal-head h3 { margin: 0; }
.dependency-modal-actions { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--color-border); }
.dependency-modal-actions > div { display: flex; gap: 8px; flex-wrap: wrap; }
.dependency-color { width: 52px; height: 36px; padding: 3px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
@media print {
  .app-header, .gantt-toolbar, .project-bar, .gantt-top-actions, .manage-card, .gantt-drawer, .summary-card .muted { display: none !important; }
  .gantt-shell { min-height: 0; }
  .gantt-page { padding: 0; }
  .gantt-frame { box-shadow: none; }
}
@media (max-width: 1180px) {
  .gantt-page.has-drawer { padding-right: 0; }
  .gantt-drawer { position: static; width: auto; height: auto; margin: 16px; }
  .gantt-frame { grid-template-columns: 1fr; }
  .gantt-labels { border-right: 0; }
  .manage-grid { grid-template-columns: 1fr; }
  .task-modal-grid { grid-template-columns: 1fr; }
  .dependency-manager, .dependency-form-grid { grid-template-columns: 1fr; }
  .dependency-manager-list { max-height: 240px; }
}
</style>
