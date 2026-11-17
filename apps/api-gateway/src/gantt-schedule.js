const DAY_MS = 86_400_000;

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function countDays(start, end, mode, holidays) {
  if (!start || !end || end < start) return 0;
  if (mode !== 'working') return Math.floor((end - start) / DAY_MS) + 1;
  let count = 0;
  for (let current = start; current <= end; current = addDays(current, 1)) {
    if (!holidays.has(dateKey(current)) && ![0, 6].includes(current.getUTCDay())) count += 1;
  }
  return count;
}

export function applySchedule(snapshot, dayMode, holidayItems) {
  const holidays = new Set((holidayItems ?? []).map((item) => item.holidayDate));
  const mode = dayMode === 'working' ? 'working' : 'calendar';
  const tasks = snapshot.tasks ?? [];
  const directions = snapshot.directions ?? [];
  const childrenByParent = new Map();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const list = childrenByParent.get(task.parentTaskId) ?? [];
    list.push(task);
    childrenByParent.set(task.parentTaskId, list);
  }

  const effectiveEndCache = new Map();
  function effectiveEnd(task) {
    if (effectiveEndCache.has(task.id)) return effectiveEndCache.get(task.id);
    const children = childrenByParent.get(task.id) ?? [];
    let result = toDate(task.endDate);
    if (children.length) {
      result = children
        .map((child) => effectiveEnd(child))
        .filter(Boolean)
        .reduce((latest, end) => (!latest || end > latest ? end : latest), null);
    }
    effectiveEndCache.set(task.id, result);
    return result;
  }

  const enrichedTasks = tasks.map((task) => {
    const start = toDate(task.startDate);
    const end = effectiveEnd(task);
    const done = toDate(task.actualEndDate);
    const doneDeltaDays = done && end ? Math.round((end - done) / DAY_MS) : 0;
    return {
      ...task,
      effectiveEndDate: end ? dateKey(end) : null,
      days: countDays(start, end, mode, holidays),
      doneDeltaDays,
      childrenCount: (childrenByParent.get(task.id) ?? []).length,
    };
  });

  const enrichedById = new Map(enrichedTasks.map((task) => [task.id, task]));
  function aggregateProgress(task) {
    const children = (childrenByParent.get(task.id) ?? [])
      .map((child) => enrichedById.get(child.id))
      .filter(Boolean);
    for (const child of children) aggregateProgress(child);
    if (!children.length) return task;
    const progress = Math.round(
      children.reduce((sum, child) => sum + Number(child.progress || 0), 0) / children.length,
    );
    const allDone = children.every((child) => child.status === 'done');
    const anyStarted = children.some((child) =>
      ['in_progress', 'done', 'blocked'].includes(child.status),
    );
    task.progress = progress;
    task.status = allDone ? 'done' : anyStarted ? 'in_progress' : 'planned';
    task.autoProgress = true;
    return task;
  }
  for (const task of enrichedTasks) aggregateProgress(task);

  const enrichedDirections = directions.map((direction) => {
    const directionTasks = enrichedTasks.filter((task) => task.directionId === direction.id);
    const rootTasks = directionTasks.filter((task) => !task.parentTaskId);
    const done = rootTasks.filter((task) => task.status === 'done').length;
    const progress = rootTasks.length
      ? Math.round(
          rootTasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / rootTasks.length,
        )
      : 0;
    const start = directionTasks
      .map((task) => toDate(task.startDate))
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    const end = directionTasks
      .map((task) => toDate(task.effectiveEndDate))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    const ownStart = toDate(direction.startDate);
    const ownEnd = toDate(direction.endDate);
    const resolvedEnd = directionTasks.length ? end : ownEnd;
    return {
      ...direction,
      tasksCount: directionTasks.length,
      doneCount: done,
      progress,
      status:
        rootTasks.length && done === rootTasks.length
          ? 'done'
          : rootTasks.some((task) => task.status === 'in_progress' || task.status === 'done')
            ? 'in_progress'
            : 'planned',
      startDate: ownStart ? dateKey(ownStart) : start ? dateKey(start) : null,
      endDate: resolvedEnd ? dateKey(resolvedEnd) : null,
      days: countDays(ownStart ?? start, resolvedEnd, mode, holidays),
    };
  });

  const graph = buildGraph(enrichedTasks, snapshot.dependencies ?? []);
  const issuedTasks = enrichedTasks.map((task) => {
    const node = graph.nodes.get(task.id);
    return {
      ...task,
      float: node?.float ?? null,
      isCritical: Boolean(node?.critical),
    };
  });
  const issuedById = new Map(issuedTasks.map((task) => [task.id, task.id]));
  const dependencies = (snapshot.dependencies ?? []).map((dependency) => ({
    ...dependency,
    isCritical:
      issuedById.has(dependency.predecessorId) &&
      issuedById.has(dependency.successorId) &&
      Boolean(graph.nodes.get(dependency.predecessorId)?.critical) &&
      Boolean(graph.nodes.get(dependency.successorId)?.critical),
  }));

  const counts = issuedTasks.reduce(
    (acc, task) => {
      acc.total += 1;
      if (task.status === 'done') acc.done += 1;
      else if (task.status === 'in_progress') acc.inProgress += 1;
      else if (task.status === 'blocked') acc.blocked += 1;
      else if (task.status === 'postponed') acc.postponed += 1;
      else acc.planned += 1;
      if (task.doneDeltaDays > 0) acc.early += 1;
      if (
        toDate(task.effectiveEndDate) &&
        !task.actualEndDate &&
        toDate(task.effectiveEndDate) < new Date()
      ) {
        acc.overdue += 1;
      }
      return acc;
    },
    {
      total: 0,
      done: 0,
      inProgress: 0,
      blocked: 0,
      postponed: 0,
      planned: 0,
      early: 0,
      overdue: 0,
    },
  );
  const projectStart = issuedTasks
    .map((task) => toDate(task.startDate))
    .filter(Boolean)
    .sort((a, b) => a - b)[0];
  const projectEnd = issuedTasks
    .map((task) => toDate(task.effectiveEndDate))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  return {
    ...snapshot,
    tasks: issuedTasks,
    directions: enrichedDirections,
    dependencies,
    schedule: {
      mode,
      projectStart: projectStart ? dateKey(projectStart) : null,
      projectEnd: projectEnd ? dateKey(projectEnd) : null,
      durationDays: countDays(projectStart, projectEnd, mode, holidays),
      overallProgress: issuedTasks.length
        ? Math.round(
            issuedTasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) /
              issuedTasks.length,
          )
        : 0,
      criticalTaskIds: issuedTasks.filter((task) => task.isCritical).map((task) => task.id),
      cycles: graph.cycles,
      counts,
    },
  };
}

