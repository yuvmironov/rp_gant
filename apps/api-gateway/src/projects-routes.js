import { createMetadata } from '@rp-gant/service-kit';
import { csrfValid, sendProblem } from './auth-routes.js';
import { call } from './project-client.js';
import { applySchedule } from './gantt-schedule.js';

function fromTimestamp(value) {
  if (!value) return undefined;
  const milliseconds =
    Number(value.seconds ?? 0) * 1000 + Math.floor(Number(value.nanos ?? 0) / 1_000_000);
  return new Date(milliseconds).toISOString();
}

function toStatus(value) {
  return (
    {
      PROJECT_STATUS_ACTIVE: 'active',
      PROJECT_STATUS_ARCHIVED: 'archived',
      PROJECT_STATUS_DELETED: 'deleted',
    }[value] ?? value
  );
}

function projectStatusEnum(value) {
  return (
    {
      archived: 'PROJECT_STATUS_ARCHIVED',
      deleted: 'PROJECT_STATUS_DELETED',
    }[value] ?? 'PROJECT_STATUS_ACTIVE'
  );
}

function toRole(value) {
  return (
    {
      PROJECT_ROLE_OWNER: 'project_owner',
      PROJECT_ROLE_MANAGER: 'project_manager',
      PROJECT_ROLE_EDITOR: 'project_editor',
      PROJECT_ROLE_PARTICIPANT: 'project_participant',
      PROJECT_ROLE_VIEWER: 'project_viewer',
    }[value] ?? value
  );
}

export function mapProject(project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    ownerUserId: project.owner_user_id,
    owner: project.owner
      ? {
          userId: project.owner.user_id,
          displayName: project.owner.display_name,
          resolved: project.owner.resolved,
        }
      : undefined,
    status: toStatus(project.status),
    settings: project.settings ?? {},
    myRole: toRole(project.my_role),
    createdByUserId: project.created_by_user_id,
    updatedByUserId: project.updated_by_user_id,
    createdAt: fromTimestamp(project.created_at),
    updatedAt: fromTimestamp(project.updated_at),
    archivedAt: fromTimestamp(project.archived_at),
    deletedAt: fromTimestamp(project.deleted_at),
    purgeAfter: fromTimestamp(project.purge_after),
    namesResolved: Boolean(project.names_resolved),
    diagramsCount: Number(project.diagrams_count ?? 0),
  };
}

function toDayMode(value) {
  return value === 'DAY_MODE_CALENDAR' ? 'calendar' : 'working';
}

export function mapDiagram(diagram) {
  return {
    id: diagram.id,
    projectId: diagram.project_id,
    name: diagram.name,
    description: diagram.description,
    dayMode: toDayMode(diagram.day_mode),
    currentRevision: Number(diagram.current_revision ?? 0),
    createdByUserId: diagram.created_by_user_id,
    updatedByUserId: diagram.updated_by_user_id,
    createdAt: fromTimestamp(diagram.created_at),
    updatedAt: fromTimestamp(diagram.updated_at),
    archivedAt: fromTimestamp(diagram.archived_at),
    deletedAt: fromTimestamp(diagram.deleted_at),
  };
}

function toPriority(value) {
  return (
    {
      PRIORITY_LOW: 'low',
      PRIORITY_MEDIUM: 'medium',
      PRIORITY_HIGH: 'high',
      PRIORITY_CRITICAL: 'critical',
    }[value] ?? value
  );
}

function priorityEnum(value) {
  return (
    {
      low: 'PRIORITY_LOW',
      medium: 'PRIORITY_MEDIUM',
      high: 'PRIORITY_HIGH',
      critical: 'PRIORITY_CRITICAL',
    }[value] ?? 'PRIORITY_UNSPECIFIED'
  );
}

function assignmentRoleEnum(value) {
  return (
    {
      executor: 'ASSIGNMENT_ROLE_EXECUTOR',
      co_executor: 'ASSIGNMENT_ROLE_CO_EXECUTOR',
    }[value] ?? 'ASSIGNMENT_ROLE_RESPONSIBLE'
  );
}

function assigneeTypeEnum(value) {
  return value === 'user' ? 'ASSIGNEE_TYPE_USER' : 'ASSIGNEE_TYPE_UNSPECIFIED';
}

function dependencyLineStyleEnum(value) {
  return (
    {
      dashed: 'DEPENDENCY_LINE_STYLE_DASHED',
      dotted: 'DEPENDENCY_LINE_STYLE_DOTTED',
    }[value] ?? 'DEPENDENCY_LINE_STYLE_SOLID'
  );
}

