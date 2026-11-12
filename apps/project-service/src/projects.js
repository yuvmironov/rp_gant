import { randomUUID } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { call } from './user-client.js';
import { actorRolesFromPermissionRole, queueEvent } from './events/outbox.js';

function grpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toTimestamp(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  const milliseconds = date.getTime();
  if (Number.isNaN(milliseconds)) return undefined;
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}

function toProjectStatus(value) {
  return (
    {
      active: 'PROJECT_STATUS_ACTIVE',
      archived: 'PROJECT_STATUS_ARCHIVED',
      deleted: 'PROJECT_STATUS_DELETED',
    }[value] ?? 'PROJECT_STATUS_UNSPECIFIED'
  );
}

function toProject(row, myRole, owner = null) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    owner_user_id: row.owner_user_id,
    owner: owner
      ? { user_id: owner.id, display_name: owner.display_name ?? '', resolved: true }
      : { user_id: row.owner_user_id, display_name: '', resolved: false },
    status: toProjectStatus(row.status),
    settings: row.settings ?? {},
    my_role: myRole ?? 'PROJECT_ROLE_UNSPECIFIED',
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id ?? '',
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
    archived_at: toTimestamp(row.archived_at),
    deleted_at: toTimestamp(row.deleted_at),
    purge_after: toTimestamp(row.purge_after),
    names_resolved: Boolean(owner),
    diagrams_count: Number(row.diagrams_count ?? 0),
  };
}

function toDayMode(value) {
  return value === 'calendar' ? 'DAY_MODE_CALENDAR' : 'DAY_MODE_WORKING';
}

function toDiagram(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description ?? '',
    day_mode: toDayMode(row.day_mode),
    current_revision: String(row.current_revision ?? 0),
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id ?? '',
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
    archived_at: toTimestamp(row.archived_at),
    deleted_at: toTimestamp(row.deleted_at),
  };
}

function toPriority(value) {
  return (
    {
      low: 'PRIORITY_LOW',
      medium: 'PRIORITY_MEDIUM',
      high: 'PRIORITY_HIGH',
      critical: 'PRIORITY_CRITICAL',
    }[value] ?? 'PRIORITY_UNSPECIFIED'
  );
}

function fromPriority(value) {
  return (
    {
      PRIORITY_LOW: 'low',
      PRIORITY_MEDIUM: 'medium',
      PRIORITY_HIGH: 'high',
      PRIORITY_CRITICAL: 'critical',
    }[value] ?? 'medium'
  );
}

function toTaskStatus(value) {
  return (
    {
      planned: 'TASK_STATUS_PLANNED',
      in_progress: 'TASK_STATUS_IN_PROGRESS',
      done: 'TASK_STATUS_DONE',
      blocked: 'TASK_STATUS_BLOCKED',
      postponed: 'TASK_STATUS_POSTPONED',
    }[value] ?? 'TASK_STATUS_PLANNED'
  );
}