function buildGraph(tasks, dependencies) {
  const nodes = new Map();
  const edges = dependencies
    .filter(
      (dependency) => dependency.predecessorType === 'task' && dependency.successorType === 'task',
    )
    .filter(
      (dependency) =>
        tasks.some((task) => task.id === dependency.predecessorId) &&
        tasks.some((task) => task.id === dependency.successorId),
    );
  for (const task of tasks) {
    const start = toDate(task.startDate);
    const end = toDate(task.effectiveEndDate ?? task.endDate);
    nodes.set(task.id, {
      task,
      duration: start && end ? Math.max(1, Math.round((end - start) / DAY_MS) + 1) : 1,
      earlyStart: 0,
      earlyFinish: 0,
      lateStart: 0,
      lateFinish: 0,
      float: 0,
      critical: false,
    });
  }
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map(tasks.map((task) => [task.id, []]));
  for (const edge of edges) {
    outgoing.get(edge.predecessorId).push(edge.successorId);
    indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
  }
  const queue = tasks.filter((task) => (indegree.get(task.id) ?? 0) === 0).map((task) => task.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  const cycles = order.length === tasks.length ? [] : ['dependency_cycle'];
  for (const id of order) {
    const node = nodes.get(id);
    const earlyStart = Math.max(
      0,
      ...edges
        .filter((edge) => edge.successorId === id)
        .map((edge) => nodes.get(edge.predecessorId)?.earlyFinish ?? 0),
    );
    node.earlyStart = earlyStart;
    node.earlyFinish = earlyStart + node.duration;
  }
  const projectFinish = Math.max(0, ...[...nodes.values()].map((node) => node.earlyFinish));
  for (const id of [...order].reverse()) {
    const node = nodes.get(id);
    const lateFinish = outgoing.get(id)?.length
      ? Math.min(...outgoing.get(id).map((next) => nodes.get(next).lateStart))
      : projectFinish;
    node.lateFinish = lateFinish;
    node.lateStart = lateFinish - node.duration;
    node.float = node.lateStart - node.earlyStart;
    node.critical = node.float <= 0;
  }
  return { nodes, cycles };
}