function dependencyArrowEnum(value) {
  return (
    {
      straight: 'DEPENDENCY_ARROW_SHAPE_STRAIGHT',
      curved: 'DEPENDENCY_ARROW_SHAPE_CURVED',
    }[value] ?? 'DEPENDENCY_ARROW_SHAPE_ORTHOGONAL'
  );
}

function fromDateTimestamp(value) {
  const iso = fromTimestamp(value);
  return iso ? iso.slice(0, 10) : undefined;
}

function timestampInput(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    seconds: String(Math.floor(date.getTime() / 1000)),
    nanos: (date.getTime() % 1000) * 1_000_000,
  };
}

function toTaskStatus(value) {
  return (
    {
      TASK_STATUS_PLANNED: 'planned',
      TASK_STATUS_IN_PROGRESS: 'in_progress',
      TASK_STATUS_DONE: 'done',
      TASK_STATUS_BLOCKED: 'blocked',
      TASK_STATUS_POSTPONED: 'postponed',
    }[value] ?? value
  );
}

export function mapAssignment(assignment) {
  return {
    id: assignment.id,
    role:
      {
        ASSIGNMENT_ROLE_RESPONSIBLE: 'responsible',
        ASSIGNMENT_ROLE_EXECUTOR: 'executor',
        ASSIGNMENT_ROLE_CO_EXECUTOR: 'co_executor',
      }[assignment.role] ?? 'responsible',
    assigneeType: 'user',
    assigneeId: assignment.assignee_id,
    displayName: assignment.display_name,
    resolved: assignment.resolved,
  };
}

export function mapDirection(direction) {
  return {
    id: direction.id,
    diagramId: direction.diagram_id,
    wbsCode: direction.wbs_code,
    sortOrder: direction.sort_order,
    name: direction.name,
    description: direction.description,
    result: direction.result,
    priority: toPriority(direction.priority),
    startDate: fromTimestamp(direction.start_date),
    endDate: fromTimestamp(direction.end_date),
    jiraNumber: direction.jira_number,
    bpFlag: direction.bp_flag,
    spFlag: direction.sp_flag,
    version: direction.version,
    assignments: (direction.assignments ?? []).map(mapAssignment),
    createdByUserId: direction.created_by_user_id,
    updatedByUserId: direction.updated_by_user_id,
    createdAt: fromTimestamp(direction.created_at),
    updatedAt: fromTimestamp(direction.updated_at),
  };
}

export function mapTask(task) {
  return {
    id: task.id,
    diagramId: task.diagram_id,
    directionId: task.direction_id,
    parentTaskId: task.parent_task_id,
    level: task.level,
    wbsCode: task.wbs_code,
    sortOrder: task.sort_order,
    name: task.name,
    description: task.description,
    result: task.result,
    status: toTaskStatus(task.status),
    progress: task.progress,
    priority: toPriority(task.priority),
    startDate: fromTimestamp(task.start_date),
    endDate: fromTimestamp(task.end_date),
    actualEndDate: fromTimestamp(task.actual_end_date),
    estimatedHours: task.estimated_hours == null ? null : Number(task.estimated_hours),
    jiraNumber: task.jira_number,
    bpFlag: task.bp_flag,
    spFlag: task.sp_flag,
    version: task.version,
    assignments: (task.assignments ?? []).map(mapAssignment),
    commentsCount: task.comments_count,
    createdByUserId: task.created_by_user_id,
    updatedByUserId: task.updated_by_user_id,
    createdAt: fromTimestamp(task.created_at),
    updatedAt: fromTimestamp(task.updated_at),
  };
}

export function mapDependency(dependency) {
  return {
    id: dependency.id,
    diagramId: dependency.diagram_id,
    predecessorType: dependency.predecessor_type,
    predecessorId: dependency.predecessor_id,
    successorType: dependency.successor_type,
    successorId: dependency.successor_id,
    linkType: 'finish_to_start',
    color: dependency.color,
    lineStyle:
      {
        DEPENDENCY_LINE_STYLE_DASHED: 'dashed',
        DEPENDENCY_LINE_STYLE_DOTTED: 'dotted',
      }[dependency.line_style] ?? 'solid',
    arrowShape:
      {
        DEPENDENCY_ARROW_SHAPE_STRAIGHT: 'straight',
        DEPENDENCY_ARROW_SHAPE_CURVED: 'curved',
      }[dependency.arrow_shape] ?? 'orthogonal',
    createdByUserId: dependency.created_by_user_id,
    createdAt: fromTimestamp(dependency.created_at),
    updatedAt: fromTimestamp(dependency.updated_at),
  };
}

