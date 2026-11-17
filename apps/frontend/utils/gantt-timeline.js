export const DAY_MS = 86_400_000;

export function dateOnlyToUtcDay(value) {
  if (!value) return null;

  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  const dateOnly =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : typeof value === 'string'
        ? value.slice(0, 10)
        : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;

  const [year, month, day] = dateOnly.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return new Date(timestamp).toISOString().slice(0, 10) === dateOnly ? timestamp : null;
}

export function createGanttTimelineScale(tasks = [], directions = [], today = new Date()) {
  const todayDay = dateOnlyToUtcDay(today) ?? dateOnlyToUtcDay(new Date());
  let min = todayDay;
  let latestDay = todayDay;
  let hasScheduleDates = false;

  for (const item of [...tasks, ...directions]) {
    for (const value of [
      item.startDate,
      item.effectiveEndDate ?? item.endDate,
    ]) {
      const date = dateOnlyToUtcDay(value);
      if (date === null) continue;
      hasScheduleDates = true;
      min = Math.min(min, date);
      latestDay = Math.max(latestDay, date);
    }
  }

  const minimumDays = hasScheduleDates ? 7 : 30;
  const max = Math.max(latestDay + DAY_MS, min + minimumDays * DAY_MS);
  const span = max - min;

  return { min, max, span, dayCount: span / DAY_MS };
}

export function dateToTimelinePercent(value, scale) {
  const date = dateOnlyToUtcDay(value);
  if (date === null || !scale?.span) return null;
  return ((date - scale.min) / scale.span) * 100;
}

export function inclusiveDateIntervalPercent(startValue, endValue, scale) {
  const start = dateOnlyToUtcDay(startValue);
  const end = dateOnlyToUtcDay(endValue);
  if (start === null || end === null || end < start || !scale?.span) return null;

  const left = ((start - scale.min) / scale.span) * 100;
  const right = ((end + DAY_MS - scale.min) / scale.span) * 100;
  return { left, width: right - left };
}

export function timelineTicks(scale, maxTickCount = 7) {
  if (!scale?.dayCount || maxTickCount < 1) return [];

  const intervalDays = Math.max(1, Math.ceil(scale.dayCount / maxTickCount));
  const ticks = [];
  for (let start = scale.min; start < scale.max; start += intervalDays * DAY_MS) {
    const endExclusive = Math.min(start + intervalDays * DAY_MS, scale.max);
    const lastDay = endExclusive - DAY_MS;
    const startLabel = formatAxisDate(start);
    const endLabel = formatAxisDate(lastDay);
    ticks.push({
      key: start,
      label: startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`,
      left: ((start - scale.min) / scale.span) * 100,
      width: ((endExclusive - start) / scale.span) * 100,
    });
  }
  return ticks;
}

function formatAxisDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}
