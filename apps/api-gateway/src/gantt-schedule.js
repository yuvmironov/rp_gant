import { calculateCriticalPath, countScheduleDays } from '@rp-gant/shared';

const DAY_MS = 86_400_000;

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function countDays(start, end, mode, holidays) {
  return countScheduleDays(start, end, mode, holidays);
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

  const criticalPath = calculateCriticalPath({
    tasks: enrichedTasks,
    directions: enrichedDirections,
    dependencies: snapshot.dependencies ?? [],
    dayMode: mode,
    holidays: holidayItems,
  });
  const taskMetrics = new Map(criticalPath.taskMetrics.map((item) => [item.id, item]));
  const directionMetrics = new Map(criticalPath.directionMetrics.map((item) => [item.id, item]));
  const criticalDependencyIds = new Set(criticalPath.criticalDependencyIds);
  const issuedTasks = enrichedTasks.map((task) => {
    const metrics = taskMetrics.get(task.id);
    return {
      ...task,
      float: metrics?.float ?? null,
      isCritical: Boolean(metrics?.isCritical),
    };
  });
  const issuedDirections = enrichedDirections.map((direction) => {
    const metrics = directionMetrics.get(direction.id);
    return {
      ...direction,
      float: metrics?.float ?? null,
      isCritical: Boolean(metrics?.isCritical),
    };
  });
  const dependencies = (snapshot.dependencies ?? []).map((dependency) => ({
    ...dependency,
    isCritical: criticalDependencyIds.has(dependency.id),
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
    directions: issuedDirections,
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
      criticalPathDurationDays: criticalPath.criticalPathDurationDays,
      criticalTaskIds: criticalPath.criticalTaskIds,
      criticalDependencyIds: criticalPath.criticalDependencyIds,
      calculationStatus: criticalPath.calculationStatus,
      unknownDurationTaskIds: criticalPath.unknownDurationTaskIds,
      invalidDependencyIds: criticalPath.invalidDependencyIds,
      issues: criticalPath.issues,
      cycles: criticalPath.cycles,
      counts,
    },
  };
}