export function mapComment(comment) {
  return {
    id: comment.id,
    entityType: comment.entity_type,
    entityId: comment.entity_id,
    authorUserId: comment.author_user_id,
    mentionedUserIds: comment.mentioned_user_ids ?? [],
    mentionedUsers: [],
    body: comment.body,
    createdAt: fromTimestamp(comment.created_at),
    updatedAt: fromTimestamp(comment.updated_at),
  };
}

export function mapHoliday(holiday) {
  return {
    id: holiday.id,
    diagramId: holiday.diagram_id,
    holidayDate: fromDateTimestamp(holiday.holiday_date),
    name: holiday.name,
  };
}

export function mapImportJob(job) {
  return {
    id: job.id,
    projectId: job.project_id,
    diagramId: job.diagram_id,
    initiatorUserId: job.initiator_user_id,
    format: job.format === 'IMPORT_FORMAT_CSV' ? 'csv' : 'json',
    status:
      {
        IMPORT_STATUS_QUEUED: 'queued',
        IMPORT_STATUS_PROCESSING: 'processing',
        IMPORT_STATUS_COMPLETED: 'completed',
        IMPORT_STATUS_FAILED: 'failed',
        IMPORT_STATUS_CANCELLED: 'cancelled',
      }[job.status] ?? 'failed',
    fileName: job.file_name,
    sizeBytes: Number(job.size_bytes ?? 0),
    report: job.report
      ? {
          directionsCount: job.report.directions_count,
          tasksCount: job.report.tasks_count,
          assignmentsCount: job.report.assignments_count,
          withoutResponsibleCount: job.report.without_responsible_count,
          withoutExecutorCount: job.report.without_executor_count,
          withoutCoexecutorCount: job.report.without_coexecutor_count,
          issues: job.report.issues ?? [],
        }
      : undefined,
    errorCode: job.error_code,
    errorMessage: job.error_message,
    createdAt: fromTimestamp(job.created_at),
    startedAt: fromTimestamp(job.started_at),
    finishedAt: fromTimestamp(job.finished_at),
    expiresAt: fromTimestamp(job.expires_at),
  };
}

export function mapSnapshot(snapshot) {
  const mapped = {
    diagram: mapDiagram(snapshot.diagram),
    directions: (snapshot.directions ?? []).map(mapDirection),
    tasks: (snapshot.tasks ?? []).map(mapTask),
    dependencies: (snapshot.dependencies ?? []).map(mapDependency),
    comments: (snapshot.comments ?? []).map(mapComment),
    holidays: (snapshot.holidays ?? []).map(mapHoliday),
    currentRevision: Number(snapshot.current_revision ?? 0),
    namesResolved: snapshot.names_resolved,
  };
  return applySchedule(mapped, mapped.diagram?.dayMode, mapped.holidays);
}

