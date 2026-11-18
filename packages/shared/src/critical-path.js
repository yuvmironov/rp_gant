const DAY_MS = 86_400_000;
const HOURS_PER_DAY = 8;

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
      ? value
      : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dateFromKey(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function holidaySet(holidays) {
  if (holidays instanceof Set) return holidays;
  return new Set(
    Array.from(holidays ?? [], (item) =>
      toDateOnly(typeof item === 'string' ? item : (item?.holidayDate ?? item?.date)),
    ).filter(Boolean),
  );
}

export function countScheduleDays(startValue, endValue, dayMode = 'calendar', holidays = []) {
  const startKey = toDateOnly(startValue);
  const endKey = toDateOnly(endValue);
  if (!startKey || !endKey || endKey < startKey) return 0;

  const start = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  if (!start || !end) return 0;
  if (dayMode !== 'working') return Math.floor((end - start) / DAY_MS) + 1;

  const holidaysByDate = holidaySet(holidays);
  let count = 0;
  for (let current = start; current <= end; current = new Date(current.getTime() + DAY_MS)) {
    if (!holidaysByDate.has(toDateOnly(current)) && ![0, 6].includes(current.getUTCDay()))
      count += 1;
  }
  return count;
}

function taskDuration(task, dayMode, holidays) {
  const rawStartDate = task.startDate;
  const rawEndDate = task.effectiveEndDate ?? task.endDate;
  const startDate = toDateOnly(rawStartDate);
  const endDate = toDateOnly(rawEndDate);
  if ((rawStartDate && !startDate) || (rawEndDate && !endDate)) {
    return { duration: 0, issue: 'invalid_date_range' };
  }
  if (startDate && endDate) {
    if (endDate < startDate) return { duration: 0, issue: 'invalid_date_range' };
    const duration = countScheduleDays(startDate, endDate, dayMode, holidays);
    if (duration <= 0) return { duration: 0, issue: 'no_working_days' };
    return { duration };
  }

  const estimatedHours = Number(task.estimatedHours ?? 0);
  if (Number.isFinite(estimatedHours) && estimatedHours > 0) {
    return { duration: Math.ceil(estimatedHours / HOURS_PER_DAY) };
  }
  return { duration: 0, issue: 'missing_duration' };
}

function emptyMetrics(
  tasks,
  directions,
  status,
  issues,
  unknownDurationTaskIds,
  invalidDependencyIds,
) {
  return {
    calculationStatus: status,
    criticalPathDurationDays: null,
    criticalTaskIds: [],
    criticalDependencyIds: [],
    taskMetrics: tasks.map((task) => ({ id: task.id, float: null, isCritical: false })),
    directionMetrics: directions.map((direction) => ({
      id: direction.id,
      float: null,
      isCritical: false,
    })),
    cycles: status === 'cycle' ? ['dependency_cycle'] : [],
    issues,
    unknownDurationTaskIds,
    invalidDependencyIds,
  };
}

export function calculateCriticalPath({
  tasks = [],
  directions = [],
  dependencies = [],
  dayMode = 'calendar',
  holidays = [],
} = {}) {
  const scheduleHolidays = holidaySet(holidays);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const childrenByParent = new Map();
  const rootsByDirection = new Map();
  const hierarchyIssues = new Set();

  for (const task of tasks) {
    if (task.parentTaskId && taskById.has(task.parentTaskId)) {
      const children = childrenByParent.get(task.parentTaskId) ?? [];
      children.push(task);
      childrenByParent.set(task.parentTaskId, children);
    } else {
      if (task.parentTaskId) hierarchyIssues.add(task.id);
      const roots = rootsByDirection.get(task.directionId) ?? [];
      roots.push(task);
      rootsByDirection.set(task.directionId, roots);
    }
  }

  const nodes = new Map();
  const edgesByKey = new Map();
  const taskRefs = new Map();
  const directionRefs = new Map();
  const leavesByTask = new Map();
  const leavesByDirection = new Map();
  const unknownDurationTaskIds = new Set();
  const durationIssuesByTask = new Map();
  const invalidDependencyIds = new Set();
  const buildingTasks = new Set();

  const addNode = (id, { kind, duration = 0, taskId = null, issue = null } = {}) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        kind,
        duration,
        taskId,
        issue,
        earlyStart: 0,
        earlyFinish: 0,
        lateStart: 0,
        lateFinish: 0,
        float: null,
      });
    }
    return nodes.get(id);
  };

  const addEdge = (from, to, dependencyId = null) => {
    if (!nodes.has(from) || !nodes.has(to)) return null;
    const key = `${from}\u0000${to}`;
    let edge = edgesByKey.get(key);
    if (!edge) {
      edge = { from, to, dependencyIds: new Set() };
      edgesByKey.set(key, edge);
    }
    if (dependencyId) edge.dependencyIds.add(dependencyId);
    return edge;
  };

  const groupRef = (kind, id) => {
    const start = `${kind}:${id}:start`;
    const finish = `${kind}:${id}:finish`;
    addNode(start, { kind: 'boundary' });
    addNode(finish, { kind: 'boundary' });
    return { start, finish };
  };

  function buildTaskRef(taskId) {
    if (buildingTasks.has(taskId)) {
      hierarchyIssues.add(taskId);
      return null;
    }
    if (taskRefs.has(taskId)) return taskRefs.get(taskId);
    const task = taskById.get(taskId);
    if (!task) return null;

    const children = childrenByParent.get(taskId) ?? [];
    if (!children.length) {
      const nodeId = `task:${taskId}:work`;
      const { duration, issue } = taskDuration(task, dayMode, scheduleHolidays);
      addNode(nodeId, {
        kind: 'work',
        duration,
        taskId,
        issue,
      });
      if (issue) {
        unknownDurationTaskIds.add(taskId);
        durationIssuesByTask.set(taskId, issue);
      }
      const ref = { start: nodeId, finish: nodeId };
      taskRefs.set(taskId, ref);
      leavesByTask.set(taskId, [taskId]);
      return ref;
    }

    const ref = groupRef('task', taskId);
    taskRefs.set(taskId, ref);
    buildingTasks.add(taskId);
    const leaves = [];
    for (const child of children) {
      const childRef = buildTaskRef(child.id);
      if (!childRef) continue;
      addEdge(ref.start, childRef.start);
      addEdge(childRef.finish, ref.finish);
      leaves.push(...(leavesByTask.get(child.id) ?? []));
    }
    buildingTasks.delete(taskId);
    leavesByTask.set(taskId, [...new Set(leaves)]);
    return ref;
  }

  for (const task of tasks) buildTaskRef(task.id);

  const allDirectionIds = new Set([
    ...directions.map((direction) => direction.id),
    ...tasks.map((task) => task.directionId).filter(Boolean),
  ]);
  for (const directionId of allDirectionIds) {
    const ref = groupRef('direction', directionId);
    directionRefs.set(directionId, ref);
    const leaves = [];
    for (const task of rootsByDirection.get(directionId) ?? []) {
      const taskRef = taskRefs.get(task.id);
      if (!taskRef) continue;
      addEdge(ref.start, taskRef.start);
      addEdge(taskRef.finish, ref.finish);
      leaves.push(...(leavesByTask.get(task.id) ?? []));
    }
    leavesByDirection.set(directionId, [...new Set(leaves)]);
  }

  const invalidDependencies = [];
  const dependencyEdges = new Map();
  for (const dependency of dependencies) {
    const id = dependency.id ?? null;
    const predecessorType = dependency.predecessorType;
    const successorType = dependency.successorType;
    if (predecessorType === 'direction' && successorType === 'task') {
      if (id) invalidDependencyIds.add(id);
      invalidDependencies.push(id);
      continue;
    }
    const predecessor =
      predecessorType === 'direction'
        ? directionRefs.get(dependency.predecessorId)
        : predecessorType === 'task'
          ? taskRefs.get(dependency.predecessorId)
          : null;
    const successor =
      successorType === 'direction'
        ? directionRefs.get(dependency.successorId)
        : successorType === 'task'
          ? taskRefs.get(dependency.successorId)
          : null;
    if (!predecessor || !successor) {
      if (id) invalidDependencyIds.add(id);
      invalidDependencies.push(id);
      continue;
    }
    const edge = addEdge(predecessor.finish, successor.start, id);
    if (id && edge) dependencyEdges.set(id, edge);
  }

  if (hierarchyIssues.size || invalidDependencies.length) {
    const issues = [];
    if (hierarchyIssues.size) {
      issues.push({ code: 'invalid_hierarchy', taskIds: [...hierarchyIssues] });
    }
    if (invalidDependencies.length) {
      issues.push({ code: 'invalid_dependency', dependencyIds: invalidDependencies });
    }
    return emptyMetrics(
      tasks,
      directions,
      'invalid',
      issues,
      [...unknownDurationTaskIds],
      [...invalidDependencyIds],
    );
  }

  const outgoing = new Map([...nodes.keys()].map((id) => [id, []]));
  const incoming = new Map([...nodes.keys()].map((id) => [id, []]));
  const indegree = new Map([...nodes.keys()].map((id) => [id, 0]));
  const edges = [...edgesByKey.values()];
  for (const edge of edges) {
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }

  const queue = [...nodes.keys()].filter((id) => indegree.get(id) === 0);
  const order = [];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    order.push(id);
    for (const edge of outgoing.get(id)) {
      const nextDegree = indegree.get(edge.to) - 1;
      indegree.set(edge.to, nextDegree);
      if (nextDegree === 0) queue.push(edge.to);
    }
  }

  if (order.length !== nodes.size) {
    return emptyMetrics(
      tasks,
      directions,
      'cycle',
      [{ code: 'dependency_cycle' }],
      [...unknownDurationTaskIds],
      [],
    );
  }

  for (const id of order) {
    const node = nodes.get(id);
    for (const edge of incoming.get(id)) {
      const predecessor = nodes.get(edge.from);
      node.earlyStart = Math.max(node.earlyStart, predecessor.earlyFinish);
    }
    node.earlyFinish = node.earlyStart + node.duration;
  }

  const projectFinish = Math.max(0, ...[...nodes.values()].map((node) => node.earlyFinish));
  for (const id of [...order].reverse()) {
    const node = nodes.get(id);
    node.lateFinish = outgoing.get(id).length
      ? Math.min(...outgoing.get(id).map((edge) => nodes.get(edge.to).lateStart))
      : projectFinish;
    node.lateStart = node.lateFinish - node.duration;
    node.float = node.lateStart - node.earlyStart;
  }

  const isComplete = unknownDurationTaskIds.size === 0;
  const taskMetrics = tasks.map((task) => {
    const leaves = leavesByTask.get(task.id) ?? [];
    const leafNodes = leaves.map((id) => nodes.get(`task:${id}:work`)).filter(Boolean);
    const isSummary = leaves.length !== 1 || leaves[0] !== task.id;
    const knownNodes = leafNodes.filter((node) => !node.issue);
    const isCritical = knownNodes.some((node) => node.float === 0);
    return {
      id: task.id,
      float: knownNodes.length ? Math.min(...knownNodes.map((node) => node.float)) : null,
      isCritical,
      isSummary,
    };
  });
  const directionMetrics = [...allDirectionIds].map((id) => {
    const leafNodes = (leavesByDirection.get(id) ?? [])
      .map((taskId) => nodes.get(`task:${taskId}:work`))
      .filter(Boolean);
    const knownNodes = leafNodes.filter((node) => !node.issue);
    return {
      id,
      float: knownNodes.length ? Math.min(...knownNodes.map((node) => node.float)) : null,
      isCritical: knownNodes.some((node) => node.float === 0),
    };
  });

  const criticalTaskIds = tasks
    .filter((task) => {
      const node = nodes.get(`task:${task.id}:work`);
      return node && !node.issue && node.float === 0;
    })
    .map((task) => task.id);
  const criticalDependencyIds = [];
  for (const [dependencyId, edge] of dependencyEdges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from.float === 0 && to.float === 0 && from.earlyFinish === to.earlyStart) {
      criticalDependencyIds.push(dependencyId);
    }
  }

  const taskIdsByIssue = new Map();
  for (const [taskId, code] of durationIssuesByTask) {
    const taskIds = taskIdsByIssue.get(code) ?? [];
    taskIds.push(taskId);
    taskIdsByIssue.set(code, taskIds);
  }
  const issues = [...taskIdsByIssue].map(([code, taskIds]) => ({ code, taskIds }));
  return {
    calculationStatus: isComplete ? 'complete' : 'incomplete',
    criticalPathDurationDays: isComplete ? projectFinish : null,
    criticalTaskIds: isComplete ? criticalTaskIds : [],
    criticalDependencyIds: isComplete ? criticalDependencyIds : [],
    taskMetrics: isComplete
      ? taskMetrics
      : taskMetrics.map((task) => ({ ...task, float: null, isCritical: false })),
    directionMetrics: isComplete
      ? directionMetrics
      : directionMetrics.map((direction) => ({ ...direction, float: null, isCritical: false })),
    cycles: [],
    issues,
    unknownDurationTaskIds: [...unknownDurationTaskIds],
    invalidDependencyIds: [],
  };
}
