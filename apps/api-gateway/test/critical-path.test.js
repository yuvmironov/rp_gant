import { describe, expect, it } from 'vitest';
import { applySchedule } from '../src/gantt-schedule.js';

describe('critical path snapshot fields', () => {
  it('returns calendar-aware task, direction, dependency and total path metrics', () => {
    const snapshot = {
      diagram: { dayMode: 'working' },
      directions: [
        {
          id: 'direction-1',
          startDate: '2026-11-06',
          endDate: '2026-11-30',
          status: 'planned',
          progress: 0,
        },
      ],
      tasks: [
        {
          id: 'first',
          directionId: 'direction-1',
          parentTaskId: null,
          startDate: '2026-11-06',
          endDate: '2026-11-11',
          status: 'planned',
          progress: 0,
        },
        {
          id: 'second',
          directionId: 'direction-1',
          parentTaskId: null,
          startDate: '2026-11-12',
          endDate: '2026-11-13',
          status: 'planned',
          progress: 0,
        },
        {
          id: 'parallel',
          directionId: 'direction-1',
          parentTaskId: null,
          startDate: '2026-11-06',
          endDate: '2026-11-10',
          status: 'planned',
          progress: 0,
        },
      ],
      dependencies: [
        {
          id: 'first-second',
          predecessorType: 'task',
          predecessorId: 'first',
          successorType: 'task',
          successorId: 'second',
        },
      ],
    };

    const result = applySchedule(snapshot, 'working', [{ holidayDate: '2026-11-10' }]);

    expect(result.schedule.calculationStatus).toBe('complete');
    expect(result.schedule.criticalPathDurationDays).toBe(5);
    expect(result.schedule.criticalTaskIds).toEqual(['first', 'second']);
    expect(result.tasks.find((task) => task.id === 'first')).toMatchObject({
      float: 0,
      isCritical: true,
    });
    expect(result.tasks.find((task) => task.id === 'parallel')).toMatchObject({
      float: 3,
      isCritical: false,
    });
    expect(result.directions[0]).toMatchObject({ float: 0, isCritical: true });
    expect(result.dependencies[0].isCritical).toBe(true);
  });
});