function standaloneExport(snapshotData, format) {
  const snapshot = mapSnapshot(snapshotData);
  const byId = new Map();
  for (const direction of snapshot.directions) byId.set(direction.id, direction.wbsCode);
  for (const task of snapshot.tasks) byId.set(task.id, task.wbsCode);
  const depsByTask = new Map();
  const depStyles = {};
  for (const dependency of snapshot.dependencies) {
    const from = byId.get(dependency.predecessorId);
    const to = byId.get(dependency.successorId);
    if (!from || !to) continue;
    if (dependency.successorType === 'task') {
      const list = depsByTask.get(dependency.successorId) ?? [];
      list.push(from);
      depsByTask.set(dependency.successorId, list);
    }
    depStyles[`${from}>${to}`] = {
      color: dependency.color || '#94a3b8',
      dash: dependency.lineStyle,
      shape: dependency.arrowShape,
    };
  }
  const commentsByEntity = new Map();
  for (const comment of snapshot.comments) {
    const list = commentsByEntity.get(comment.entityId) ?? [];
    list.push({
      id: comment.id,
      text: comment.body,
      author: comment.authorUserId,
      createdAt: comment.createdAt,
    });
    commentsByEntity.set(comment.entityId, list);
  }
  const assignmentsOf = (entity, includeResponsible = false) => {
    const list = entity.assignments ?? [];
    const find = (role) => list.find((item) => item.role === role)?.assigneeId ?? null;
    return includeResponsible
      ? { ownerId: find('responsible') }
      : { execId: find('executor') ?? find('responsible'), coId: find('co_executor') };
  };

  const statusRu = {
    planned: 'Запланировано',
    in_progress: 'В работе',
    done: 'Выполнено',
    blocked: 'Заблокировано',
    postponed: 'Отложено',
  };
  const priorityRu = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический' };
  const tasks = [
    ...snapshot.directions.map((direction) => ({
      id: direction.wbsCode,
      parentId: null,
      level: 1,
      type: 'Направление',
      task: direction.name,
      result: direction.result,
      description: direction.description,
      ...assignmentsOf(direction, true),
      start: direction.startDate?.slice(0, 10) ?? null,
      end: direction.effectiveEndDate ?? direction.endDate?.slice(0, 10) ?? null,
      days: direction.days ?? 0,
      status: statusRu[direction.status] ?? direction.status,
      percentComplete: direction.progress ?? 0,
      priority: priorityRu[direction.priority] ?? direction.priority,
      dependencies: '',
      jira: direction.jiraNumber ?? '',
      doneDate: null,
      comments: commentsByEntity.get(direction.id) ?? [],
      hasBP: Boolean(direction.bpFlag),
      hasSP: Boolean(direction.spFlag),
    })),
    ...snapshot.tasks.map((task) => ({
      id: task.wbsCode,
      parentId: task.parentTaskId ? byId.get(task.parentTaskId) : byId.get(task.directionId),
      level: task.level,
      type: task.level === 3 ? 'Подзадача' : 'Задача',
      task: task.name,
      result: task.result,
      description: task.description,
      ...assignmentsOf(task),
      start: task.startDate?.slice(0, 10) ?? null,
      end: task.effectiveEndDate ?? task.endDate?.slice(0, 10) ?? null,
      days: task.days ?? 0,
      status: statusRu[task.status] ?? task.status,
      percentComplete: task.progress ?? 0,
      priority: priorityRu[task.priority] ?? task.priority,
      dependencies: (depsByTask.get(task.id) ?? []).join('; '),
      jira: task.jiraNumber ?? '',
      doneDate: task.actualEndDate?.slice(0, 10) ?? null,
      comments: commentsByEntity.get(task.id) ?? [],
      hasBP: Boolean(task.bpFlag),
      hasSP: Boolean(task.spFlag),
    })),
  ];
  if (format === 'csv') {
    const headers = [
      'WBS ID',
      'Наименование',
      'Родитель',
      'Уровень',
      'Тип',
      'Ответственный направления',
      'Исполнитель',
      'Соисполнитель',
      'Начало',
      'Окончание',
      'Дни',
      'Рабочие дни',
      'Статус',
      'Процент',
      'Приоритет',
      'Jira',
      'БП',
      'СП',
      'Зависимости',
      'Результат',
      'Описание',
      'Факт завершения',
      'Досрочно (дн.)',
      'Комментарии',
    ];
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [
      headers.join(';'),
      ...tasks.map((task) =>
        [
          task.id,
          task.task,
          task.parentId,
          task.level,
          task.type,
          task.ownerId,
          task.execId,
          task.coId,
          task.start,
          task.end,
          task.days,
          '',
          task.status,
          task.percentComplete,
          task.priority,
          task.jira,
          task.hasBP ? 'да' : 'нет',
          task.hasSP ? 'да' : 'нет',
          task.dependencies,
          task.result,
          task.description,
          task.doneDate,
          '',
          (task.comments ?? []).map((comment) => comment.text).join(' | '),
        ]
          .map(escape)
          .join(';'),
      ),
      `# project ${snapshot.diagram?.name ?? ''}`,
      `# workdays ${JSON.stringify({ mode: snapshot.diagram?.dayMode === 'working' ? 'workdays' : 'calendar', holidays: snapshot.holidays.map((holiday) => ({ date: holiday.holidayDate, name: holiday.name })) })}`,
      `# depstyles ${JSON.stringify(depStyles)}`,
    ];
    return {
      content: `\uFEFF${lines.join('\n')}`,
      type: 'text/csv; charset=utf-8',
      name: `${snapshot.diagram?.name ?? 'diagram'}.csv`,
    };
  }
  const payload = {
    project: snapshot.diagram?.name ?? '',
    source: 'rp-gant',
    exportedAt: new Date().toISOString(),
    today: new Date().toISOString().slice(0, 10),
    count: tasks.length,
    directionOrder: snapshot.directions.map((direction) => direction.wbsCode),
    workdays: {
      mode: snapshot.diagram?.dayMode === 'working' ? 'workdays' : 'calendar',
      holidays: snapshot.holidays.map((holiday) => ({
        date: holiday.holidayDate,
        name: holiday.name,
      })),
    },
    depStyles,
    tasks,
  };
  return {
    content: JSON.stringify(payload, null, 2),
    type: 'application/json',
    name: `${snapshot.diagram?.name ?? 'diagram'}.json`,
  };
}

