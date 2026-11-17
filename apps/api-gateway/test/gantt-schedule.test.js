import { describe, expect, it } from 'vitest';
import { applySchedule } from '../src/gantt-schedule.js';

describe('Gantt schedule end dates', () => {
  it('recalculates a direction end from descendants when the latest task is shortened', () => {
    const snapshot = {
      diagram: { dayMode: 'DAY_MODE_WORKING' },
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
          id: 'parent',
          directionId: 'direction-1',
          parentTaskId: null,
          startDate: '2026-11-06',
          endDate: '2026-11-29',
          status: 'planned',
          progress: 0,
        },
        {
          id: 'child-1',
          directionId: 'direction-1',
          parentTaskId: 'parent',
          startDate: '2026-11-10',
          endDate: '2026-11-18',
          status: 'planned',
          progress: 0,
        },
        {
          id: 'child-2',
          directionId: 'direction-1',
          parentTaskId: 'parent',
          startDate: '2026-11-10',
          endDate: '2026-11-24',
          status: 'planned',
          progress: 0,
        },
      ],
      dependencies: [],
    };

    const initial = applySchedule(snapshot, 'working', []);
    expect(initial.directions[0].endDate).toBe('2026-11-24');
    expect(initial.tasks.find((task) => task.id === 'parent').effectiveEndDate).toBe('2026-11-24');

    snapshot.tasks.find((task) => task.id === 'child-2').endDate = '2026-11-15';
    const shortened = applySchedule(snapshot, 'working', []);

    expect(shortened.directions[0].endDate).toBe('2026-11-18');
    expect(shortened.directions[0].days).toBe(9);
    expect(shortened.tasks.find((task) => task.id === 'parent').effectiveEndDate).toBe(
      '2026-11-18',
    );
    expect(snapshot.directions[0].endDate).toBe('2026-11-30');
  });

  it('retains the stored end for a direction with no tasks', () => {
    const result = applySchedule(
      {
        diagram: { dayMode: 'calendar' },
        directions: [
          {
            id: 'direction-1',
            startDate: '2026-11-06',
            endDate: '2026-11-30',
          },
        ],
        tasks: [],
        dependencies: [],
      },
      'calendar',
      [],
    );

    expect(result.directions[0].endDate).toBe('2026-11-30');
    expect(result.directions[0].days).toBe(25);
  });

  it('ignores stored direction and parent ends when descendants have no end dates', () => {
    const result = applySchedule(
      {
        diagram: { dayMode: 'calendar' },
        directions: [
          {
            id: 'direction-1',
            startDate: '2026-11-06',
            endDate: '2026-11-30',
          },
        ],
        tasks: [
          {
            id: 'parent',
            directionId: 'direction-1',
            startDate: '2026-11-06',
            endDate: '2026-11-29',
            status: 'planned',
            progress: 0,
          },
          {
            id: 'child',
            directionId: 'direction-1',
            parentTaskId: 'parent',
            startDate: '2026-11-10',
            endDate: null,
            status: 'planned',
            progress: 0,
          },
        ],
        dependencies: [],
      },
      'calendar',
      [],
    );

    expect(result.directions[0].endDate).toBeNull();
    expect(result.directions[0].days).toBe(0);
    expect(result.tasks.find((task) => task.id === 'parent').effectiveEndDate).toBeNull();
  });
});
