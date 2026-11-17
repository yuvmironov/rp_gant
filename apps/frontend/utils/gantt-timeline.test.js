import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  createGanttTimelineScale,
  dateOnlyToUtcDay,
  dateToTimelinePercent,
  inclusiveDateIntervalPercent,
  timelineTicks,
} from './gantt-timeline.js';

describe('Gantt timeline scale', () => {
  const today = new Date('2026-11-17T16:45:00.000Z');

  it('normalizes timestamp and date-only values to UTC calendar days', () => {
    expect(dateOnlyToUtcDay('2026-11-18T00:00:00.000Z')).toBe(Date.UTC(2026, 10, 18));
    expect(dateOnlyToUtcDay(new Date('2026-11-17T16:45:00.000Z'))).toBe(
      Date.UTC(2026, 10, 17),
    );
    expect(dateOnlyToUtcDay('2026-02-30')).toBeNull();
    expect(dateOnlyToUtcDay(null)).toBeNull();
  });

  it('starts at the beginning of today and includes the whole final scheduled day', () => {
    const scale = createGanttTimelineScale(
      [{ startDate: '2026-11-18T00:00:00.000Z', endDate: '2026-11-20' }],
      [],
      today,
    );

    expect(scale.min).toBe(Date.UTC(2026, 10, 17));
    expect(scale.max).toBe(Date.UTC(2026, 10, 24));
    expect(scale.dayCount).toBe(7);
    expect(dateToTimelinePercent(today, scale)).toBe(0);
  });

  it('uses one full day for an inclusive single-day task', () => {
    const scale = createGanttTimelineScale(
      [{ startDate: '2026-11-18', endDate: '2026-11-18' }],
      [],
      today,
    );

    const bar = inclusiveDateIntervalPercent('2026-11-18', '2026-11-18', scale);

    expect(bar.left).toBeCloseTo((DAY_MS / scale.span) * 100, 8);
    expect(bar.width).toBeCloseTo((DAY_MS / scale.span) * 100, 8);
  });

  it('uses the full number of inclusive days for multi-day intervals', () => {
    const scale = createGanttTimelineScale([], [], today);
    const oneDay = inclusiveDateIntervalPercent('2026-11-18', '2026-11-18', scale);
    const twoDays = inclusiveDateIntervalPercent('2026-11-18', '2026-11-19', scale);

    expect(twoDays.width).toBeCloseTo(oneDay.width * 2, 8);
  });

  it('includes direction-only dates in the scale and covers every day with aligned ticks', () => {
    const scale = createGanttTimelineScale(
      [],
      [{ startDate: '2026-11-18', endDate: '2026-12-04' }],
      today,
    );
    const ticks = timelineTicks(scale);

    expect(scale.max).toBe(Date.UTC(2026, 11, 5));
    expect(ticks[0].left).toBe(0);
    expect(ticks.at(-1).left + ticks.at(-1).width).toBeCloseTo(100, 8);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });

  it('keeps a readable empty-plan range', () => {
    const scale = createGanttTimelineScale([], [], today);

    expect(scale.dayCount).toBe(30);
  });
});