function unauthenticated() {
  const error = new Error('unauthenticated');
  error.code = 16;
  return error;
}

async function session(request, userClient) {
  const token = request.cookies['__Host-session'];
  if (!token) throw unauthenticated();
  return call(userClient, 'ValidateSession', {
    session_token: token,
    extend_idle: true,
  });
}

function actorMetadata(userId) {
  return createMetadata({ 'x-actor-user-id': userId });
}

function requireCsrf(request, reply) {
  if (csrfValid(request)) return false;
  reply.code(403).type('application/problem+json').send({
    type: 'https://rp-gant.local/problems/csrf_invalid',
    title: 'Forbidden',
    status: 403,
    detail: 'Invalid CSRF token',
    instance: request.url,
    code: 'csrf_invalid',
    traceId: request.id,
  });
  return true;
}

export async function projectRoutes(app, { userClient, projectClient }) {
  app.get('/api/v1/projects', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const limit = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 200);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);
      const response = await call(projectClient, 'ListProjects', {
        user_id: current.user_id,
        page: { limit, offset },
        status: projectStatusEnum(request.query.status),
      });
      return reply.send({
        items: (response.items ?? []).map(mapProject),
        page: response.page,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/projects', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;

    try {
      const current = await session(request, userClient);
      const response = await call(projectClient, 'CreateProject', {
        name: request.body?.name,
        description: request.body?.description,
        settings: request.body?.settings ?? {},
        owner_user_id: current.user_id,
      });
      return reply.code(201).send(mapProject(response.project));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
  app.get('/api/v1/projects/:projectId', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'GetProject',
        { project_id: request.params.projectId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapProject(response.project));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/projects/:projectId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'UpdateProject',
        {
          project_id: request.params.projectId,
          name: request.body?.name,
          description: request.body?.description,
          settings: request.body?.settings,
        },
        actorMetadata(current.user_id),
      );
      return reply.send(mapProject(response.project));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/projects/:projectId/archive', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'ArchiveProject',
        { project_id: request.params.projectId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapProject(response.project));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/projects/:projectId/unarchive', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'UnarchiveProject',
        { project_id: request.params.projectId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapProject(response.project));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/projects/:projectId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      await call(
        projectClient,
        'DeleteProject',
        { project_id: request.params.projectId },
        actorMetadata(current.user_id),
      );
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/projects/:projectId/restore', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'RestoreProject',
        { project_id: request.params.projectId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapProject(response.project));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
  app.get('/api/v1/projects/:projectId/diagrams', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const limit = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 200);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);
      const response = await call(
        projectClient,
        'ListDiagrams',
        {
          project_id: request.params.projectId,
          page: { limit, offset },
        },
        actorMetadata(current.user_id),
      );
      return reply.send({
        items: (response.items ?? []).map(mapDiagram),
        page: response.page,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/projects/:projectId/diagrams', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'CreateDiagram',
        {
          project_id: request.params.projectId,
          name: request.body?.name,
          description: request.body?.description,
          day_mode: request.body?.dayMode === 'calendar' ? 'DAY_MODE_CALENDAR' : 'DAY_MODE_WORKING',
        },
        actorMetadata(current.user_id),
      );
      return reply.code(201).send(mapDiagram(response.diagram));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
  app.get('/api/v1/diagrams/:diagramId', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'GetDiagram',
        { diagram_id: request.params.diagramId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapDiagram(response.diagram));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/diagrams/:diagramId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'UpdateDiagram',
        {
          diagram_id: request.params.diagramId,
          name: request.body?.name,
          description: request.body?.description,
          day_mode:
            request.body?.dayMode === undefined
              ? undefined
              : request.body.dayMode === 'calendar'
                ? 'DAY_MODE_CALENDAR'
                : 'DAY_MODE_WORKING',
        },
        actorMetadata(current.user_id),
      );
      return reply.send(mapDiagram(response.diagram));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/diagrams/:diagramId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      await call(
        projectClient,
        'DeleteDiagram',
        { diagram_id: request.params.diagramId },
        actorMetadata(current.user_id),
      );
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
  app.post('/api/v1/diagrams/:diagramId/directions', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'CreateDirection',
        {
          diagram_id: request.params.diagramId,
          name: request.body?.name,
          description: request.body?.description,
          result: request.body?.result,
          priority: priorityEnum(request.body?.priority),
          start_date: timestampInput(request.body?.startDate),
          end_date: timestampInput(request.body?.endDate),
          jira_number: request.body?.jiraNumber,
          bp_flag: Boolean(request.body?.bpFlag),
          sp_flag: Boolean(request.body?.spFlag),
        },
        actorMetadata(current.user_id),
      );
      return reply.code(201).send(mapDirection(response.direction));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/directions/:directionId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const body = request.body ?? {};
      const update = {
        direction_id: request.params.directionId,
        expected_version: Number(body.expectedVersion ?? 0),
        base_revision: Number(body.baseRevision ?? 0),
      };
      if ('name' in body) update.name = body.name;
      if ('description' in body) update.description = body.description;
      if ('result' in body) update.result = body.result;
      if ('priority' in body) update.priority = priorityEnum(body.priority);
      if ('startDate' in body) update.start_date = timestampInput(body.startDate);
      if ('endDate' in body) update.end_date = timestampInput(body.endDate);
      if ('jiraNumber' in body) update.jira_number = body.jiraNumber;
      if ('bpFlag' in body) update.bp_flag = Boolean(body.bpFlag);
      if ('spFlag' in body) update.sp_flag = Boolean(body.spFlag);
      const response = await call(
        projectClient,
        'UpdateDirection',
        update,
        actorMetadata(current.user_id),
      );
      return reply.send(mapDirection(response.direction));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/directions/:directionId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      await call(
        projectClient,
        'DeleteDirection',
        {
          direction_id: request.params.directionId,
          expected_version: Number(request.query.expectedVersion ?? 0),
          base_revision: Number(request.query.baseRevision ?? 0),
        },
        actorMetadata(current.user_id),
      );
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/diagrams/:diagramId/directions/reorder', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'ReorderDirections',
        {
          diagram_id: request.params.diagramId,
          direction_ids: request.body?.directionIds ?? [],
          base_revision: Number(request.body?.baseRevision ?? 0),
        },
        actorMetadata(current.user_id),
      );
      return reply.send({ items: (response.items ?? []).map(mapDirection) });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.put('/api/v1/directions/:directionId/responsible', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const item = request.body?.assignment ?? {};
      const response = await call(
        projectClient,
        'SetDirectionResponsible',
        {
          direction_id: request.params.directionId,
          assignment: {
            role: 'ASSIGNMENT_ROLE_RESPONSIBLE',
            assignee_type: assigneeTypeEnum(item.assigneeType),
            assignee_id: item.assigneeId,
          },
          base_revision: Number(request.body?.baseRevision ?? 0),
        },
        actorMetadata(current.user_id),
      );
      return reply.send(mapDirection(response.direction));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/diagrams/:diagramId/tasks', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'CreateTask',
        {
          diagram_id: request.params.diagramId,
          direction_id: request.body?.directionId,
          parent_task_id: request.body?.parentTaskId,
          name: request.body?.name,
          description: request.body?.description,
          result: request.body?.result,
          priority: priorityEnum(request.body?.priority),
          start_date: timestampInput(request.body?.startDate),
          end_date: timestampInput(request.body?.endDate),
          estimated_hours: Number(request.body?.estimatedHours ?? 0),
          jira_number: request.body?.jiraNumber,
          bp_flag: Boolean(request.body?.bpFlag),
          sp_flag: Boolean(request.body?.spFlag),
        },
        actorMetadata(current.user_id),
      );
      return reply.code(201).send(mapTask(response.task));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/diagrams/:diagramId/snapshot', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'GetDiagramSnapshot',
        { diagram_id: request.params.diagramId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapSnapshot(response.snapshot));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
  app.get('/api/v1/tasks/:taskId', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'GetTask',
        { task_id: request.params.taskId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapTask(response.task));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/tasks/:taskId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const body = request.body ?? {};
      const update = {
        task_id: request.params.taskId,
        expected_version: Number(body.expectedVersion ?? 0),
        base_revision: Number(body.baseRevision ?? 0),
      };
      if ('name' in body) update.name = body.name;
      if ('description' in body) update.description = body.description;
      if ('result' in body) update.result = body.result;
      if ('priority' in body) update.priority = priorityEnum(body.priority);
      if ('startDate' in body) update.start_date = timestampInput(body.startDate);
      if ('endDate' in body) update.end_date = timestampInput(body.endDate);
      if ('estimatedHours' in body) update.estimated_hours = Number(body.estimatedHours ?? 0);
      if ('actualEndDate' in body) update.actual_end_date = timestampInput(body.actualEndDate);
      if ('jiraNumber' in body) update.jira_number = body.jiraNumber;
      if ('bpFlag' in body) update.bp_flag = Boolean(body.bpFlag);
      if ('spFlag' in body) update.sp_flag = Boolean(body.spFlag);

      const response = await call(
        projectClient,
        'UpdateTask',
        update,
        actorMetadata(current.user_id),
      );
      return reply.send(mapTask(response.task));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.put('/api/v1/tasks/:taskId/assignments', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const assignments = (request.body?.assignments ?? []).map((item) => ({
        role: assignmentRoleEnum(item.role),
        assignee_type: assigneeTypeEnum(item.assigneeType),
        assignee_id: item.assigneeId,
      }));
      const response = await call(
        projectClient,
        'SetTaskAssignments',
        {
          task_id: request.params.taskId,
          assignments,
          base_revision: Number(request.body?.baseRevision ?? 0),
        },
        actorMetadata(current.user_id),
      );
      return reply.send(mapTask(response.task));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/tasks/:taskId/move', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const body = request.body ?? {};
      const move = {
        task_id: request.params.taskId,
        sort_order: Number(body.sortOrder ?? 0),
        expected_version: Number(body.expectedVersion ?? 0),
        base_revision: Number(body.baseRevision ?? 0),
      };
      if ('parentTaskId' in body) move.parent_task_id = body.parentTaskId ?? '';
      if ('directionId' in body) move.direction_id = body.directionId;
      const response = await call(projectClient, 'MoveTask', move, actorMetadata(current.user_id));
      return reply.send(mapTask(response.task));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/tasks/:taskId/progress', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const status = String(request.body?.status ?? 'planned');
      const response = await call(
        projectClient,
        'UpdateTaskProgress',
        {
          task_id: request.params.taskId,
          status:
            {
              in_progress: 'TASK_STATUS_IN_PROGRESS',
              done: 'TASK_STATUS_DONE',
              blocked: 'TASK_STATUS_BLOCKED',
              postponed: 'TASK_STATUS_POSTPONED',
            }[status] ?? 'TASK_STATUS_PLANNED',
          progress: Number(request.body?.progress ?? 0),
          expected_version: Number(request.body?.expectedVersion ?? 0),
          base_revision: Number(request.body?.baseRevision ?? 0),
        },
        actorMetadata(current.user_id),
      );
      return reply.send(mapTask(response.task));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/tasks/:taskId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      await call(
        projectClient,
        'DeleteTask',
        {
          task_id: request.params.taskId,
          expected_version: Number(request.query.expectedVersion ?? 0),
          base_revision: Number(request.query.baseRevision ?? 0),
        },
        actorMetadata(current.user_id),
      );
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/diagrams/:diagramId/dependencies', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const limit = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 200);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);
      const response = await call(
        projectClient,
        'ListDependencies',
        {
          diagram_id: request.params.diagramId,
          page: { limit, offset },
        },
        actorMetadata(current.user_id),
      );
      return reply.send({
        items: (response.items ?? []).map(mapDependency),
        page: response.page,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/diagrams/:diagramId/dependencies', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'CreateDependency',
        {
          diagram_id: request.params.diagramId,
          predecessor_type: request.body?.predecessorType,
          predecessor_id: request.body?.predecessorId,
          successor_type: request.body?.successorType,
          successor_id: request.body?.successorId,
          color: request.body?.color,
          line_style: dependencyLineStyleEnum(request.body?.lineStyle),
          arrow_shape: dependencyArrowEnum(request.body?.arrowShape),
        },
        actorMetadata(current.user_id),
      );
      return reply.code(201).send(mapDependency(response.dependency));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/dependencies/:dependencyId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const body = request.body ?? {};
      const update = {
        dependency_id: request.params.dependencyId,
        base_revision: Number(body.baseRevision ?? 0),
      };
      if ('predecessorType' in body) update.predecessor_type = body.predecessorType;
      if ('predecessorId' in body) update.predecessor_id = body.predecessorId;
      if ('successorType' in body) update.successor_type = body.successorType;
      if ('successorId' in body) update.successor_id = body.successorId;
      if ('color' in body) update.color = body.color;
      if ('lineStyle' in body) update.line_style = dependencyLineStyleEnum(body.lineStyle);
      if ('arrowShape' in body) update.arrow_shape = dependencyArrowEnum(body.arrowShape);
      const response = await call(
        projectClient,
        'UpdateDependency',
        update,
        actorMetadata(current.user_id),
      );
      return reply.send(mapDependency(response.dependency));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/dependencies/:dependencyId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      await call(
        projectClient,
        'DeleteDependency',
        { dependency_id: request.params.dependencyId },
        actorMetadata(current.user_id),
      );
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/comments', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const limit = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 200);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);
      const response = await call(
        projectClient,
        'ListComments',
        {
          entity_type: request.query.entityType,
          entity_id: request.query.entityId,
          page: { limit, offset },
        },
        actorMetadata(current.user_id),
      );
      return reply.send({
        items: (response.items ?? []).map(mapComment),
        page: response.page,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/comments', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'CreateComment',
        {
          entity_type: request.body?.entityType,
          entity_id: request.body?.entityId,
          body: request.body?.body,
          mentioned_user_ids: request.body?.mentionedUserIds ?? [],
        },
        actorMetadata(current.user_id),
      );
      return reply.code(201).send(mapComment(response.comment));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/comments/:commentId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'UpdateComment',
        {
          comment_id: request.params.commentId,
          body: request.body?.body,
          mentioned_user_ids: request.body?.mentionedUserIds ?? [],
        },
        actorMetadata(current.user_id),
      );
      return reply.send(mapComment(response.comment));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/comments/:commentId', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      await call(
        projectClient,
        'DeleteComment',
        { comment_id: request.params.commentId },
        actorMetadata(current.user_id),
      );
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/diagrams/:diagramId/import', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      let data;
      let fileName = '';
      let format = 'json';
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          data = await part.toBuffer();
          fileName = part.filename ?? '';
        } else if (part.fieldname === 'format') {
          format = String(part.value);
        }
      }
      if (!data) {
        return reply.code(400).type('application/problem+json').send({
          type: 'https://rp-gant.local/problems/invalid_import',
          title: 'Bad Request',
          status: 400,
          detail: 'Import file is required',
          instance: request.url,
          code: 'invalid_import',
          traceId: request.id,
        });
      }
      const response = await call(
        projectClient,
        'StartImport',
        {
          diagram_id: request.params.diagramId,
          format: format === 'csv' ? 'IMPORT_FORMAT_CSV' : 'IMPORT_FORMAT_JSON',
          file_name: fileName,
          data,
          preview: request.query.preview === 'true',
        },
        actorMetadata(current.user_id),
      );
      return reply.code(202).send(mapImportJob(response.job));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/import-jobs/:jobId', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'GetImportStatus',
        { job_id: request.params.jobId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapImportJob(response.job));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/import-jobs/:jobId/cancel', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'CancelImport',
        { job_id: request.params.jobId },
        actorMetadata(current.user_id),
      );
      return reply.send(mapImportJob(response.job));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/diagrams/:diagramId/export', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const format = String(request.query.format ?? 'json').toLowerCase();
      if (String(request.query.compat ?? '') === 'standalone') {
        const snapshot = await call(
          projectClient,
          'GetDiagramSnapshot',
          { diagram_id: request.params.diagramId },
          actorMetadata(current.user_id),
        );
        const exported = standaloneExport(snapshot.snapshot, format);
        return reply
          .type(exported.type)
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(exported.name)}`,
          )
          .send(exported.content);
      }
      const response = await call(
        projectClient,
        'ExportDiagram',
        {
          diagram_id: request.params.diagramId,
          format: format === 'csv' ? 'EXPORT_FORMAT_CSV' : 'EXPORT_FORMAT_JSON',
        },
        actorMetadata(current.user_id),
      );
      return reply
        .type(response.content_type)
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(response.file_name)}`,
        )
        .send(Buffer.from(response.data));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/diagrams/:diagramId/holidays', async (request, reply) => {
    try {
      const current = await session(request, userClient);
      const response = await call(
        projectClient,
        'GetHolidays',
        { diagram_id: request.params.diagramId },
        actorMetadata(current.user_id),
      );
      return reply.send({ items: (response.items ?? []).map(mapHoliday) });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.put('/api/v1/diagrams/:diagramId/holidays', async (request, reply) => {
    if (requireCsrf(request, reply)) return reply;
    try {
      const current = await session(request, userClient);
      const items = (request.body?.items ?? []).map((item) => ({
        holiday_date: timestampInput(item.holidayDate),
        name: item.name ?? '',
      }));
      const response = await call(
        projectClient,
        'UpdateHolidays',
        {
          diagram_id: request.params.diagramId,
          items,
          base_revision: Number(request.body?.baseRevision ?? 0),
        },
        actorMetadata(current.user_id),
      );
      return reply.send({ items: (response.items ?? []).map(mapHoliday) });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