function dateString(timestamp) {
  if (!timestamp) return null;
  const milliseconds =
    Number(timestamp.seconds ?? 0) * 1000 + Math.floor(Number(timestamp.nanos ?? 0) / 1_000_000);
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

const HOURS_PER_DAY = 8;
const DAY_MS = 86_400_000;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addIsoDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function isWorkingDay(date, holidays) {
  return ![0, 6].includes(date.getUTCDay()) && !holidays.has(isoDate(date));
}

function calculateAutoEndDate(startDate, estimatedHours, dayMode, holidays) {
  const hours = Number(estimatedHours);
  const totalDays = Math.ceil(hours / HOURS_PER_DAY);
  if (!startDate || !Number.isFinite(totalDays) || totalDays <= 0) return null;
  let date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (dayMode === 'working') {
    while (!isWorkingDay(date, holidays)) date = addIsoDays(date, 1);
    for (let remaining = totalDays - 1; remaining > 0;) {
      date = addIsoDays(date, 1);
      if (isWorkingDay(date, holidays)) remaining -= 1;
    }
  } else {
    date = addIsoDays(date, totalDays - 1);
  }
  return isoDate(date);
}

async function loadHolidayDates(db, diagramId) {
  const result = await db.query(
    'SELECT holiday_date FROM plan.diagram_holidays WHERE diagram_id = $1',
    [diagramId],
  );
  return new Set(result.rows.map((row) => dateOnly(row.holiday_date)).filter(Boolean));
}

async function recalculateAutoTaskEnds(db, diagramId, dayMode = null) {
  const diagram = await db.query('SELECT day_mode FROM project.diagrams WHERE id = $1', [
    diagramId,
  ]);
  if (diagram.rowCount === 0) return;
  const mode = dayMode ?? diagram.rows[0].day_mode;
  const holidays = await loadHolidayDates(db, diagramId);
  const tasks = await db.query(
    `SELECT id, start_date, end_date, estimated_hours
     FROM plan.tasks
     WHERE diagram_id = $1 AND deleted_at IS NULL
       AND estimated_hours IS NOT NULL AND estimated_hours > 0
       AND start_date IS NOT NULL`,
    [diagramId],
  );
  for (const task of tasks.rows) {
    const startDate = dateOnly(task.start_date);
    const endDate = calculateAutoEndDate(startDate, task.estimated_hours, mode, holidays);
    if (endDate && endDate !== dateOnly(task.end_date)) {
      await db.query(
        `UPDATE plan.tasks
         SET end_date = $2, version = version + 1, updated_at = now()
         WHERE id = $1`,
        [task.id, endDate],
      );
    }
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toDirection(row, assignments = []) {
  return {
    id: row.id,
    diagram_id: row.diagram_id,
    wbs_code: row.wbs_code,
    sort_order: row.sort_order,
    name: row.name,
    description: row.description ?? '',
    result: row.result ?? '',
    priority: toPriority(row.priority),
    start_date: toTimestamp(row.start_date),
    end_date: toTimestamp(row.end_date),
    jira_number: row.jira_number ?? '',
    bp_flag: row.bp_flag,
    sp_flag: row.sp_flag,
    version: row.version,
    assignments,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id ?? '',
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
    deleted_at: toTimestamp(row.deleted_at),
  };
}

function toTask(row, assignments = []) {
  return {
    id: row.id,
    diagram_id: row.diagram_id,
    direction_id: row.direction_id,
    parent_task_id: row.parent_task_id ?? '',
    level: row.level,
    wbs_code: row.wbs_code,
    sort_order: row.sort_order,
    name: row.name,
    description: row.description ?? '',
    result: row.result ?? '',
    status: toTaskStatus(row.status),
    progress: row.progress,
    priority: toPriority(row.priority),
    start_date: toTimestamp(row.start_date),
    end_date: toTimestamp(row.end_date),
    actual_end_date: toTimestamp(row.actual_end_date),
    estimated_hours: row.estimated_hours == null ? null : Number(row.estimated_hours),
    jira_number: row.jira_number ?? '',
    bp_flag: row.bp_flag,
    sp_flag: row.sp_flag,
    version: row.version,
    assignments,
    comments_count: 0,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id ?? '',
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
    deleted_at: toTimestamp(row.deleted_at),
  };
}

function fromAssignmentRole(value) {
  return (
    {
      ASSIGNMENT_ROLE_RESPONSIBLE: 'responsible',
      ASSIGNMENT_ROLE_EXECUTOR: 'executor',
      ASSIGNMENT_ROLE_CO_EXECUTOR: 'co_executor',
    }[value] ?? ''
  );
}

function fromAssigneeType(value) {
  return (
    {
      ASSIGNEE_TYPE_USER: 'user',
      ASSIGNEE_TYPE_EXECUTOR: 'executor',
    }[value] ?? ''
  );
}

function fromTaskStatus(value) {
  return (
    {
      TASK_STATUS_PLANNED: 'planned',
      TASK_STATUS_IN_PROGRESS: 'in_progress',
      TASK_STATUS_DONE: 'done',
      TASK_STATUS_BLOCKED: 'blocked',
      TASK_STATUS_POSTPONED: 'postponed',
    }[value] ?? 'planned'
  );
}

function toDependency(row) {
  return {
    id: row.id,
    diagram_id: row.diagram_id,
    predecessor_type: row.predecessor_type,
    predecessor_id: row.predecessor_id,
    successor_type: row.successor_type,
    successor_id: row.successor_id,
    link_type: 'DEPENDENCY_LINK_TYPE_FINISH_TO_START',
    color: row.color ?? '',
    line_style:
      {
        solid: 'DEPENDENCY_LINE_STYLE_SOLID',
        dashed: 'DEPENDENCY_LINE_STYLE_DASHED',
        dotted: 'DEPENDENCY_LINE_STYLE_DOTTED',
      }[row.line_style] ?? 'DEPENDENCY_LINE_STYLE_SOLID',
    arrow_shape:
      {
        orthogonal: 'DEPENDENCY_ARROW_SHAPE_ORTHOGONAL',
        straight: 'DEPENDENCY_ARROW_SHAPE_STRAIGHT',
        curved: 'DEPENDENCY_ARROW_SHAPE_CURVED',
      }[row.arrow_shape] ?? 'DEPENDENCY_ARROW_SHAPE_ORTHOGONAL',
    created_by_user_id: row.created_by_user_id,
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
  };
}

function toAssignment(row, refs) {
  const ref = refs.get(`${row.assignee_type}:${row.assignee_id}`);
  return {
    id: row.id,
    role:
      {
        responsible: 'ASSIGNMENT_ROLE_RESPONSIBLE',
        executor: 'ASSIGNMENT_ROLE_EXECUTOR',
        co_executor: 'ASSIGNMENT_ROLE_CO_EXECUTOR',
      }[row.role] ?? 'ASSIGNMENT_ROLE_UNSPECIFIED',
    assignee_type:
      row.assignee_type === 'executor' ? 'ASSIGNEE_TYPE_EXECUTOR' : 'ASSIGNEE_TYPE_USER',
    assignee_id: row.assignee_id,
    display_name: ref?.display_name ?? '',
    linked_user_id: ref?.linked_user_id ?? '',
    resolved: Boolean(ref),
  };
}

async function resolveAssignments(rows, userClient) {
  const userIds = [
    ...new Set(rows.filter((row) => row.assignee_type === 'user').map((row) => row.assignee_id)),
  ];
  const executorIds = [
    ...new Set(
      rows.filter((row) => row.assignee_type === 'executor').map((row) => row.assignee_id),
    ),
  ];
  const refs = new Map();
  if (userIds.length > 0) {
    try {
      const users = await call(userClient, 'GetUsersByIds', { user_ids: userIds });
      for (const user of users.items) {
        refs.set(`user:${user.id}`, {
          display_name: user.display_name,
          linked_user_id: user.id,
        });
      }
    } catch {
      // Keep unresolved refs when User Service is unavailable.
    }
  }
  if (executorIds.length > 0) {
    try {
      const executors = await call(userClient, 'GetExecutorsByIds', {
        executor_ids: executorIds,
      });
      for (const executor of executors.items) {
        refs.set(`executor:${executor.id}`, {
          display_name: executor.full_name,
          linked_user_id: executor.linked_user_id ?? '',
        });
      }
    } catch {
      // Keep unresolved refs when User Service is unavailable.
    }
  }
  return rows.map((row) => toAssignment(row, refs));
}

async function loadAssignments(db, userClient, entityType, entityId) {
  const result = await db.query(
    `SELECT * FROM plan.assignments
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY role, created_at ASC`,
    [entityType, entityId],
  );
  return resolveAssignments(result.rows, userClient);
}

function toComment(row) {
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    author_user_id: row.author_user_id ?? '',
    mentioned_user_ids: row.mentioned_user_ids ?? [],
    body: row.body,
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
    deleted_at: toTimestamp(row.deleted_at),
  };
}

function toHoliday(row) {
  return {
    id: row.id,
    diagram_id: row.diagram_id,
    holiday_date: toTimestamp(row.holiday_date),
    name: row.name ?? '',
  };
}

function toImportJob(row) {
  const report = row.report ?? {};
  return {
    id: row.id,
    project_id: row.project_id,
    diagram_id: row.diagram_id,
    initiator_user_id: row.initiator_user_id,
    format: row.format === 'csv' ? 'IMPORT_FORMAT_CSV' : 'IMPORT_FORMAT_JSON',
    status:
      {
        queued: 'IMPORT_STATUS_QUEUED',
        processing: 'IMPORT_STATUS_PROCESSING',
        completed: 'IMPORT_STATUS_COMPLETED',
        failed: 'IMPORT_STATUS_FAILED',
        cancelled: 'IMPORT_STATUS_CANCELLED',
      }[row.status] ?? 'IMPORT_STATUS_FAILED',
    file_name: row.file_name ?? '',
    size_bytes: String(row.size_bytes ?? 0),
    report: {
      directions_count: report.directions_count ?? 0,
      tasks_count: report.tasks_count ?? 0,
      assignments_count: report.assignments_count ?? 0,
      without_responsible_count: report.without_responsible_count ?? 0,
      without_executor_count: report.without_executor_count ?? 0,
      without_coexecutor_count: report.without_coexecutor_count ?? 0,
      issues: (report.issues ?? []).map((issue) =>
        typeof issue === 'string'
          ? {
              task_id: '',
              wbs_code: issue.split(':')[1] ?? '',
              task_name: '',
              code: issue.split(':')[0] ?? 'import_issue',
              message: issue,
            }
          : issue,
      ),
    },
    error_code: row.error_code ?? '',
    error_message: row.error_message ?? '',
    created_at: toTimestamp(row.created_at),
    started_at: toTimestamp(row.started_at),
    finished_at: toTimestamp(row.finished_at),
    expires_at: toTimestamp(row.expires_at),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      if (cell.endsWith('\r')) cell = cell.slice(0, -1);
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  );
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function mapDbError(error) {
  return error;
}

function actorUserId(call_) {
  return call_.metadata.get('x-actor-user-id')[0] ?? '';
}

function hasField(request, field) {
  return Object.prototype.hasOwnProperty.call(request, field) && request[field] !== undefined;
}

function versionConflict() {
  return grpcError(status.ABORTED, 'version_conflict');
}

async function entityBelongsToDiagram(db, type, id, diagramId) {
  const table = type === 'task' ? 'plan.tasks' : 'plan.directions';
  const result = await db.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND diagram_id = $2 AND deleted_at IS NULL`,
    [id, diagramId],
  );
  return result.rowCount > 0;
}

function parseDelimited(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((line) => line.trim());
  const delimiter =
    (lines[0]?.match(/;/g)?.length ?? 0) > (lines[0]?.match(/,/g)?.length ?? 0) ? ';' : ',';
  const parseLine = (line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        values.push(value.trim());
        value = '';
      } else {
        value += char;
      }
    }
    values.push(value.trim());
    return values;
  };
  const dataLines = lines.filter((line) => !line.startsWith('#'));
  const meta = Object.fromEntries(
    lines
      .filter((line) => line.startsWith('#'))
      .map((line) => {
        const [key, ...rest] = line.slice(1).trim().split(/\s+/);
        return [key, rest.join(' ')];
      }),
  );
  const headers = parseLine(dataLines[0] ?? '');
  const rows = dataLines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
  return { headers, rows, meta };
}

function booleanValue(value) {
  return ['1', 'да', 'есть', 'yes', 'true'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

export function standaloneCsvToPayload(
  text,
  report,
  executorMap = new Map(),
  activeProjectMemberIds = new Set(),
) {
  const { headers, rows, meta } = parseDelimited(text);
  const find = (names) => names.find((name) => headers.includes(name));
  const idKey = find(['WBS ID', 'ID', 'wbs_code', 'WBS']);
  if (!idKey) throw new Error('import_format_unsupported');
  const nameKey = find(['Наименование', 'Название', 'name']);
  const parentKey = find(['Родитель', 'parent_wbs', 'parent']);
  const levelKey = find(['Уровень', 'level']);
  const typeKey = find(['Тип', 'type']);
  const statusKey = find(['Статус', 'status']);
  const percentKey = find(['Процент', '%', 'progress']);
  const priorityKey = find(['Приоритет', 'priority']);
  const startKey = find(['Начало', 'start_date', 'start']);
  const endKey = find(['Окончание', 'end_date', 'end']);
  const doneKey = find(['Факт завершения', 'Факт', 'actual_end_date']);
  const jiraKey = find(['Jira', 'jira_number']);
  const bpKey = find(['БП', 'bp_flag']);
  const spKey = find(['СП', 'sp_flag']);
  const depsKey = find(['Зависимости', 'deps', 'dependencies']);
  const resultKey = find(['Результат', 'result']);
  const descKey = find(['Описание', 'description']);
  const commentsKey = find(['Комментарии', 'comments']);
  const ownerKey = find(['Ответственный направления', 'Владелец', 'ownerId', 'owner_id']);
  const executorKey = find(['Исполнитель', 'execId', 'executor_id']);
  const coExecutorKey = find(['Соисполнитель', 'coId', 'co_executor_id']);
  const tasks = rows.map((row) => {
    const id = row[idKey];
    const level = Number(row[levelKey]) || id.split('.').length;
    const type =
      row[typeKey] || (level === 1 ? 'Направление' : level === 3 ? 'Подзадача' : 'Задача');
    return {
      id,
      task: row[nameKey],
      parentId: row[parentKey] || null,
      level,
      type,
      status: row[statusKey],
      percentComplete: Number(String(row[percentKey] ?? '').replace(',', '.')),
      priority: row[priorityKey],
      start: row[startKey],
      end: row[endKey],
      doneDate: row[doneKey],
      jira: row[jiraKey],
      hasBP: booleanValue(row[bpKey]),
      hasSP: booleanValue(row[spKey]),
      dependencies: row[depsKey],
      result: row[resultKey],
      description: row[descKey],
      comments: String(row[commentsKey] ?? '')
        .split('|')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => ({ text: value.replace(/^\d{2}\.\d{2}\.\d{4}:\s*/, '') })),
      ownerId: row[ownerKey],
      execId: row[executorKey],
      coId: row[coExecutorKey],
    };
  });
  const payload = normalizeStandaloneImport(
    { project: meta.project, tasks, workdays: { mode: 'calendar', holidays: [] } },
    report,
    executorMap,
    activeProjectMemberIds,
  );
  return payload;
}

export function normalizeStandaloneImport(
  payload,
  report,
  executorMap = new Map(),
  activeProjectMemberIds = new Set(),
) {
  const statusMap = {
    Запланировано: 'planned',
    'В работе': 'in_progress',
    Выполнено: 'done',
    Заблокировано: 'blocked',
    Отложено: 'postponed',
  };
  const priorityMap = {
    Низкий: 'low',
    Средний: 'medium',
    Высокий: 'high',
    Критический: 'critical',
  };
  const items = Array.isArray(payload.tasks) ? payload.tasks : [];
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const localExecutorNames = new Map(
    (payload.executors ?? []).map((executor) => [String(executor.id), String(executor.name ?? '')]),
  );
  const resolveExecutor = (localId) => {
    const id = String(localId ?? '');
    if (!id) return null;
    if (isUuid(id)) {
      return executorMap.get(`id:${id}`) ?? (activeProjectMemberIds.has(id) ? id : null);
    }
    const name = localExecutorNames.get(id) ?? id;
    return executorMap.get(String(name).trim().toLowerCase()) ?? null;
  };
  const assignmentsFor = (item, roles, ownerLabel) => {
    const assignments = [];
    for (const [field, role] of roles) {
      const resolved = resolveExecutor(item[field]);
      if (item[field] && !resolved) {
        report.issues.push(`${ownerLabel}_not_mapped:${item.id}:${item[field]}`);
      }
      if (resolved) assignments.push({ role, assigneeType: 'user', assigneeId: resolved });
    }
    return assignments;
  };
  const rootId = (item) => {
    let current = item;
    while (current?.parentId && byId.has(String(current.parentId))) {
      current = byId.get(String(current.parentId));
    }
    return String(current?.id ?? '');
  };
  const directions = items
    .filter((item) => Number(item.level) === 1 || item.type === 'Направление')
    .map((item, index) => ({
      id: String(item.id),
      wbsCode: String(item.id),
      sortOrder: Number(payload.directionOrder?.indexOf(String(item.id))) + 1 || index + 1,
      name: item.task ?? item.name ?? String(item.id),
      description: item.description ?? item.desc ?? '',
      result: item.result ?? '',
      priority: priorityMap[item.priority] ?? item.priority ?? 'medium',
      startDate: item.start ?? null,
      endDate: item.end ?? null,
      jiraNumber: item.jira ?? '',
      bpFlag: Boolean(item.hasBP ?? item.bp),
      spFlag: Boolean(item.hasSP ?? item.sp),
      assignments: assignmentsFor(item, [['ownerId', 'responsible']], 'responsible'),
    }));
  const tasks = items
    .filter(
      (item) => Number(item.level) >= 2 || item.type === 'Задача' || item.type === 'Подзадача',
    )
    .map((item, index) => {
      const level =
        Number(item.level) >= 2 ? Number(item.level) : String(item.id).split('.').length;
      const parentId = item.parentId ? String(item.parentId) : null;
      const directionId = rootId(item);
      if (!directions.some((direction) => direction.id === directionId)) {
        report.issues.push(`direction_not_found:${item.id}`);
      }
      return {
        id: String(item.id),
        directionId,
        parentTaskId: level >= 3 ? parentId : null,
        level,
        wbsCode: String(item.id),
        sortOrder: Number(String(item.id).split('.').at(-1)) || index + 1,
        name: item.task ?? item.name ?? String(item.id),
        description: item.description ?? item.desc ?? '',
        result: item.result ?? '',
        status: statusMap[item.status] ?? item.status ?? 'planned',
        progress: Number(item.percentComplete ?? item.pct ?? item.progress ?? 0),
        priority: priorityMap[item.priority] ?? item.priority ?? 'medium',
        startDate: item.start ?? null,
        endDate: item.end ?? null,
        actualEndDate: item.doneDate ?? item.actualEndDate ?? null,
        jiraNumber: item.jira ?? '',
        bpFlag: Boolean(item.hasBP ?? item.bp),
        spFlag: Boolean(item.hasSP ?? item.sp),
        assignments: (() => {
          const ownerId = item.ownerId;
          const executorId = item.execId || ownerId;
          if (item.execId && ownerId && String(item.execId) !== String(ownerId)) {
            report.issues.push(`task_responsible_conflicts_with_executor:${item.id}`);
          }
          return assignmentsFor(
            { ...item, execId: executorId },
            [
              ['execId', 'executor'],
              ['coId', 'co_executor'],
            ],
            'executor',
          );
        })(),
      };
    });
  const dependencies = [];
  for (const item of items) {
    const predecessors = String(item.dependencies ?? item.deps ?? '')
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    for (const predecessorId of predecessors) {
      const predecessor = byId.get(predecessorId);
      if (!predecessor) {
        report.issues.push(`dependency_not_found:${item.id}:${predecessorId}`);
        continue;
      }
      const style = payload.depStyles?.[`${predecessorId}>${item.id}`] ?? {};
      dependencies.push({
        predecessorType: Number(predecessor.level) === 1 ? 'direction' : 'task',
        predecessorId,
        successorType: 'task',
        successorId: String(item.id),
        color: style.color,
        lineStyle: style.dash ?? style.lineStyle,
        arrowShape: style.shape ?? style.arrowShape,
      });
    }
  }
  const comments = [];
  for (const item of items) {
    for (const comment of item.comments ?? []) {
      comments.push({
        entityType: 'task',
        entityId: String(item.id),
        authorUserId: isUuid(comment.authorUserId) ? comment.authorUserId : null,
        body: comment.text ?? comment.body ?? '',
      });
    }
  }
  return {
    formatVersion: 2,
    project: payload.project,
    workdays: payload.workdays,
    directions,
    tasks,
    dependencies,
    comments,
  };
}

async function processDiagramImport(
  db,
  {
    diagramId,
    format: inputFormat,
    data,
    actorId,
    executorMap = new Map(),
    executorUserMap = new Map(),
    activeProjectMemberIds = new Set(),
    dryRun = false,
  },
) {
  let format = inputFormat;
  const client = await db.connect();
  const report = {
    directions_count: 0,
    tasks_count: 0,
    assignments_count: 0,
    without_responsible_count: 0,
    without_executor_count: 0,
    without_coexecutor_count: 0,
    issues: [],
  };
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM plan.assignments
       WHERE (entity_type = 'task' AND entity_id IN (SELECT id FROM plan.tasks WHERE diagram_id = $1))
          OR (entity_type = 'direction' AND entity_id IN (SELECT id FROM plan.directions WHERE diagram_id = $1))`,
      [diagramId],
    );
    await client.query(
      `DELETE FROM plan.comments
       WHERE (entity_type = 'task' AND entity_id IN (SELECT id FROM plan.tasks WHERE diagram_id = $1))
          OR (entity_type = 'direction' AND entity_id IN (SELECT id FROM plan.directions WHERE diagram_id = $1))`,
      [diagramId],
    );
    await client.query('DELETE FROM plan.dependencies WHERE diagram_id = $1', [diagramId]);
    await client.query(`DELETE FROM plan.diagram_holidays WHERE diagram_id = $1`, [diagramId]);
    await client.query('DELETE FROM plan.tasks WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM plan.directions WHERE diagram_id = $1', [diagramId]);

    const priorityValues = new Set(['low', 'medium', 'high', 'critical']);
    const statusValues = new Set(['planned', 'in_progress', 'done', 'blocked', 'postponed']);
    const normalizeRole = (value) =>
      String(value ?? '')
        .replace('ASSIGNMENT_ROLE_', '')
        .toLowerCase();
    const normalizeType = (value) =>
      String(value ?? '')
        .replace('ASSIGNEE_TYPE_', '')
        .toLowerCase();
    const normalizeStatus = (value) => {
      const status = String(value ?? '')
        .replace('TASK_STATUS_', '')
        .toLowerCase();
      return statusValues.has(status) ? status : 'planned';
    };
    const normalizePriority = (value) => {
      const priority = String(value ?? '')
        .replace('PRIORITY_', '')
        .toLowerCase();
      return priorityValues.has(priority) ? priority : 'medium';
    };
    const insertTask = async (task, directionId, parentTaskId, index) => {
      const result = await client.query(
        `INSERT INTO plan.tasks
           (diagram_id, direction_id, parent_task_id, level, wbs_code, sort_order, name,
            description, result, status, progress, priority, start_date, end_date,
            actual_end_date, jira_number, bp_flag, sp_flag, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING id`,
        [
          diagramId,
          directionId,
          parentTaskId,
          parentTaskId ? 3 : 2,
          String(task.wbsCode ?? task.wbs_code ?? `${index}`),
          Number(task.sortOrder ?? task.sort_order ?? index),
          String(task.name ?? '').trim(),
          String(task.description ?? ''),
          String(task.result ?? ''),
          normalizeStatus(task.status),
          Math.min(Math.max(Number(task.progress ?? 0) || 0, 0), 100),
          normalizePriority(task.priority),
          dateOnly(task.startDate ?? task.start_date),
          dateOnly(task.endDate ?? task.end_date),
          dateOnly(task.actualEndDate ?? task.actual_end_date),
          String(task.jiraNumber ?? task.jira_number ?? '') || null,
          Boolean(task.bpFlag ?? task.bp_flag),
          Boolean(task.spFlag ?? task.sp_flag),
          actorId,
        ],
      );
      return result.rows[0].id;
    };

    if (format === 'csv') {
      const csvText = Buffer.from(data).toString('utf8');
      if (/WBS ID|Наименование|Уровень|Родитель/i.test(csvText.slice(0, 500))) {
        const converted = standaloneCsvToPayload(
          csvText,
          report,
          executorMap,
          activeProjectMemberIds,
        );
        await client.query(
          `UPDATE project.diagrams
           SET name = COALESCE(NULLIF($2, ''), name), day_mode = 'calendar',
               updated_by_user_id = $3, updated_at = now()
           WHERE id = $1`,
          [diagramId, String(converted.project ?? '').trim(), actorId],
        );
        data = Buffer.from(JSON.stringify(converted));
        format = 'json';
      }
    }
    if (format === 'csv') {
      const rows = parseCsv(Buffer.from(data).toString('utf8'));
      const directionMap = new Map();
      for (const row of rows) {
        const key = row.direction_wbs || 'direction';
        if (!directionMap.has(key)) {
          const result = await client.query(
            `INSERT INTO plan.directions
               (diagram_id, wbs_code, sort_order, name, priority, created_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
              diagramId,
              key,
              directionMap.size + 1,
              String(row.direction_name || key),
              'medium',
              actorId,
            ],
          );
          directionMap.set(key, result.rows[0].id);
        }
      }
      report.directions_count = directionMap.size;
      const taskMap = new Map();
      const orderedRows = [...rows].sort((a, b) => Number(a.level || 2) - Number(b.level || 2));
      for (const row of orderedRows) {
        const parentId = row.parent_wbs ? taskMap.get(row.parent_wbs) : null;
        if (Number(row.level || 2) === 3 && !parentId) {
          throw new Error('import_parent_not_found');
        }
        const taskId = await insertTask(
          {
            ...row,
            sortOrder: row.wbs_code?.split('.').at(-1),
            status: row.status,
            priority: row.priority,
          },
          directionMap.get(row.direction_wbs || 'direction'),
          parentId,
          report.tasks_count + 1,
        );
        taskMap.set(row.wbs_code, taskId);
        report.tasks_count += 1;
      }
    } else {
      let payload = JSON.parse(Buffer.from(data).toString('utf8'));
      if (payload && !payload.formatVersion && Array.isArray(payload.tasks)) {
        payload = normalizeStandaloneImport(payload, report, executorMap, activeProjectMemberIds);
        await client.query(
          `UPDATE project.diagrams
           SET name = COALESCE(NULLIF($2, ''), name),
               day_mode = $3,
               updated_by_user_id = $4,
               updated_at = now()
           WHERE id = $1`,
          [
            diagramId,
            String(payload.project ?? '').trim(),
            payload.workdays?.mode === 'workdays' ? 'working' : 'calendar',
            actorId,
          ],
        );
      }
      if (!payload || payload.formatVersion !== 2) {
        throw new Error('import_format_unsupported');
      }
      const directionMap = new Map();
      for (const [index, direction] of (payload.directions ?? []).entries()) {
        const result = await client.query(
          `INSERT INTO plan.directions
             (diagram_id, wbs_code, sort_order, name, description, result, priority,
              start_date, end_date, jira_number, bp_flag, sp_flag, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            diagramId,
            String(direction.wbsCode ?? index + 1),
            Number(direction.sortOrder ?? index + 1),
            String(direction.name ?? '').trim(),
            String(direction.description ?? ''),
            String(direction.result ?? ''),
            normalizePriority(direction.priority),
            dateOnly(direction.startDate),
            dateOnly(direction.endDate),
            String(direction.jiraNumber ?? '') || null,
            Boolean(direction.bpFlag),
            Boolean(direction.spFlag),
            actorId,
          ],
        );
        directionMap.set(direction.id, result.rows[0].id);
      }
      report.directions_count = directionMap.size;

      const taskMap = new Map();
      const tasks = [...(payload.tasks ?? [])].sort(
        (a, b) => Number(a.level ?? 2) - Number(b.level ?? 2),
      );
      for (const [index, task] of tasks.entries()) {
        const parentId = task.parentTaskId ? taskMap.get(task.parentTaskId) : null;
        if (Number(task.level ?? 2) === 3 && !parentId) {
          throw new Error('import_parent_not_found');
        }
        const directionId = directionMap.get(task.directionId);
        if (!directionId) throw new Error('import_direction_not_found');
        const taskId = await insertTask(task, directionId, parentId, index + 1);
        taskMap.set(task.id, taskId);
        report.tasks_count += 1;
      }

      const assignments = [];
      for (const direction of payload.directions ?? []) {
        for (const assignment of direction.assignments ?? []) {
          assignments.push({
            entityType: 'direction',
            entityId: directionMap.get(direction.id),
            assignment,
          });
        }
      }
      for (const task of payload.tasks ?? []) {
        for (const assignment of task.assignments ?? []) {
          const entityId = taskMap.get(task.id);
          if (entityId) assignments.push({ entityType: 'task', entityId, assignment });
        }
      }
      assignments.sort((left, right) => {
        if (
          left.entityType !== 'task' ||
          right.entityType !== 'task' ||
          left.entityId !== right.entityId
        ) {
          return 0;
        }
        const leftPriority = normalizeRole(left.assignment.role) === 'responsible' ? 1 : 0;
        const rightPriority = normalizeRole(right.assignment.role) === 'responsible' ? 1 : 0;
        return leftPriority - rightPriority;
      });
      const assignmentCounts = new Map();
      for (const item of assignments) {
        let role = normalizeRole(item.assignment.role);
        let assigneeType = normalizeType(item.assignment.assigneeType);
        let assigneeId = String(item.assignment.assigneeId ?? '');
        if (item.entityType === 'task' && role === 'responsible') {
          role = 'executor';
          report.issues.push(
            `task_responsible_mapped_to_executor:${item.assignment.assigneeId ?? ''}`,
          );
        }
        const validRoles =
          item.entityType === 'direction' ? ['responsible'] : ['executor', 'co_executor'];
        if (
          !validRoles.includes(role) ||
          !['user', 'executor'].includes(assigneeType) ||
          !isUuid(assigneeId)
        ) {
          continue;
        }
        if (item.entityType === 'direction' && assigneeType === 'executor') {
          const linkedUserId = executorUserMap.get(assigneeId);
          if (!linkedUserId || !activeProjectMemberIds.has(linkedUserId)) {
            report.issues.push(`direction_responsible_not_active_project_member:${assigneeId}`);
            continue;
          }
          assigneeType = 'user';
          assigneeId = linkedUserId;
        } else if (
          item.entityType === 'task' &&
          role !== 'executor' &&
          assigneeType === 'executor'
        ) {
          const linkedUserId = executorUserMap.get(assigneeId);
          if (linkedUserId) {
            assigneeType = 'user';
            assigneeId = linkedUserId;
          } else {
            report.issues.push(`executor_assignment_preserved_as_legacy:${assigneeId}`);
          }
        } else if (
          item.entityType === 'task' &&
          role === 'executor' &&
          assigneeType === 'executor' &&
          normalizeRole(item.assignment.role) === 'responsible'
        ) {
          report.issues.push(`task_catalog_responsible_preserved_as_legacy_executor:${assigneeId}`);
        } else if (assigneeType === 'executor') {
          const linkedUserId = executorUserMap.get(assigneeId);
          if (linkedUserId) {
            assigneeType = 'user';
            assigneeId = linkedUserId;
          } else {
            report.issues.push(`executor_assignment_preserved_as_legacy:${assigneeId}`);
          }
        }
        if (assigneeType === 'user' && !activeProjectMemberIds.has(assigneeId)) {
          report.issues.push(`assignee_not_active_project_member:${assigneeId}`);
          continue;
        }
        const slot = `${item.entityType}:${item.entityId}:${role}`;
        const count = assignmentCounts.get(slot) ?? 0;
        const maxForRole = role === 'co_executor' ? 2 : 1;
        if (count >= maxForRole) {
          report.issues.push(
            `assignment_conflict_preserved_existing:${item.entityType}:${item.entityId}:${role}`,
          );
          continue;
        }
        const inserted = await client.query(
          `INSERT INTO plan.assignments
             (entity_type, entity_id, role, assignee_type, assignee_id, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [item.entityType, item.entityId, role, assigneeType, assigneeId, actorId],
        );
        if (inserted.rowCount > 0) {
          assignmentCounts.set(slot, count + 1);
          report.assignments_count += 1;
        }
      }

      for (const dependency of payload.dependencies ?? []) {
        const predecessorId =
          dependency.predecessorType === 'task'
            ? taskMap.get(dependency.predecessorId)
            : directionMap.get(dependency.predecessorId);
        const successorId =
          dependency.successorType === 'task'
            ? taskMap.get(dependency.successorId)
            : directionMap.get(dependency.successorId);
        if (!predecessorId || !successorId) continue;
        await client.query(
          `INSERT INTO plan.dependencies
             (diagram_id, predecessor_type, predecessor_id, successor_type, successor_id,
              link_type, color, line_style, arrow_shape, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, 'finish_to_start', $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            diagramId,
            dependency.predecessorType,
            predecessorId,
            dependency.successorType,
            successorId,
            dependency.color || null,
            dependency.lineStyle || 'solid',
            dependency.arrowShape || 'orthogonal',
            actorId,
          ],
        );
      }

      for (const comment of payload.comments ?? []) {
        const entityId =
          comment.entityType === 'task'
            ? taskMap.get(comment.entityId)
            : directionMap.get(comment.entityId);
        if (!entityId) continue;
        await client.query(
          `INSERT INTO plan.comments
             (entity_type, entity_id, author_user_id, mentioned_user_ids, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            comment.entityType,
            entityId,
            comment.authorUserId || actorId,
            comment.mentionedUserIds ?? [],
            String(comment.body ?? ''),
          ],
        );
      }

      for (const holiday of payload.workdays?.holidays ?? []) {
        const holidayDate = dateOnly(holiday.date);
        if (!holidayDate) continue;
        await client.query(
          `INSERT INTO plan.diagram_holidays (diagram_id, holiday_date, name)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [diagramId, holidayDate, String(holiday.name ?? '') || null],
        );
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveCommentEntity(db, entityType, entityId) {
  if (!['task', 'direction'].includes(entityType) || !isUuid(entityId)) return null;
  const table = entityType === 'task' ? 'plan.tasks' : 'plan.directions';
  const result = await db.query(
    `SELECT d.project_id, e.diagram_id
     FROM ${table} e
     JOIN project.diagrams d ON d.id = e.diagram_id
     WHERE e.id = $1 AND e.deleted_at IS NULL AND d.deleted_at IS NULL`,
    [entityId],
  );
  return result.rows[0] ?? null;
}

async function createsDependencyCycle(
  db,
  diagramId,
  fromType,
  fromId,
  toType,
  toId,
  excludeDependencyId = null,
) {
  const result = await db.query(
    `SELECT predecessor_type, predecessor_id, successor_type, successor_id
     FROM plan.dependencies
     WHERE diagram_id = $1
       AND ($2::uuid IS NULL OR id <> $2)`,
    [diagramId, excludeDependencyId],
  );
  const graph = new Map();
  const addEdge = (from, to) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  };
  for (const row of result.rows) {
    addEdge(
      `${row.predecessor_type}:${row.predecessor_id}`,
      `${row.successor_type}:${row.successor_id}`,
    );
  }
  const fromKey = `${fromType}:${fromId}`;
  const toKey = `${toType}:${toId}`;
  addEdge(fromKey, toKey);

  const stack = [toKey];
  const seen = new Set();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === fromKey) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of graph.get(current) ?? []) stack.push(next);
  }
  return false;
}

function forbiddenDependencyDirection(predecessorType, successorType) {
  return predecessorType === 'direction' && successorType === 'task';
}

async function checkPermission(call_, userClient, projectId, permission) {
  const actor = actorUserId(call_);
  if (!actor) {
    throw grpcError(status.INVALID_ARGUMENT, 'actor_user_id_required');
  }

  const access = await call(userClient, 'CheckProjectPermission', {
    user_id: actor,
    project_id: projectId,
    permission,
  });
  if (!access.allowed) {
    throw grpcError(status.PERMISSION_DENIED, 'permission_denied');
  }
  return access.role;
}

export function createProjectImplementation({ db, userClient }) {
  return {
    async CreateProject(call_, callback) {
      const name = String(call_.request.name ?? '').trim();
      const description = String(call_.request.description ?? '');
      const ownerUserId = String(call_.request.owner_user_id ?? '');
      if (!name || name.length > 200) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_project_name'));
        return;
      }
      if (!ownerUserId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'owner_user_id_required'));
        return;
      }

      const projectId = randomUUID();
      const settings = call_.request.settings ?? {};
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO project.projects
             (id, name, description, owner_user_id, status, settings, created_by_user_id, updated_by_user_id)
           VALUES ($1, $2, $3, $4, 'active', $5, $4, $4)
           RETURNING *`,
          [projectId, name, description, ownerUserId, settings],
        );
        await client.query('COMMIT');

        try {
          await call(userClient, 'EnsureProjectOwner', {
            project_id: projectId,
            owner_user_id: ownerUserId,
          });
        } catch (error) {
          await db.query('DELETE FROM project.projects WHERE id = $1', [projectId]).catch(() => {});
          callback(error);
          return;
        }

        callback(null, {
          project: toProject(result.rows[0], 'PROJECT_ROLE_OWNER'),
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async ListProjects(call_, callback) {
      const userId = String(call_.request.user_id ?? '');
      if (!userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'user_id_required'));
        return;
      }

      const limit = Math.min(Math.max(Number(call_.request.page?.limit ?? 50), 1), 200);
      const offset = Math.max(Number(call_.request.page?.offset ?? 0), 0);

      try {
        const accessible = await call(userClient, 'ListAccessibleProjectIds', {
          user_id: userId,
        });
        const ids = (accessible.items ?? []).map((item) => item.project_id);
        const roles = new Map((accessible.items ?? []).map((item) => [item.project_id, item.role]));
        const isAdmin = Boolean(accessible.is_admin);

        if (ids.length === 0 && !isAdmin) {
          callback(null, {
            items: [],
            page: { total: 0, limit, offset },
          });
          return;
        }

        const status =
          {
            PROJECT_STATUS_ARCHIVED: 'archived',
            PROJECT_STATUS_DELETED: 'deleted',
            PROJECT_STATUS_ACTIVE: 'active',
          }[call_.request.status] ?? 'active';
        const result = await db.query(
          `SELECT p.*, count(d.id)::int AS diagrams_count
           FROM project.projects p
           LEFT JOIN project.diagrams d ON d.project_id = p.id AND d.deleted_at IS NULL
           WHERE ($1::boolean OR p.id = ANY($2::uuid[])) AND p.status = $5
           GROUP BY p.id
           ORDER BY p.updated_at DESC
           LIMIT $3 OFFSET $4`,
          [isAdmin, ids, limit, offset, status],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total
           FROM project.projects
           WHERE ($1::boolean OR id = ANY($2::uuid[])) AND status = $3`,
          [isAdmin, ids, status],
        );
        const ownerIds = [...new Set(result.rows.map((row) => row.owner_user_id).filter(Boolean))];
        const ownerResponse = ownerIds.length
          ? await call(userClient, 'GetUsersByIds', { user_ids: ownerIds })
          : { items: [] };
        const owners = new Map((ownerResponse.items ?? []).map((item) => [item.id, item]));

        callback(null, {
          items: result.rows.map((row) =>
            toProject(
              row,
              roles.get(row.id) ?? 'PROJECT_ROLE_UNSPECIFIED',
              owners.get(row.owner_user_id) ?? null,
            ),
          ),
          page: {
            total: count.rows[0].total,
            limit,
            offset,
          },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetProject(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      try {
        const role = await checkPermission(call_, userClient, projectId, 'project.view');
        const result = await db.query('SELECT * FROM project.projects WHERE id = $1', [projectId]);
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'project_not_found'));
          return;
        }
        callback(null, { project: toProject(result.rows[0], role) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateProject(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      try {
        const role = await checkPermission(call_, userClient, projectId, 'project.update');
        const current = await db.query('SELECT * FROM project.projects WHERE id = $1', [projectId]);
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'project_not_found'));
          return;
        }
        if (current.rows[0].status !== 'active') {
          callback(grpcError(status.FAILED_PRECONDITION, 'project_not_active'));
          return;
        }

        const result = await db.query(
          `UPDATE project.projects
           SET name = COALESCE($2, name),
               description = COALESCE($3, description),
               settings = COALESCE($4, settings),
               updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [
            projectId,
            call_.request.name ?? null,
            call_.request.description ?? null,
            call_.request.settings ?? null,
          ],
        );
        callback(null, { project: toProject(result.rows[0], role) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ArchiveProject(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      try {
        const role = await checkPermission(call_, userClient, projectId, 'project.archive');
        const result = await db.query(
          `UPDATE project.projects
           SET status = 'archived', archived_at = now(), updated_at = now()
           WHERE id = $1 AND status = 'active'
           RETURNING *`,
          [projectId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.FAILED_PRECONDITION, 'project_not_active'));
          return;
        }
        callback(null, { project: toProject(result.rows[0], role) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UnarchiveProject(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      try {
        const role = await checkPermission(call_, userClient, projectId, 'project.restore');
        const result = await db.query(
          `UPDATE project.projects
           SET status = 'active', archived_at = NULL, updated_at = now()
           WHERE id = $1 AND status = 'archived'
           RETURNING *`,
          [projectId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.FAILED_PRECONDITION, 'project_not_archived'));
          return;
        }
        callback(null, { project: toProject(result.rows[0], role) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async DeleteProject(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      try {
        const role = await checkPermission(call_, userClient, projectId, 'project.delete');
        const result = await db.query(
          `UPDATE project.projects
           SET status = 'deleted',
               deleted_at = now(),
               purge_after = now() + interval '1 year',
               updated_at = now()
           WHERE id = $1 AND status = 'archived'
           RETURNING *`,
          [projectId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.FAILED_PRECONDITION, 'project_not_archived'));
          return;
        }
        await call(userClient, 'RemoveExecutorProjectLinks', { project_id: projectId });
        callback(null, { project: toProject(result.rows[0], role) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async RestoreProject(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      try {
        const role = await checkPermission(call_, userClient, projectId, 'project.restore');
        const result = await db.query(
          `UPDATE project.projects
           SET status = 'archived',
               deleted_at = NULL,
               purge_after = NULL,
               archived_at = now(),
               updated_at = now()
           WHERE id = $1 AND status = 'deleted'
           RETURNING *`,
          [projectId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.FAILED_PRECONDITION, 'project_not_deleted'));
          return;
        }
        callback(null, { project: toProject(result.rows[0], role) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CreateDiagram(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      const name = String(call_.request.name ?? '').trim();
      const description = String(call_.request.description ?? '');
      const dayMode = toDayMode(
        call_.request.day_mode === 'DAY_MODE_CALENDAR' ? 'calendar' : 'working',
      );
      if (!projectId || !name || name.length > 200) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_diagram_name'));
        return;
      }

      try {
        await checkPermission(call_, userClient, projectId, 'diagram.create');
        const result = await db.query(
          `INSERT INTO project.diagrams
             (project_id, name, description, day_mode, created_by_user_id, updated_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING *`,
          [
            projectId,
            name,
            description,
            dayMode === 'DAY_MODE_CALENDAR' ? 'calendar' : 'working',
            actorUserId(call_),
          ],
        );
        callback(null, { diagram: toDiagram(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ListDiagrams(call_, callback) {
      const projectId = String(call_.request.project_id ?? '');
      const limit = Math.min(Math.max(Number(call_.request.page?.limit ?? 50), 1), 200);
      const offset = Math.max(Number(call_.request.page?.offset ?? 0), 0);

      try {
        await checkPermission(call_, userClient, projectId, 'project.view');
        const result = await db.query(
          `SELECT *
           FROM project.diagrams
           WHERE project_id = $1 AND deleted_at IS NULL
           ORDER BY created_at ASC
           LIMIT $2 OFFSET $3`,
          [projectId, limit, offset],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total
           FROM project.diagrams
           WHERE project_id = $1 AND deleted_at IS NULL`,
          [projectId],
        );
        callback(null, {
          items: result.rows.map(toDiagram),
          page: {
            total: count.rows[0].total,
            limit,
            offset,
          },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetDiagram(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      try {
        const result = await db.query(
          `SELECT * FROM project.diagrams
           WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        const diagram = result.rows[0];
        await checkPermission(call_, userClient, diagram.project_id, 'project.view');
        callback(null, {
          diagram: toDiagram(diagram),
          project_id: diagram.project_id,
          current_revision: String(diagram.current_revision ?? 0),
          names_resolved: false,
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateDiagram(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      try {
        const current = await db.query(
          `SELECT * FROM project.diagrams
           WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        const row = current.rows[0];
        await checkPermission(call_, userClient, row.project_id, 'diagram.update');
        const dayMode = call_.request.day_mode
          ? call_.request.day_mode === 'DAY_MODE_CALENDAR'
            ? 'calendar'
            : 'working'
          : row.day_mode;
        const result = await db.query(
          `UPDATE project.diagrams
           SET name = COALESCE($2, name),
               description = COALESCE($3, description),
               day_mode = $4,
               updated_by_user_id = $5,
               updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [
            diagramId,
            call_.request.name ?? null,
            call_.request.description ?? null,
            dayMode,
            actorUserId(call_),
          ],
        );
        if (dayMode !== row.day_mode) {
          await recalculateAutoTaskEnds(db, diagramId, dayMode);
        }
        callback(null, { diagram: toDiagram(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async DeleteDiagram(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      try {
        const current = await db.query(
          `SELECT * FROM project.diagrams
           WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(call_, userClient, current.rows[0].project_id, 'diagram.delete');
        await db.query(
          `UPDATE project.diagrams
           SET deleted_at = now(), updated_by_user_id = $2, updated_at = now()
           WHERE id = $1`,
          [diagramId, actorUserId(call_)],
        );
        callback(null, { deleted: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CreateDirection(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const name = String(call_.request.name ?? '').trim();
      if (!diagramId || !name || name.length > 200) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_direction_name'));
        return;
      }

      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams
           WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.task.create');
        const next = await db.query(
          `SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next
           FROM plan.directions WHERE diagram_id = $1`,
          [diagramId],
        );
        const sortOrder = next.rows[0].next;
        const result = await db.query(
          `INSERT INTO plan.directions
             (diagram_id, wbs_code, sort_order, name, description, result, priority,
              start_date, end_date, jira_number, bp_flag, sp_flag, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING *`,
          [
            diagramId,
            String(sortOrder),
            sortOrder,
            name,
            String(call_.request.description ?? ''),
            String(call_.request.result ?? ''),
            fromPriority(call_.request.priority),
            dateString(call_.request.start_date),
            dateString(call_.request.end_date),
            String(call_.request.jira_number ?? '') || null,
            Boolean(call_.request.bp_flag),
            Boolean(call_.request.sp_flag),
            actorUserId(call_),
          ],
        );
        callback(null, { direction: toDirection(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateDirection(call_, callback) {
      const directionId = String(call_.request.direction_id ?? '');
      const expectedVersion = Number(call_.request.expected_version ?? 0);
      try {
        const current = await db.query(
          `SELECT * FROM plan.directions WHERE id = $1 AND deleted_at IS NULL`,
          [directionId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'direction_not_found'));
          return;
        }
        if (expectedVersion > 0 && expectedVersion !== current.rows[0].version) {
          callback(versionConflict());
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          current.rows[0].diagram_id,
        ]);
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.task.edit');

        const values = [directionId];
        const sets = [];
        const add = (column, value) => {
          values.push(value);
          sets.push(`${column} = $${values.length}`);
        };
        if (hasField(call_.request, 'name')) {
          const name = String(call_.request.name).trim();
          if (!name || name.length > 200) {
            callback(grpcError(status.INVALID_ARGUMENT, 'invalid_direction_name'));
            return;
          }
          add('name', name);
        }
        if (hasField(call_.request, 'description')) {
          add('description', String(call_.request.description));
        }
        if (hasField(call_.request, 'result')) {
          add('result', String(call_.request.result));
        }
        if (hasField(call_.request, 'priority')) {
          add('priority', fromPriority(call_.request.priority));
        }
        if (hasField(call_.request, 'start_date')) {
          add('start_date', dateString(call_.request.start_date));
        }
        if (hasField(call_.request, 'end_date')) {
          add('end_date', dateString(call_.request.end_date));
        }
        if (hasField(call_.request, 'jira_number')) {
          add('jira_number', String(call_.request.jira_number).trim() || null);
        }
        if (hasField(call_.request, 'bp_flag')) {
          add('bp_flag', Boolean(call_.request.bp_flag));
        }
        if (hasField(call_.request, 'sp_flag')) {
          add('sp_flag', Boolean(call_.request.sp_flag));
        }
        if (sets.length === 0) {
          const assignments = await loadAssignments(db, userClient, 'direction', directionId);
          callback(null, { direction: toDirection(current.rows[0], assignments), revision: '0' });
          return;
        }
        values.push(actorUserId(call_));
        sets.push(`updated_by_user_id = $${values.length}`);
        sets.push('version = version + 1', 'updated_at = now()');
        const result = await db.query(
          `UPDATE plan.directions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
          values,
        );
        const assignments = await loadAssignments(db, userClient, 'direction', directionId);
        callback(null, {
          direction: toDirection(result.rows[0], assignments),
          revision: '0',
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async DeleteDirection(call_, callback) {
      const directionId = String(call_.request.direction_id ?? '');
      const expectedVersion = Number(call_.request.expected_version ?? 0);
      let client;
      try {
        const current = await db.query(
          `SELECT * FROM plan.directions WHERE id = $1 AND deleted_at IS NULL`,
          [directionId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'direction_not_found'));
          return;
        }
        if (expectedVersion > 0 && expectedVersion !== current.rows[0].version) {
          callback(versionConflict());
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          current.rows[0].diagram_id,
        ]);
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.task.delete');

        client = await db.connect();
        await client.query('BEGIN');
        const tasks = await client.query(
          `SELECT id FROM plan.tasks WHERE direction_id = $1 AND deleted_at IS NULL`,
          [directionId],
        );
        const taskIds = tasks.rows.map((row) => row.id);
        await client.query(
          `UPDATE plan.tasks
           SET deleted_at = now(), updated_at = now(), updated_by_user_id = $2
           WHERE direction_id = $1`,
          [directionId, actorUserId(call_)],
        );
        await client.query(
          `UPDATE plan.directions
           SET deleted_at = now(), updated_at = now(), updated_by_user_id = $2
           WHERE id = $1`,
          [directionId, actorUserId(call_)],
        );
        await client.query(
          `DELETE FROM plan.dependencies
           WHERE (predecessor_type = 'direction' AND predecessor_id = $1)
              OR (successor_type = 'direction' AND successor_id = $1)
              OR (predecessor_type = 'task' AND predecessor_id = ANY($2::uuid[]))
              OR (successor_type = 'task' AND successor_id = ANY($2::uuid[]))`,
          [directionId, taskIds],
        );
        await client.query(
          `DELETE FROM plan.assignments
           WHERE (entity_type = 'direction' AND entity_id = $1)
              OR (entity_type = 'task' AND entity_id = ANY($2::uuid[]))`,
          [directionId, taskIds],
        );
        await client.query('COMMIT');
        callback(null, { deleted: true, revision: '0' });
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        callback(mapDbError(error));
      } finally {
        if (client) client.release();
      }
    },

    async ReorderDirections(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const directionIds = call_.request.direction_ids ?? [];
      let client;
      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.task.edit');
        const current = await db.query(
          `SELECT id FROM plan.directions
           WHERE diagram_id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        const currentIds = new Set(current.rows.map((row) => row.id));
        if (
          directionIds.length !== currentIds.size ||
          new Set(directionIds).size !== directionIds.length ||
          directionIds.some((id) => !currentIds.has(id))
        ) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_direction_order'));
          return;
        }

        client = await db.connect();
        await client.query('BEGIN');
        await client.query(
          `UPDATE plan.directions
           SET wbs_code = '~' || substr(replace(id::text, '-', ''), 1, 28)
           WHERE diagram_id = $1`,
          [diagramId],
        );
        for (const [index, directionId] of directionIds.entries()) {
          const sortOrder = index + 1;
          await client.query(
            `UPDATE plan.directions
             SET sort_order = $2, wbs_code = $3, updated_at = now(), updated_by_user_id = $4
             WHERE id = $1`,
            [directionId, sortOrder, String(sortOrder), actorUserId(call_)],
          );
          await client.query(
            `UPDATE plan.tasks
             SET wbs_code = $2 || substr(wbs_code, strpos(wbs_code, '.'))
             WHERE direction_id = $1
               AND deleted_at IS NULL
               AND strpos(wbs_code, '.') > 0`,
            [directionId, String(sortOrder)],
          );
        }
        await client.query('COMMIT');
        const result = await db.query(
          `SELECT * FROM plan.directions
           WHERE diagram_id = $1 AND deleted_at IS NULL
           ORDER BY sort_order ASC`,
          [diagramId],
        );
        const assignmentRows = await db.query(
          `SELECT * FROM plan.assignments
           WHERE entity_type = 'direction'
             AND entity_id = ANY($1::uuid[])
           ORDER BY role, created_at ASC`,
          [result.rows.map((direction) => direction.id)],
        );
        const resolvedAssignments = await resolveAssignments(assignmentRows.rows, userClient);
        const assignmentsByDirection = new Map();
        assignmentRows.rows.forEach((assignment, index) => {
          if (!assignmentsByDirection.has(assignment.entity_id)) {
            assignmentsByDirection.set(assignment.entity_id, []);
          }
          assignmentsByDirection.get(assignment.entity_id).push(resolvedAssignments[index]);
        });
        callback(null, {
          items: result.rows.map((direction) =>
            toDirection(direction, assignmentsByDirection.get(direction.id) ?? []),
          ),
          revision: '0',
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        callback(mapDbError(error));
      } finally {
        if (client) client.release();
      }
    },

    async SetDirectionResponsible(call_, callback) {
      const directionId = String(call_.request.direction_id ?? '');
      const item = call_.request.assignment ?? {};
      const role = fromAssignmentRole(item.role);
      const assigneeType = fromAssigneeType(item.assignee_type);
      const assigneeId = String(item.assignee_id ?? '');
      if (role !== 'responsible' || assigneeType !== 'user' || !isUuid(assigneeId)) {
        callback(grpcError(status.INVALID_ARGUMENT, 'direction_responsible_user_required'));
        return;
      }
      let client;
      try {
        const current = await db.query(
          `SELECT * FROM plan.directions WHERE id = $1 AND deleted_at IS NULL`,
          [directionId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'direction_not_found'));
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          current.rows[0].diagram_id,
        ]);
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.task.edit');
        const activeMembers = await call(userClient, 'GetActiveProjectMemberIds', {
          project_id: diagram.rows[0].project_id,
          user_ids: [assigneeId],
        });
        if (!(activeMembers.user_ids ?? []).includes(assigneeId)) {
          callback(grpcError(status.PERMISSION_DENIED, 'assignee_not_active_project_member'));
          return;
        }
        client = await db.connect();
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM plan.assignments
           WHERE entity_type = 'direction' AND entity_id = $1 AND role = 'responsible'`,
          [directionId],
        );
        await client.query(
          `INSERT INTO plan.assignments
             (entity_type, entity_id, role, assignee_type, assignee_id, created_by_user_id)
           VALUES ('direction', $1, 'responsible', $2, $3, $4)`,
          [directionId, assigneeType, assigneeId, actorUserId(call_)],
        );
        await client.query(
          `UPDATE plan.directions
           SET version = version + 1, updated_at = now(), updated_by_user_id = $2
           WHERE id = $1`,
          [directionId, actorUserId(call_)],
        );
        await client.query('COMMIT');
        const updated = await db.query(`SELECT * FROM plan.directions WHERE id = $1`, [
          directionId,
        ]);
        const assignments = await loadAssignments(db, userClient, 'direction', directionId);
        callback(null, {
          direction: toDirection(updated.rows[0], assignments),
          revision: '0',
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        callback(mapDbError(error));
      } finally {
        if (client) client.release();
      }
    },

    async CreateTask(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const directionId = String(call_.request.direction_id ?? '');
      const name = String(call_.request.name ?? '').trim();
      if (!diagramId || !directionId || !name || name.length > 200) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_task_name'));
        return;
      }

      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams
           WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        const direction = await db.query(
          `SELECT * FROM plan.directions
           WHERE id = $1 AND diagram_id = $2 AND deleted_at IS NULL`,
          [directionId, diagramId],
        );
        if (direction.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'direction_not_found'));
          return;
        }
        const actorRole = await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.task.create',
        );
        const estimatedHours = Number(call_.request.estimated_hours ?? 0);
        if (!Number.isFinite(estimatedHours) || estimatedHours < 0) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_estimated_hours'));
          return;
        }
        const startDate = dateString(call_.request.start_date);
        let endDate = dateString(call_.request.end_date);
        if (estimatedHours > 0) {
          if (!startDate) {
            callback(grpcError(status.INVALID_ARGUMENT, 'start_date_required_for_hours'));
            return;
          }
          const holidays = await loadHolidayDates(db, diagramId);
          endDate = calculateAutoEndDate(
            startDate,
            estimatedHours,
            diagram.rows[0].day_mode,
            holidays,
          );
        }
        const parentTaskId = String(call_.request.parent_task_id ?? '') || null;
        let parentTask = null;
        if (parentTaskId) {
          const parent = await db.query(
            `SELECT * FROM plan.tasks
             WHERE id = $1 AND diagram_id = $2 AND direction_id = $3
               AND level = 2 AND deleted_at IS NULL`,
            [parentTaskId, diagramId, directionId],
          );
          if (parent.rowCount === 0) {
            callback(grpcError(status.INVALID_ARGUMENT, 'invalid_parent_task'));
            return;
          }
          parentTask = parent.rows[0];
        }
        const next = parentTaskId
          ? await db.query(
              `SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next
               FROM plan.tasks WHERE parent_task_id = $1 AND deleted_at IS NULL`,
              [parentTaskId],
            )
          : await db.query(
              `SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next
               FROM plan.tasks
               WHERE direction_id = $1 AND parent_task_id IS NULL AND deleted_at IS NULL`,
              [directionId],
            );
        const sortOrder = next.rows[0].next;
        const wbsBase = parentTask ? parentTask.wbs_code : direction.rows[0].wbs_code;
        const result = await db.query(
          `INSERT INTO plan.tasks
             (diagram_id, direction_id, parent_task_id, level, wbs_code, sort_order,
              name, description, result, priority, start_date, end_date, jira_number,
              bp_flag, sp_flag, created_by_user_id, estimated_hours)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           RETURNING *`,
          [
            diagramId,
            directionId,
            parentTaskId,
            parentTaskId ? 3 : 2,
            `${wbsBase}.${sortOrder}`,
            sortOrder,
            name,
            String(call_.request.description ?? ''),
            String(call_.request.result ?? ''),
            fromPriority(call_.request.priority),
            startDate,
            endDate,
            String(call_.request.jira_number ?? '') || null,
            Boolean(call_.request.bp_flag),
            Boolean(call_.request.sp_flag),
            actorUserId(call_),
            estimatedHours > 0 ? estimatedHours : null,
          ],
        );
        const task = result.rows[0];
        await queueEvent(db, {
          aggregateType: 'task',
          aggregateId: task.id,
          eventType: 'task.created',
          actorUserId: actorUserId(call_),
          actorRoles: actorRolesFromPermissionRole(actorRole),
          projectId: diagram.rows[0].project_id,
          diagramId,
          entityType: 'task',
          entityId: task.id,
          payload: { task: toTask(task) },
        });
        callback(null, { task: toTask(task) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetDiagramSnapshot(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams
           WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        const row = diagram.rows[0];
        await checkPermission(call_, userClient, row.project_id, 'project.view');
        const directions = await db.query(
          `SELECT * FROM plan.directions
           WHERE diagram_id = $1 AND deleted_at IS NULL
           ORDER BY sort_order ASC`,
          [diagramId],
        );
        const tasks = await db.query(
          `SELECT t.*
           FROM plan.tasks t
           JOIN plan.directions d ON d.id = t.direction_id
           WHERE t.diagram_id = $1 AND t.deleted_at IS NULL AND d.deleted_at IS NULL
           ORDER BY d.sort_order ASC, t.level ASC, t.parent_task_id NULLS FIRST,
                    t.sort_order ASC, t.created_at ASC`,
          [diagramId],
        );
        const dependencies = await db.query(
          `SELECT * FROM plan.dependencies
           WHERE diagram_id = $1
           ORDER BY created_at ASC`,
          [diagramId],
        );
        const comments = await db.query(
          `SELECT c.*
           FROM plan.comments c
           WHERE c.deleted_at IS NULL
             AND (
               (c.entity_type = 'task' AND EXISTS (
                 SELECT 1 FROM plan.tasks t
                 WHERE t.id = c.entity_id AND t.diagram_id = $1 AND t.deleted_at IS NULL
               ))
               OR
               (c.entity_type = 'direction' AND EXISTS (
                 SELECT 1 FROM plan.directions d
                 WHERE d.id = c.entity_id AND d.diagram_id = $1 AND d.deleted_at IS NULL
               ))
             )
           ORDER BY c.created_at ASC`,
          [diagramId],
        );
        const holidays = await db.query(
          `SELECT * FROM plan.diagram_holidays
           WHERE diagram_id = $1
           ORDER BY holiday_date ASC`,
          [diagramId],
        );
        const commentCounts = await db.query(
          `SELECT c.entity_id, count(*)::int AS total
           FROM plan.comments c
           JOIN plan.tasks t ON t.id = c.entity_id
           WHERE c.entity_type = 'task'
             AND c.deleted_at IS NULL
             AND t.diagram_id = $1
             AND t.deleted_at IS NULL
           GROUP BY c.entity_id`,
          [diagramId],
        );
        const counts = new Map(commentCounts.rows.map((item) => [item.entity_id, item.total]));
        const assignmentRows = await db.query(
          `SELECT a.*
           FROM plan.assignments a
           WHERE (a.entity_type = 'task' AND EXISTS (
             SELECT 1 FROM plan.tasks t
             WHERE t.id = a.entity_id AND t.diagram_id = $1 AND t.deleted_at IS NULL
           ))
           OR (a.entity_type = 'direction' AND EXISTS (
             SELECT 1 FROM plan.directions d
             WHERE d.id = a.entity_id AND d.diagram_id = $1 AND d.deleted_at IS NULL
           ))
           ORDER BY a.role, a.created_at ASC`,
          [diagramId],
        );
        const resolvedAssignments = await resolveAssignments(assignmentRows.rows, userClient);
        const assignmentsByEntity = new Map();
        assignmentRows.rows.forEach((assignment, index) => {
          const key = `${assignment.entity_type}:${assignment.entity_id}`;
          if (!assignmentsByEntity.has(key)) assignmentsByEntity.set(key, []);
          assignmentsByEntity.get(key).push(resolvedAssignments[index]);
        });
        callback(null, {
          snapshot: {
            diagram: toDiagram(row),
            directions: directions.rows.map((direction) =>
              toDirection(direction, assignmentsByEntity.get(`direction:${direction.id}`) ?? []),
            ),
            tasks: tasks.rows.map((task) => ({
              ...toTask(task, assignmentsByEntity.get(`task:${task.id}`) ?? []),
              comments_count: counts.get(task.id) ?? 0,
            })),
            dependencies: dependencies.rows.map(toDependency),
            comments: comments.rows.map(toComment),
            holidays: holidays.rows.map(toHoliday),
            current_revision: String(row.current_revision ?? 0),
            names_resolved: false,
          },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ListComments(call_, callback) {
      const entityType = String(call_.request.entity_type ?? '');
      const entityId = String(call_.request.entity_id ?? '');
      const limit = Math.min(Math.max(Number(call_.request.page?.limit ?? 50), 1), 200);
      const offset = Math.max(Number(call_.request.page?.offset ?? 0), 0);
      try {
        const entity = await resolveCommentEntity(db, entityType, entityId);
        if (!entity) {
          callback(grpcError(status.NOT_FOUND, 'comment_entity_not_found'));
          return;
        }
        await checkPermission(call_, userClient, entity.project_id, 'project.view');
        const result = await db.query(
          `SELECT * FROM plan.comments
           WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL
           ORDER BY created_at ASC
           LIMIT $3 OFFSET $4`,
          [entityType, entityId, limit, offset],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total
           FROM plan.comments
           WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL`,
          [entityType, entityId],
        );
        callback(null, {
          items: result.rows.map(toComment),
          page: { total: count.rows[0].total, limit, offset },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CreateComment(call_, callback) {
      const entityType = String(call_.request.entity_type ?? '');
      const entityId = String(call_.request.entity_id ?? '');
      const body = String(call_.request.body ?? '').trim();
      const mentionedUserIds = call_.request.mentioned_user_ids ?? [];
      if (!body || body.length > 5000 || mentionedUserIds.some((id) => !isUuid(id))) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_comment'));
        return;
      }
      try {
        const entity = await resolveCommentEntity(db, entityType, entityId);
        if (!entity) {
          callback(grpcError(status.NOT_FOUND, 'comment_entity_not_found'));
          return;
        }
        const actorRole = await checkPermission(
          call_,
          userClient,
          entity.project_id,
          'project.comment.create',
        );
        const result = await db.query(
          `INSERT INTO plan.comments
             (entity_type, entity_id, author_user_id, mentioned_user_ids, body)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [entityType, entityId, actorUserId(call_), mentionedUserIds, body],
        );
        const comment = toComment(result.rows[0]);
        await queueEvent(db, {
          aggregateType: 'comment',
          aggregateId: comment.id,
          eventType: 'comment.created',
          actorUserId: actorUserId(call_),
          actorRoles: actorRolesFromPermissionRole(actorRole),
          projectId: entity.project_id,
          diagramId: entity.diagram_id,
          entityType,
          entityId,
          payload: {
            commentId: comment.id,
            entityType,
            entityId,
            projectId: entity.project_id,
            diagramId: entity.diagram_id,
            authorUserId: comment.author_user_id,
            mentionedUserIds: comment.mentioned_user_ids,
            bodyPreview: comment.body.slice(0, 200),
          },
        });
        callback(null, { comment });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateComment(call_, callback) {
      const commentId = String(call_.request.comment_id ?? '');
      const body = String(call_.request.body ?? '').trim();
      const mentionedUserIds = call_.request.mentioned_user_ids ?? [];
      if (!body || body.length > 5000 || mentionedUserIds.some((id) => !isUuid(id))) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_comment'));
        return;
      }
      try {
        const comment = await db.query(
          `SELECT * FROM plan.comments WHERE id = $1 AND deleted_at IS NULL`,
          [commentId],
        );
        if (comment.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'comment_not_found'));
          return;
        }
        const entity = await resolveCommentEntity(
          db,
          comment.rows[0].entity_type,
          comment.rows[0].entity_id,
        );
        if (!entity) {
          callback(grpcError(status.NOT_FOUND, 'comment_entity_not_found'));
          return;
        }
        await checkPermission(call_, userClient, entity.project_id, 'project.comment.create');
        if (comment.rows[0].author_user_id !== actorUserId(call_)) {
          await checkPermission(call_, userClient, entity.project_id, 'project.comment.moderate');
        }
        const result = await db.query(
          `UPDATE plan.comments
           SET body = $2, mentioned_user_ids = $3, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [commentId, body, mentionedUserIds],
        );
        callback(null, { comment: toComment(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async DeleteComment(call_, callback) {
      const commentId = String(call_.request.comment_id ?? '');
      try {
        const comment = await db.query(
          `SELECT * FROM plan.comments WHERE id = $1 AND deleted_at IS NULL`,
          [commentId],
        );
        if (comment.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'comment_not_found'));
          return;
        }
        const entity = await resolveCommentEntity(
          db,
          comment.rows[0].entity_type,
          comment.rows[0].entity_id,
        );
        if (!entity) {
          callback(grpcError(status.NOT_FOUND, 'comment_entity_not_found'));
          return;
        }
        await checkPermission(call_, userClient, entity.project_id, 'project.comment.create');
        if (comment.rows[0].author_user_id !== actorUserId(call_)) {
          await checkPermission(call_, userClient, entity.project_id, 'project.comment.moderate');
        }
        await db.query(
          `UPDATE plan.comments SET deleted_at = now(), updated_at = now() WHERE id = $1`,
          [commentId],
        );
        callback(null, { deleted: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetHolidays(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.view');
        const result = await db.query(
          `SELECT * FROM plan.diagram_holidays
           WHERE diagram_id = $1
           ORDER BY holiday_date ASC`,
          [diagramId],
        );
        callback(null, { items: result.rows.map(toHoliday) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateHolidays(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const items = [];
      const dates = new Set();
      for (const item of call_.request.items ?? []) {
        const holidayDate = dateString(item.holiday_date);
        const name = String(item.name ?? '').trim();
        if (!holidayDate || dates.has(holidayDate) || name.length > 200) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_holiday'));
          return;
        }
        dates.add(holidayDate);
        items.push({ holidayDate, name });
      }

      let client;
      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'diagram.update');
        client = await db.connect();
        await client.query('BEGIN');
        await client.query('DELETE FROM plan.diagram_holidays WHERE diagram_id = $1', [diagramId]);
        const saved = [];
        for (const item of items) {
          const result = await client.query(
            `INSERT INTO plan.diagram_holidays (diagram_id, holiday_date, name)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [diagramId, item.holidayDate, item.name || null],
          );
          saved.push(result.rows[0]);
        }
        await client.query('COMMIT');
        await recalculateAutoTaskEnds(db, diagramId);
        callback(null, { items: saved.map(toHoliday), revision: '0' });
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        callback(mapDbError(error));
      } finally {
        if (client) client.release();
      }
    },

    async StartImport(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const format = call_.request.format === 'IMPORT_FORMAT_CSV' ? 'csv' : 'json';
      const preview = Boolean(call_.request.preview);
      const data = Buffer.from(call_.request.data ?? []);
      const fileName = String(call_.request.file_name ?? '');
      if (!diagramId || data.length === 0 || data.length > 50 * 1024 * 1024) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_import_file'));
        return;
      }
      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.import');
        const actor = actorUserId(call_);
        const projectId = diagram.rows[0].project_id;
        const executorMap = new Map();
        const executorUserMap = new Map();
        const activeProjectMemberIds = new Set();
        const memberNameCandidates = new Map();
        let memberOffset = 0;
        let memberTotal = Infinity;
        while (memberOffset < memberTotal) {
          const response = await call(userClient, 'ListProjectMembers', {
            project_id: projectId,
            page: { limit: 200, offset: memberOffset },
          });
          const items = response.items ?? [];
          for (const member of items) {
            if (
              member.status !== 'active' ||
              member.user?.status === 'USER_STATUS_BLOCKED' ||
              !member.user_id
            ) {
              continue;
            }
            activeProjectMemberIds.add(member.user_id);
            const displayName = String(member.user?.display_name ?? '')
              .trim()
              .toLowerCase();
            if (displayName) {
              const candidates = memberNameCandidates.get(displayName) ?? new Set();
              candidates.add(member.user_id);
              memberNameCandidates.set(displayName, candidates);
            }
          }
          memberTotal = Number(response.page?.total ?? activeProjectMemberIds.size);
          memberOffset += items.length;
          if (!items.length) break;
        }
        for (const [displayName, candidates] of memberNameCandidates) {
          if (candidates.size === 1) executorMap.set(displayName, [...candidates][0]);
        }
        let executorOffset = 0;
        let executorTotal = Infinity;
        while (executorOffset < executorTotal) {
          const response = await call(userClient, 'ListExecutors', {
            project_id: projectId,
            include_inactive: true,
            page: { limit: 200, offset: executorOffset },
          });
          const items = response.items ?? [];
          for (const executor of items) {
            const linkedUserId = String(executor.linked_user_id ?? '');
            if (!linkedUserId || !activeProjectMemberIds.has(linkedUserId)) continue;
            executorUserMap.set(executor.id, linkedUserId);
            executorMap.set(`id:${executor.id}`, linkedUserId);
            const fullName = String(executor.full_name ?? '')
              .trim()
              .toLowerCase();
            if (fullName) executorMap.set(fullName, linkedUserId);
          }
          executorTotal = Number(response.page?.total ?? items.length);
          executorOffset += items.length;
          if (!items.length) break;
        }
        const created = await db.query(
          `INSERT INTO jobs.import_jobs
             (project_id, diagram_id, initiator_user_id, format, status, file_name,
              size_bytes, payload, expires_at)
           VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, now() + interval '7 days')
           RETURNING *`,
          [
            diagram.rows[0].project_id,
            diagramId,
            actor,
            format,
            fileName || null,
            data.length,
            data,
          ],
        );
        let job = created.rows[0];
        try {
          const started = await db.query(
            `UPDATE jobs.import_jobs
             SET status = 'processing', started_at = now()
             WHERE id = $1
             RETURNING *`,
            [job.id],
          );
          job = started.rows[0];
          const report = await processDiagramImport(db, {
            diagramId,
            format,
            data,
            actorId: actor,
            executorMap,
            executorUserMap,
            activeProjectMemberIds,
            dryRun: preview,
          });
          const finished = await db.query(
            `UPDATE jobs.import_jobs
             SET status = $2, report = $3, finished_at = now()
             WHERE id = $1
             RETURNING *`,
            [job.id, preview ? 'cancelled' : 'completed', report],
          );
          job = finished.rows[0];
        } catch (error) {
          const failed = await db.query(
            `UPDATE jobs.import_jobs
             SET status = 'failed', error_code = $2, error_message = $3, finished_at = now()
             WHERE id = $1
             RETURNING *`,
            [job.id, 'import_failed', String(error.message ?? 'import_failed').slice(0, 1000)],
          );
          job = failed.rows[0];
        }
        callback(null, { job: toImportJob(job) });
      } catch (error) {
        if (error.code === '23505') {
          callback(grpcError(status.ALREADY_EXISTS, 'import_in_progress'));
          return;
        }
        callback(mapDbError(error));
      }
    },

    async GetImportStatus(call_, callback) {
      const jobId = String(call_.request.job_id ?? '');
      try {
        const job = await db.query('SELECT * FROM jobs.import_jobs WHERE id = $1', [jobId]);
        if (job.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'import_job_not_found'));
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          job.rows[0].diagram_id,
        ]);
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.import');
        callback(null, { job: toImportJob(job.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CancelImport(call_, callback) {
      const jobId = String(call_.request.job_id ?? '');
      try {
        const job = await db.query('SELECT * FROM jobs.import_jobs WHERE id = $1', [jobId]);
        if (job.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'import_job_not_found'));
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          job.rows[0].diagram_id,
        ]);
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.import');
        const result = await db.query(
          `UPDATE jobs.import_jobs
           SET status = 'cancelled', finished_at = COALESCE(finished_at, now())
           WHERE id = $1 AND status IN ('queued', 'processing')
           RETURNING *`,
          [jobId],
        );
        callback(null, { job: toImportJob(result.rows[0] ?? job.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ExportDiagram(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const csv = call_.request.format === 'EXPORT_FORMAT_CSV';
      try {
        const diagramResult = await db.query(
          `SELECT d.*, p.name AS project_name, p.description AS project_description,
                  p.settings AS project_settings
           FROM project.diagrams d
           JOIN project.projects p ON p.id = d.project_id
           WHERE d.id = $1 AND d.deleted_at IS NULL`,
          [diagramId],
        );
        if (diagramResult.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        const diagram = diagramResult.rows[0];
        await checkPermission(call_, userClient, diagram.project_id, 'project.view');

        const [directions, tasks, dependencies, comments, holidays, assignmentRows] =
          await Promise.all([
            db.query(
              `SELECT * FROM plan.directions
               WHERE diagram_id = $1 AND deleted_at IS NULL
               ORDER BY sort_order ASC`,
              [diagramId],
            ),
            db.query(
              `SELECT * FROM plan.tasks
               WHERE diagram_id = $1 AND deleted_at IS NULL
               ORDER BY sort_order ASC`,
              [diagramId],
            ),
            db.query(
              `SELECT * FROM plan.dependencies
               WHERE diagram_id = $1
               ORDER BY created_at ASC`,
              [diagramId],
            ),
            db.query(
              `SELECT * FROM plan.comments
               WHERE deleted_at IS NULL
                 AND (entity_type = 'task' OR entity_type = 'direction')
                 AND (
                   (entity_type = 'task' AND entity_id IN (
                     SELECT id FROM plan.tasks WHERE diagram_id = $1 AND deleted_at IS NULL
                   ))
                   OR
                   (entity_type = 'direction' AND entity_id IN (
                     SELECT id FROM plan.directions WHERE diagram_id = $1 AND deleted_at IS NULL
                   ))
                 )
               ORDER BY created_at ASC`,
              [diagramId],
            ),
            db.query(
              `SELECT * FROM plan.diagram_holidays
               WHERE diagram_id = $1
               ORDER BY holiday_date ASC`,
              [diagramId],
            ),
            db.query(
              `SELECT * FROM plan.assignments
               WHERE (entity_type = 'task' AND entity_id IN (
                 SELECT id FROM plan.tasks WHERE diagram_id = $1 AND deleted_at IS NULL
               ))
               OR (entity_type = 'direction' AND entity_id IN (
                 SELECT id FROM plan.directions WHERE diagram_id = $1 AND deleted_at IS NULL
               ))
               ORDER BY created_at ASC`,
              [diagramId],
            ),
          ]);

        const assignmentsByEntity = new Map();
        for (const assignment of assignmentRows.rows) {
          const key = `${assignment.entity_type}:${assignment.entity_id}`;
          if (!assignmentsByEntity.has(key)) assignmentsByEntity.set(key, []);
          assignmentsByEntity.get(key).push({
            role: assignment.role,
            assigneeType: assignment.assignee_type,
            assigneeId: assignment.assignee_id,
          });
        }
        const wbsById = new Map();
        for (const direction of directions.rows) {
          wbsById.set(`direction:${direction.id}`, direction.wbs_code);
        }
        for (const task of tasks.rows) {
          wbsById.set(`task:${task.id}`, task.wbs_code);
        }

        const directionItems = directions.rows.map((direction) => ({
          id: direction.id,
          wbsCode: direction.wbs_code,
          sortOrder: direction.sort_order,
          name: direction.name,
          description: direction.description ?? '',
          result: direction.result ?? '',
          priority: direction.priority,
          startDate: dateOnly(direction.start_date) ?? undefined,
          endDate: dateOnly(direction.end_date) ?? undefined,
          jiraNumber: direction.jira_number ?? undefined,
          bpFlag: direction.bp_flag,
          spFlag: direction.sp_flag,
          assignments: assignmentsByEntity.get(`direction:${direction.id}`) ?? [],
        }));
        const taskItems = tasks.rows.map((task) => ({
          id: task.id,
          directionId: task.direction_id,
          parentTaskId: task.parent_task_id ?? null,
          level: task.level,
          wbsCode: task.wbs_code,
          sortOrder: task.sort_order,
          name: task.name,
          description: task.description ?? '',
          result: task.result ?? '',
          status: task.status,
          progress: task.progress,
          priority: task.priority,
          startDate: dateOnly(task.start_date) ?? undefined,
          endDate: dateOnly(task.end_date) ?? undefined,
          actualEndDate: dateOnly(task.actual_end_date) ?? undefined,
          jiraNumber: task.jira_number ?? undefined,
          bpFlag: task.bp_flag,
          spFlag: task.sp_flag,
          assignments: (() => {
            const existing = assignmentsByEntity.get(`task:${task.id}`) ?? [];
            const assignments = existing.filter((item) => item.role !== 'responsible');
            const legacyResponsible = existing.find((item) => item.role === 'responsible');
            if (legacyResponsible && !assignments.some((item) => item.role === 'executor')) {
              assignments.push({ ...legacyResponsible, role: 'executor' });
            }
            return assignments;
          })(),
        }));
        const dependencyItems = dependencies.rows.map((dependency) => ({
          id: dependency.id,
          predecessorType: dependency.predecessor_type,
          predecessorId: dependency.predecessor_id,
          predecessorWbs:
            wbsById.get(`${dependency.predecessor_type}:${dependency.predecessor_id}`) ?? undefined,
          successorType: dependency.successor_type,
          successorId: dependency.successor_id,
          successorWbs:
            wbsById.get(`${dependency.successor_type}:${dependency.successor_id}`) ?? undefined,
          linkType: dependency.link_type,
          color: dependency.color ?? undefined,
          lineStyle: dependency.line_style,
          arrowShape: dependency.arrow_shape,
        }));
        const commentItems = comments.rows.map((comment) => ({
          id: comment.id,
          entityType: comment.entity_type,
          entityId: comment.entity_id,
          authorUserId: comment.author_user_id ?? null,
          body: comment.body,
          mentionedUserIds: comment.mentioned_user_ids ?? [],
          createdAt: new Date(comment.created_at).toISOString(),
          updatedAt: new Date(comment.updated_at).toISOString(),
        }));
        const holidayItems = holidays.rows.map((holiday) => ({
          date: dateOnly(holiday.holiday_date),
          name: holiday.name ?? undefined,
        }));

        let data;
        let contentType;
        let extension;
        if (csv) {
          const parentWbs = new Map(tasks.rows.map((task) => [task.id, task.wbs_code]));
          const directionWbs = new Map(
            directions.rows.map((direction) => [direction.id, direction.wbs_code]),
          );
          const lines = [
            [
              'direction_wbs',
              'direction_name',
              'wbs_code',
              'level',
              'parent_wbs',
              'name',
              'description',
              'result',
              'status',
              'progress',
              'priority',
              'start_date',
              'end_date',
              'actual_end_date',
              'jira_number',
              'bp_flag',
              'sp_flag',
            ],
            ...tasks.rows.map((task) => [
              directionWbs.get(task.direction_id) ?? '',
              directions.rows.find((direction) => direction.id === task.direction_id)?.name ?? '',
              task.wbs_code,
              task.level,
              task.parent_task_id ? (parentWbs.get(task.parent_task_id) ?? '') : '',
              task.name,
              task.description ?? '',
              task.result ?? '',
              task.status,
              task.progress,
              task.priority,
              dateOnly(task.start_date) ?? '',
              dateOnly(task.end_date) ?? '',
              dateOnly(task.actual_end_date) ?? '',
              task.jira_number ?? '',
              task.bp_flag,
              task.sp_flag,
            ]),
          ];
          data = lines.map((line) => line.map(csvCell).join(',')).join('\r\n');
          contentType = 'text/csv; charset=utf-8';
          extension = 'csv';
        } else {
          data = JSON.stringify(
            {
              formatVersion: 2,
              exportedAt: new Date().toISOString(),
              projectId: diagram.project_id,
              diagramId: diagram.id,
              baseRevision: Number(diagram.current_revision ?? 0),
              project: {
                id: diagram.project_id,
                name: diagram.project_name,
                description: diagram.project_description ?? '',
                settings: diagram.project_settings ?? {},
              },
              diagram: {
                id: diagram.id,
                name: diagram.name,
                description: diagram.description ?? '',
                dayMode: diagram.day_mode,
                currentRevision: Number(diagram.current_revision ?? 0),
              },
              workdays: {
                mode: diagram.day_mode,
                holidays: holidayItems,
              },
              executors: [],
              directions: directionItems,
              tasks: taskItems,
              dependencies: dependencyItems,
              comments: commentItems,
            },
            null,
            2,
          );
          contentType = 'application/json; charset=utf-8';
          extension = 'json';
        }
        const baseName = String(diagram.name)
          .replace(/[^\p{L}\p{N}._-]+/gu, '-')
          .replace(/^-+|-+$/g, '');
        callback(null, {
          data: Buffer.from(data, 'utf8'),
          content_type: contentType,
          file_name: `${baseName || diagram.id}.${extension}`,
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetTask(call_, callback) {
      const taskId = String(call_.request.task_id ?? '');
      try {
        const task = await db.query(
          `SELECT * FROM plan.tasks WHERE id = $1 AND deleted_at IS NULL`,
          [taskId],
        );
        if (task.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'task_not_found'));
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          task.rows[0].diagram_id,
        ]);
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.view');
        const assignments = await loadAssignments(db, userClient, 'task', taskId);
        callback(null, { task: toTask(task.rows[0], assignments) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateTask(call_, callback) {
      const taskId = String(call_.request.task_id ?? '');
      const expectedVersion = Number(call_.request.expected_version ?? 0);
      try {
        const task = await db.query(
          `SELECT * FROM plan.tasks WHERE id = $1 AND deleted_at IS NULL`,
          [taskId],
        );
        if (task.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'task_not_found'));
          return;
        }
        if (expectedVersion > 0 && expectedVersion !== task.rows[0].version) {
          callback(versionConflict());
          return;
        }
        const diagram = await db.query(
          `SELECT project_id, day_mode FROM project.diagrams WHERE id = $1`,
          [task.rows[0].diagram_id],
        );
        const actorRole = await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.task.edit',
        );
        const current = task.rows[0];
        const hasStart = hasField(call_.request, 'start_date');
        const hasEnd = hasField(call_.request, 'end_date');
        const hasHours = hasField(call_.request, 'estimated_hours');
        const startDate = hasStart
          ? dateString(call_.request.start_date)
          : dateOnly(current.start_date);
        const estimatedHours = hasHours
          ? Number(call_.request.estimated_hours)
          : Number(current.estimated_hours ?? 0);
        if (!Number.isFinite(estimatedHours) || estimatedHours < 0) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_estimated_hours'));
          return;
        }
        let endDate = hasEnd ? dateString(call_.request.end_date) : dateOnly(current.end_date);
        const recalculateEnd = estimatedHours > 0 && (hasStart || hasEnd || hasHours);
        if (recalculateEnd) {
          if (!startDate) {
            callback(grpcError(status.INVALID_ARGUMENT, 'start_date_required_for_hours'));
            return;
          }
          const holidays = await loadHolidayDates(db, current.diagram_id);
          endDate = calculateAutoEndDate(
            startDate,
            estimatedHours,
            diagram.rows[0].day_mode,
            holidays,
          );
        }

        const values = [taskId];
        const sets = [];
        const add = (column, value) => {
          values.push(value);
          sets.push(`${column} = $${values.length}`);
        };

        if (hasField(call_.request, 'name')) {
          const name = String(call_.request.name).trim();
          if (!name || name.length > 200) {
            callback(grpcError(status.INVALID_ARGUMENT, 'invalid_task_name'));
            return;
          }
          add('name', name);
        }
        if (hasField(call_.request, 'description')) {
          add('description', String(call_.request.description));
        }
        if (hasField(call_.request, 'result')) {
          add('result', String(call_.request.result));
        }
        if (hasField(call_.request, 'priority')) {
          add('priority', fromPriority(call_.request.priority));
        }
        if (hasStart) {
          add('start_date', startDate);
        }
        if (hasHours) {
          add('estimated_hours', estimatedHours > 0 ? estimatedHours : null);
        }
        if (hasEnd && !recalculateEnd) {
          add('end_date', endDate);
        }
        if (recalculateEnd) {
          add('end_date', endDate);
        }
        if (hasField(call_.request, 'actual_end_date')) {
          add('actual_end_date', dateString(call_.request.actual_end_date));
        }
        if (hasField(call_.request, 'jira_number')) {
          add('jira_number', String(call_.request.jira_number).trim() || null);
        }
        if (hasField(call_.request, 'bp_flag')) {
          add('bp_flag', Boolean(call_.request.bp_flag));
        }
        if (hasField(call_.request, 'sp_flag')) {
          add('sp_flag', Boolean(call_.request.sp_flag));
        }

        if (sets.length === 0) {
          callback(null, { task: toTask(task.rows[0]), revision: '0' });
          return;
        }
        values.push(actorUserId(call_));
        sets.push(`updated_by_user_id = $${values.length}`);
        sets.push('version = version + 1', 'updated_at = now()');

        const result = await db.query(
          `UPDATE plan.tasks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
          values,
        );
        const assignments = await loadAssignments(db, userClient, 'task', taskId);
        const updatedTask = toTask(result.rows[0], assignments);
        await queueEvent(db, {
          aggregateType: 'task',
          aggregateId: taskId,
          eventType: 'task.updated',
          actorUserId: actorUserId(call_),
          actorRoles: actorRolesFromPermissionRole(actorRole),
          projectId: diagram.rows[0].project_id,
          diagramId: result.rows[0].diagram_id,
          entityType: 'task',
          entityId: taskId,
          payload: { task: updatedTask, changedFields: [] },
        });
        callback(null, { task: updatedTask, revision: '0' });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async MoveTask(call_, callback) {
      const taskId = String(call_.request.task_id ?? '');
      const expectedVersion = Number(call_.request.expected_version ?? 0);
      let client;
      try {
        const task = await db.query(
          `SELECT * FROM plan.tasks WHERE id = $1 AND deleted_at IS NULL`,
          [taskId],
        );
        if (task.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'task_not_found'));
          return;
        }
        const current = task.rows[0];
        if (expectedVersion > 0 && expectedVersion !== current.version) {
          callback(versionConflict());
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          current.diagram_id,
        ]);
        const actorRole = await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.task.edit',
        );

        let directionId = hasField(call_.request, 'direction_id')
          ? String(call_.request.direction_id)
          : current.direction_id;
        const direction = await db.query(
          `SELECT * FROM plan.directions
           WHERE id = $1 AND diagram_id = $2 AND deleted_at IS NULL`,
          [directionId, current.diagram_id],
        );
        if (direction.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'direction_not_found'));
          return;
        }

        const parentProvided = hasField(call_.request, 'parent_task_id');
        const parentTaskId = parentProvided
          ? String(call_.request.parent_task_id) || null
          : current.parent_task_id;
        if (parentTaskId === taskId) {
          callback(grpcError(status.INVALID_ARGUMENT, 'task_parent_invalid'));
          return;
        }

        let parent = null;
        if (parentTaskId) {
          const parentResult = await db.query(
            `SELECT * FROM plan.tasks
             WHERE id = $1 AND diagram_id = $2 AND deleted_at IS NULL`,
            [parentTaskId, current.diagram_id],
          );
          if (parentResult.rowCount === 0 || parentResult.rows[0].level !== 2) {
            callback(grpcError(status.INVALID_ARGUMENT, 'task_parent_invalid'));
            return;
          }
          parent = parentResult.rows[0];
        }

        if (parent && parent.direction_id !== directionId) {
          directionId = parent.direction_id;
        }
        const allTasksResult = await db.query(
          `SELECT * FROM plan.tasks
           WHERE diagram_id = $1 AND deleted_at IS NULL
           ORDER BY sort_order ASC, created_at ASC`,
          [current.diagram_id],
        );
        const allTasks = allTasksResult.rows;
        const allById = new Map(allTasks.map((row) => [row.id, row]));
        const hasChildren = allTasks.some((row) => row.parent_task_id === taskId);
        if (parentTaskId && hasChildren) {
          callback(grpcError(status.INVALID_ARGUMENT, 'task_has_children'));
          return;
        }
        let ancestor = parent;
        while (ancestor?.parent_task_id) {
          if (ancestor.parent_task_id === taskId) {
            callback(grpcError(status.INVALID_ARGUMENT, 'task_parent_cycle'));
            return;
          }
          ancestor = allById.get(ancestor.parent_task_id);
        }

        const requestedSort = Number(call_.request.sort_order ?? 0);
        const level = parentTaskId ? 3 : 2;
        const oldParentId = current.parent_task_id ?? null;
        const oldDirectionId = current.direction_id;
        const groupOf = (row) => `${row.direction_id}:${row.parent_task_id ?? ''}`;
        const newGroupKey = `${directionId}:${parentTaskId ?? ''}`;
        const oldGroupKey = `${oldDirectionId}:${oldParentId ?? ''}`;
        const newSiblings = allTasks
          .filter((row) => row.id !== taskId && groupOf(row) === newGroupKey)
          .sort((a, b) => a.sort_order - b.sort_order);
        const insertIndex =
          Number.isInteger(requestedSort) && requestedSort > 0
            ? Math.max(0, Math.min(newSiblings.length, requestedSort - 1))
            : newSiblings.length;
        const moved = {
          ...current,
          direction_id: directionId,
          parent_task_id: parentTaskId,
          level,
          sort_order: insertIndex + 1,
        };
        newSiblings.splice(insertIndex, 0, moved);
        const sortById = new Map(newSiblings.map((row, index) => [row.id, index + 1]));
        if (oldGroupKey !== newGroupKey) {
          allTasks
            .filter((row) => row.id !== taskId && groupOf(row) === oldGroupKey)
            .sort((a, b) => a.sort_order - b.sort_order)
            .forEach((row, index) => sortById.set(row.id, index + 1));
        }

        const directionsResult = await db.query(
          `SELECT * FROM plan.directions
           WHERE diagram_id = $1 AND deleted_at IS NULL
           ORDER BY sort_order ASC`,
          [current.diagram_id],
        );
        const directionWbs = new Map(directionsResult.rows.map((row) => [row.id, row.wbs_code]));
        const tasksForWbs = allTasks.map((row) =>
          row.id === taskId
            ? moved
            : { ...row, sort_order: sortById.get(row.id) ?? row.sort_order },
        );
        const rootsByDirection = new Map();
        for (const row of tasksForWbs.filter((item) => !item.parent_task_id)) {
          const list = rootsByDirection.get(row.direction_id) ?? [];
          list.push(row);
          rootsByDirection.set(row.direction_id, list);
        }
        const wbsById = new Map();
        for (const [dirId, roots] of rootsByDirection) {
          const base = directionWbs.get(dirId);
          if (!base) continue;
          roots
            .sort((a, b) => a.sort_order - b.sort_order)
            .forEach((row, index) => {
              row.sort_order = index + 1;
              row.wbs_code = `${base}.${index + 1}`;
              wbsById.set(row.id, row);
            });
        }
        const childrenByParent = new Map();
        for (const row of tasksForWbs.filter((item) => item.parent_task_id)) {
          const list = childrenByParent.get(row.parent_task_id) ?? [];
          list.push(row);
          childrenByParent.set(row.parent_task_id, list);
        }
        for (const [parentId, children] of childrenByParent) {
          const parentRow = wbsById.get(parentId);
          if (!parentRow) continue;
          children
            .sort((a, b) => a.sort_order - b.sort_order)
            .forEach((row, index) => {
              row.sort_order = index + 1;
              row.wbs_code = `${parentRow.wbs_code}.${index + 1}`;
              wbsById.set(row.id, row);
            });
        }

        client = await db.connect();
        await client.query('BEGIN');
        await client.query(
          `UPDATE plan.tasks
           SET wbs_code = '~' || left(replace(id::text, '-', ''), 30)
           WHERE diagram_id = $1`,
          [current.diagram_id],
        );
        for (const row of wbsById.values()) {
          await client.query(
            `UPDATE plan.tasks
             SET direction_id = $2, parent_task_id = $3, level = $4, wbs_code = $5,
                 sort_order = $6, updated_by_user_id = $7,
                 version = version + CASE WHEN id = $8 THEN 1 ELSE 0 END,
                 updated_at = now()
             WHERE id = $1`,
            [
              row.id,
              row.direction_id,
              row.parent_task_id,
              row.level,
              row.wbs_code,
              row.sort_order,
              actorUserId(call_),
              taskId,
            ],
          );
        }
        const updated = await client.query(`SELECT * FROM plan.tasks WHERE id = $1`, [taskId]);
        await client.query('COMMIT');
        const assignments = await loadAssignments(db, userClient, 'task', taskId);
        const movedTask = toTask(updated.rows[0], assignments);
        await queueEvent(db, {
          aggregateType: 'task',
          aggregateId: taskId,
          eventType: 'task.moved',
          actorUserId: actorUserId(call_),
          actorRoles: actorRolesFromPermissionRole(actorRole),
          projectId: diagram.rows[0].project_id,
          diagramId: current.diagram_id,
          entityType: 'task',
          entityId: taskId,
          payload: { task: movedTask },
        });
        callback(null, { task: movedTask, revision: '0' });
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        callback(mapDbError(error));
      } finally {
        if (client) client.release();
      }
    },

    async UpdateTaskProgress(call_, callback) {
      const taskId = String(call_.request.task_id ?? '');
      const expectedVersion = Number(call_.request.expected_version ?? 0);
      try {
        const task = await db.query(
          `SELECT * FROM plan.tasks WHERE id = $1 AND deleted_at IS NULL`,
          [taskId],
        );
        if (task.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'task_not_found'));
          return;
        }
        if (expectedVersion > 0 && expectedVersion !== task.rows[0].version) {
          callback(versionConflict());
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          task.rows[0].diagram_id,
        ]);
        const actorRole = await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.task.edit',
        );
        const requestedProgress = Number(call_.request.progress ?? 0);
        if (!Number.isFinite(requestedProgress)) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_progress'));
          return;
        }
        const progress = Math.min(Math.max(requestedProgress, 0), 100);
        const taskStatus = fromTaskStatus(call_.request.status);
        const result = await db.query(
          `UPDATE plan.tasks
           SET status = $2::text, progress = $3, updated_by_user_id = $4,
               actual_end_date = CASE
                 WHEN $2::text = 'done' THEN COALESCE(actual_end_date, CURRENT_DATE)
                 ELSE NULL
               END,
               version = version + 1, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [taskId, taskStatus, progress, actorUserId(call_)],
        );
        const assignments = await loadAssignments(db, userClient, 'task', taskId);
        await queueEvent(db, {
          aggregateType: 'task',
          aggregateId: taskId,
          eventType: 'task.progress.updated',
          actorUserId: actorUserId(call_),
          actorRoles: actorRolesFromPermissionRole(actorRole),
          projectId: diagram.rows[0].project_id,
          diagramId: task.rows[0].diagram_id,
          entityType: 'task',
          entityId: taskId,
          payload: { task: toTask(result.rows[0], assignments) },
        });
        callback(null, { task: toTask(result.rows[0], assignments), revision: '0' });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async SetTaskAssignments(call_, callback) {
      const taskId = String(call_.request.task_id ?? '');
      const assignments = [];
      const roles = { executor: 0, co_executor: 0 };
      const assignees = new Set();
      for (const item of call_.request.assignments ?? []) {
        const role = fromAssignmentRole(item.role);
        const assigneeType = fromAssigneeType(item.assignee_type);
        const assigneeId = String(item.assignee_id ?? '');
        if (!role || !assigneeType || !isUuid(assigneeId)) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_assignment'));
          return;
        }
        if (!['executor', 'co_executor'].includes(role)) {
          callback(grpcError(status.INVALID_ARGUMENT, 'task_assignment_role_invalid'));
          return;
        }
        roles[role] += 1;
        const key = `${role}:${assigneeType}:${assigneeId}`;
        if (assignees.has(key)) {
          callback(grpcError(status.INVALID_ARGUMENT, 'duplicate_assignment'));
          return;
        }
        assignees.add(key);
        assignments.push({ role, assigneeType, assigneeId });
      }
      if (assignments.length > 3 || roles.executor > 1 || roles.co_executor > 2) {
        callback(grpcError(status.INVALID_ARGUMENT, 'assignment_limit_exceeded'));
        return;
      }

      let client;
      try {
        const task = await db.query(
          `SELECT * FROM plan.tasks WHERE id = $1 AND deleted_at IS NULL`,
          [taskId],
        );
        if (task.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'task_not_found'));
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          task.rows[0].diagram_id,
        ]);
        const actorRole = await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.task.edit',
        );
        const currentAssignments = await db.query(
          `SELECT role, assignee_type, assignee_id
           FROM plan.assignments
           WHERE entity_type = 'task' AND entity_id = $1`,
          [taskId],
        );
        const currentKeys = new Set(
          currentAssignments.rows.map(
            (item) => `${item.role}:${item.assignee_type}:${item.assignee_id}`,
          ),
        );
        const newLegacyAssignments = assignments.filter(
          (item) =>
            item.assigneeType === 'executor' &&
            !currentKeys.has(`${item.role}:executor:${item.assigneeId}`),
        );
        if (newLegacyAssignments.length) {
          callback(grpcError(status.INVALID_ARGUMENT, 'executor_assignment_not_supported'));
          return;
        }
        const newProjectUserIds = assignments
          .filter((item) => item.assigneeType === 'user')
          .map((item) => item.assigneeId);
        if (newProjectUserIds.length) {
          const activeMembers = await call(userClient, 'GetActiveProjectMemberIds', {
            project_id: diagram.rows[0].project_id,
            user_ids: newProjectUserIds,
          });
          const activeIds = new Set(activeMembers.user_ids ?? []);
          if (newProjectUserIds.some((userId) => !activeIds.has(userId))) {
            callback(grpcError(status.PERMISSION_DENIED, 'assignee_not_active_project_member'));
            return;
          }
        }
        client = await db.connect();
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM plan.assignments WHERE entity_type = 'task' AND entity_id = $1`,
          [taskId],
        );
        for (const item of assignments) {
          await client.query(
            `INSERT INTO plan.assignments
               (entity_type, entity_id, role, assignee_type, assignee_id, created_by_user_id)
             VALUES ('task', $1, $2, $3, $4, $5)`,
            [taskId, item.role, item.assigneeType, item.assigneeId, actorUserId(call_)],
          );
        }
        await client.query(
          `UPDATE plan.tasks
           SET version = version + 1, updated_by_user_id = $2, updated_at = now()
           WHERE id = $1`,
          [taskId, actorUserId(call_)],
        );
        await client.query('COMMIT');
        const updated = await db.query(`SELECT * FROM plan.tasks WHERE id = $1`, [taskId]);
        const resolvedAssignments = await loadAssignments(db, userClient, 'task', taskId);
        const updatedTask = toTask(updated.rows[0], resolvedAssignments);
        await queueEvent(db, {
          aggregateType: 'task',
          aggregateId: taskId,
          eventType: 'task.assignments.changed',
          actorUserId: actorUserId(call_),
          actorRoles: actorRolesFromPermissionRole(actorRole),
          projectId: diagram.rows[0].project_id,
          diagramId: updatedTask.diagram_id,
          entityType: 'task',
          entityId: taskId,
          payload: { task: updatedTask, assignments: resolvedAssignments },
        });
        callback(null, { task: updatedTask, revision: '0' });
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        callback(mapDbError(error));
      } finally {
        if (client) client.release();
      }
    },

    async DeleteTask(call_, callback) {
      const taskId = String(call_.request.task_id ?? '');
      const expectedVersion = Number(call_.request.expected_version ?? 0);
      try {
        const task = await db.query(
          `SELECT * FROM plan.tasks WHERE id = $1 AND deleted_at IS NULL`,
          [taskId],
        );
        if (task.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'task_not_found'));
          return;
        }
        if (expectedVersion > 0 && expectedVersion !== task.rows[0].version) {
          callback(versionConflict());
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          task.rows[0].diagram_id,
        ]);
        const actorRole = await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.task.delete',
        );
        const deleted = await db.query(
          `WITH RECURSIVE subtree AS (
             SELECT id FROM plan.tasks WHERE id = $1 AND deleted_at IS NULL
             UNION ALL
             SELECT t.id FROM plan.tasks t
             JOIN subtree s ON t.parent_task_id = s.id
             WHERE t.deleted_at IS NULL
           )
           UPDATE plan.tasks
           SET deleted_at = now(), updated_by_user_id = $2, updated_at = now()
           WHERE id IN (SELECT id FROM subtree)
           RETURNING id`,
          [taskId, actorUserId(call_)],
        );
        const deletedIds = deleted.rows.map((row) => row.id);
        await db.query(
          `DELETE FROM plan.dependencies
           WHERE (predecessor_type = 'task' AND predecessor_id = ANY($1::uuid[]))
              OR (successor_type = 'task' AND successor_id = ANY($1::uuid[]))`,
          [deletedIds],
        );
        await db.query(
          `DELETE FROM plan.assignments
           WHERE entity_type = 'task' AND entity_id = ANY($1::uuid[])`,
          [deletedIds],
        );
        await db.query(
          `DELETE FROM plan.comments
           WHERE entity_type = 'task' AND entity_id = ANY($1::uuid[])`,
          [deletedIds],
        );
        await queueEvent(db, {
          aggregateType: 'task',
          aggregateId: taskId,
          eventType: 'task.deleted',
          actorUserId: actorUserId(call_),
          actorRoles: actorRolesFromPermissionRole(actorRole),
          projectId: diagram.rows[0].project_id,
          diagramId: task.rows[0].diagram_id,
          entityType: 'task',
          entityId: taskId,
          payload: { taskId, diagramId: task.rows[0].diagram_id },
        });
        callback(null, { deleted: true, revision: '0' });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CreateDependency(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const predecessorType = String(call_.request.predecessor_type ?? '');
      const successorType = String(call_.request.successor_type ?? '');
      const predecessorId = String(call_.request.predecessor_id ?? '');
      const successorId = String(call_.request.successor_id ?? '');
      if (
        !diagramId ||
        !['task', 'direction'].includes(predecessorType) ||
        !['task', 'direction'].includes(successorType) ||
        !predecessorId ||
        !successorId ||
        (predecessorType === successorType && predecessorId === successorId)
      ) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_dependency'));
        return;
      }

      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.dependency.manage',
        );
        if (
          !(await entityBelongsToDiagram(db, predecessorType, predecessorId, diagramId)) ||
          !(await entityBelongsToDiagram(db, successorType, successorId, diagramId))
        ) {
          callback(grpcError(status.NOT_FOUND, 'dependency_entity_not_found'));
          return;
        }
        if (forbiddenDependencyDirection(predecessorType, successorType)) {
          callback(grpcError(status.INVALID_ARGUMENT, 'direction_to_task_dependency_forbidden'));
          return;
        }
        if (
          await createsDependencyCycle(
            db,
            diagramId,
            predecessorType,
            predecessorId,
            successorType,
            successorId,
          )
        ) {
          callback(grpcError(status.FAILED_PRECONDITION, 'dependency_cycle'));
          return;
        }
        const color = String(call_.request.color ?? '');
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_color'));
          return;
        }
        const lineStyle =
          {
            DEPENDENCY_LINE_STYLE_DASHED: 'dashed',
            DEPENDENCY_LINE_STYLE_DOTTED: 'dotted',
          }[call_.request.line_style] ?? 'solid';
        const arrowShape =
          {
            DEPENDENCY_ARROW_SHAPE_STRAIGHT: 'straight',
            DEPENDENCY_ARROW_SHAPE_CURVED: 'curved',
          }[call_.request.arrow_shape] ?? 'orthogonal';
        const result = await db.query(
          `INSERT INTO plan.dependencies
             (diagram_id, predecessor_type, predecessor_id, successor_type, successor_id,
              color, line_style, arrow_shape, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            diagramId,
            predecessorType,
            predecessorId,
            successorType,
            successorId,
            color || null,
            lineStyle,
            arrowShape,
            actorUserId(call_),
          ],
        );
        callback(null, {
          dependency: toDependency(result.rows[0]),
          revision: '0',
        });
      } catch (error) {
        if (error.code === '23505') {
          callback(grpcError(status.ALREADY_EXISTS, 'dependency_exists'));
          return;
        }
        callback(mapDbError(error));
      }
    },

    async ListDependencies(call_, callback) {
      const diagramId = String(call_.request.diagram_id ?? '');
      const limit = Math.min(Math.max(Number(call_.request.page?.limit ?? 50), 1), 200);
      const offset = Math.max(Number(call_.request.page?.offset ?? 0), 0);
      try {
        const diagram = await db.query(
          `SELECT * FROM project.diagrams WHERE id = $1 AND deleted_at IS NULL`,
          [diagramId],
        );
        if (diagram.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'diagram_not_found'));
          return;
        }
        await checkPermission(call_, userClient, diagram.rows[0].project_id, 'project.view');
        const result = await db.query(
          `SELECT * FROM plan.dependencies
           WHERE diagram_id = $1
           ORDER BY created_at ASC
           LIMIT $2 OFFSET $3`,
          [diagramId, limit, offset],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total
           FROM plan.dependencies WHERE diagram_id = $1`,
          [diagramId],
        );
        callback(null, {
          items: result.rows.map(toDependency),
          page: { total: count.rows[0].total, limit, offset },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateDependency(call_, callback) {
      const dependencyId = String(call_.request.dependency_id ?? '');
      try {
        const dependency = await db.query(`SELECT * FROM plan.dependencies WHERE id = $1`, [
          dependencyId,
        ]);
        if (dependency.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'dependency_not_found'));
          return;
        }
        const current = dependency.rows[0];
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          current.diagram_id,
        ]);
        await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.dependency.manage',
        );

        const predecessorType = hasField(call_.request, 'predecessor_type')
          ? String(call_.request.predecessor_type)
          : current.predecessor_type;
        const predecessorId = hasField(call_.request, 'predecessor_id')
          ? String(call_.request.predecessor_id)
          : current.predecessor_id;
        const successorType = hasField(call_.request, 'successor_type')
          ? String(call_.request.successor_type)
          : current.successor_type;
        const successorId = hasField(call_.request, 'successor_id')
          ? String(call_.request.successor_id)
          : current.successor_id;
        if (
          !['task', 'direction'].includes(predecessorType) ||
          !['task', 'direction'].includes(successorType) ||
          !isUuid(predecessorId) ||
          !isUuid(successorId) ||
          (predecessorType === successorType && predecessorId === successorId)
        ) {
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_dependency'));
          return;
        }
        if (
          !(await entityBelongsToDiagram(db, predecessorType, predecessorId, current.diagram_id)) ||
          !(await entityBelongsToDiagram(db, successorType, successorId, current.diagram_id))
        ) {
          callback(grpcError(status.NOT_FOUND, 'dependency_entity_not_found'));
          return;
        }
        if (forbiddenDependencyDirection(predecessorType, successorType)) {
          callback(grpcError(status.INVALID_ARGUMENT, 'direction_to_task_dependency_forbidden'));
          return;
        }
        if (
          await createsDependencyCycle(
            db,
            current.diagram_id,
            predecessorType,
            predecessorId,
            successorType,
            successorId,
            dependencyId,
          )
        ) {
          callback(grpcError(status.FAILED_PRECONDITION, 'dependency_cycle'));
          return;
        }

        const values = [dependencyId];
        const sets = [];
        const add = (column, value) => {
          values.push(value);
          sets.push(`${column} = $${values.length}`);
        };
        if (hasField(call_.request, 'predecessor_type')) {
          add('predecessor_type', predecessorType);
        }
        if (hasField(call_.request, 'predecessor_id')) {
          add('predecessor_id', predecessorId);
        }
        if (hasField(call_.request, 'successor_type')) {
          add('successor_type', successorType);
        }
        if (hasField(call_.request, 'successor_id')) {
          add('successor_id', successorId);
        }
        if (hasField(call_.request, 'color')) {
          const color = String(call_.request.color ?? '');
          if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
            callback(grpcError(status.INVALID_ARGUMENT, 'invalid_color'));
            return;
          }
          add('color', color || null);
        }
        if (hasField(call_.request, 'line_style')) {
          add(
            'line_style',
            {
              DEPENDENCY_LINE_STYLE_DASHED: 'dashed',
              DEPENDENCY_LINE_STYLE_DOTTED: 'dotted',
            }[call_.request.line_style] ?? 'solid',
          );
        }
        if (hasField(call_.request, 'arrow_shape')) {
          add(
            'arrow_shape',
            {
              DEPENDENCY_ARROW_SHAPE_STRAIGHT: 'straight',
              DEPENDENCY_ARROW_SHAPE_CURVED: 'curved',
            }[call_.request.arrow_shape] ?? 'orthogonal',
          );
        }
        if (sets.length === 0) {
          callback(null, { dependency: toDependency(current), revision: '0' });
          return;
        }
        sets.push('updated_at = now()');
        const result = await db.query(
          `UPDATE plan.dependencies SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
          values,
        );
        callback(null, { dependency: toDependency(result.rows[0]), revision: '0' });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async DeleteDependency(call_, callback) {
      const dependencyId = String(call_.request.dependency_id ?? '');
      try {
        const dependency = await db.query(`SELECT * FROM plan.dependencies WHERE id = $1`, [
          dependencyId,
        ]);
        if (dependency.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'dependency_not_found'));
          return;
        }
        const diagram = await db.query(`SELECT project_id FROM project.diagrams WHERE id = $1`, [
          dependency.rows[0].diagram_id,
        ]);
        await checkPermission(
          call_,
          userClient,
          diagram.rows[0].project_id,
          'project.dependency.manage',
        );
        await db.query('DELETE FROM plan.dependencies WHERE id = $1', [dependencyId]);
        callback(null, { deleted: true, revision: '0' });
      } catch (error) {
        callback(mapDbError(error));
      }
    },
  };
}
