import { describe, expect, it } from 'vitest';
import { calculateCriticalPath, countScheduleDays } from '../src/critical-path.js';

const estimatedTask = (id, estimatedHours, extra = {}) => ({
  id,
  directionId: 'direction-1',
  parentTaskId: null,
  estimatedHours,
  ...extra,
});

const oneDirection = { id: 'direction-1' };

describe('critical path', () => {
  it('calculates inclusive calendar and working durations with holidays', () => {
    expect(countScheduleDays('2026-11-06', '2026-11-09', 'calendar')).toBe(4);
    expect(
      countScheduleDays('2026-11-06', '2026-11-11', 'working', [{ holidayDate: '2026-11-10' }]),
    ).toBe(3);
  });

  it('finds the longest task route and total float for parallel work', () => {
    const result = calculateCriticalPath({
      directions: [oneDirection],
      tasks: [estimatedTask('a', 16), estimatedTask('b', 16), estimatedTask('c', 24)],
      dependencies: [
        {
          id: 'a-b',
          predecessorType: 'task',
          predecessorId: 'a',
          successorType: 'task',
          successorId: 'b',
        },
      ],
    });

    expect(result.calculationStatus).toBe('complete');
    expect(result.criticalPathDurationDays).toBe(4);
    expect(result.criticalTaskIds).toEqual(['a', 'b']);
    expect(result.criticalDependencyIds).toEqual(['a-b']);
    expect(result.taskMetrics.find((task) => task.id === 'c')).toMatchObject({
      float: 1,
      isCritical: false,
    });
  });

  it('uses working-day durations and excludes holidays from the path length', () => {
    const result = calculateCriticalPath({
      dayMode: 'working',
      holidays: [{ holidayDate: '2026-11-10' }],
      directions: [oneDirection],
      tasks: [
        {
          id: 'work',
          directionId: 'direction-1',
          startDate: '2026-11-06',
          endDate: '2026-11-11',
        },
        estimatedTask('short', 8),
      ],
    });

    expect(result.criticalPathDurationDays).toBe(3);
    expect(result.criticalTaskIds).toEqual(['work']);
  });

  it('treats directions as aggregate start and finish constraints', () => {
    const result = calculateCriticalPath({
      directions: [{ id: 'before' }, { id: 'after' }],
      tasks: [
        estimatedTask('before-a', 8, { directionId: 'before' }),
        estimatedTask('before-b', 24, { directionId: 'before' }),
        estimatedTask('after-a', 16, { directionId: 'after' }),
        estimatedTask('after-b', 8, { directionId: 'after' }),
      ],
      dependencies: [
        {
          id: 'direction-link',
          predecessorType: 'direction',
          predecessorId: 'before',
          successorType: 'direction',
          successorId: 'after',
        },
      ],
    });

    expect(result.criticalPathDurationDays).toBe(5);
    expect(result.criticalTaskIds).toEqual(['before-b', 'after-a']);
    expect(result.criticalDependencyIds).toEqual(['direction-link']);
  });

  it('makes task-to-direction dependencies constrain all successor work', () => {
    const result = calculateCriticalPath({
      directions: [{ id: 'source' }, { id: 'target' }],
      tasks: [
        estimatedTask('prerequisite', 16, { directionId: 'source' }),
        estimatedTask('target-a', 8, { directionId: 'target' }),
        estimatedTask('target-b', 16, { directionId: 'target' }),
      ],
      dependencies: [
        {
          id: 'task-direction',
          predecessorType: 'task',
          predecessorId: 'prerequisite',
          successorType: 'direction',
          successorId: 'target',
        },
      ],
    });

    expect(result.criticalPathDurationDays).toBe(4);
    expect(result.criticalTaskIds).toEqual(['prerequisite', 'target-b']);
    expect(result.criticalDependencyIds).toEqual(['task-direction']);
  });

  it('counts leaf work once and propagates summary-task constraints to descendants', () => {
    const result = calculateCriticalPath({
      directions: [oneDirection],
      tasks: [
        estimatedTask('parent', 0),
        estimatedTask('short-child', 8, { parentTaskId: 'parent' }),
        estimatedTask('long-child', 16, { parentTaskId: 'parent' }),
        estimatedTask('successor', 16),
      ],
      dependencies: [
        {
          id: 'parent-successor',
          predecessorType: 'task',
          predecessorId: 'parent',
          successorType: 'task',
          successorId: 'successor',
        },
      ],
    });

    expect(result.criticalPathDurationDays).toBe(4);
    expect(result.criticalTaskIds).toEqual(['long-child', 'successor']);
    expect(result.taskMetrics.find((task) => task.id === 'parent')).toMatchObject({
      isCritical: true,
      float: 0,
    });
    expect(result.criticalTaskIds).not.toContain('parent');
  });

  it('uses estimated hours when dates are incomplete and marks unknown work as incomplete', () => {
    const result = calculateCriticalPath({
      directions: [oneDirection],
      tasks: [estimatedTask('estimated', 9), { id: 'unknown', directionId: 'direction-1' }],
    });

    expect(result.calculationStatus).toBe('incomplete');
    expect(result.criticalPathDurationDays).toBeNull();
    expect(result.unknownDurationTaskIds).toEqual(['unknown']);
    expect(result.criticalTaskIds).toEqual([]);
    expect(result.taskMetrics.every((task) => task.float === null && !task.isCritical)).toBe(true);
  });

  it('reports invalid dates and work intervals without working days', () => {
    const result = calculateCriticalPath({
      dayMode: 'working',
      directions: [oneDirection],
      tasks: [
        {
          id: 'bad-date',
          directionId: 'direction-1',
          startDate: '2026-02-31',
          endDate: '2026-03-02',
        },
        {
          id: 'weekend-only',
          directionId: 'direction-1',
          startDate: '2026-11-07',
          endDate: '2026-11-08',
        },
      ],
    });

    expect(result.calculationStatus).toBe('incomplete');
    expect(result.unknownDurationTaskIds).toEqual(['bad-date', 'weekend-only']);
    expect(result.issues).toEqual([
      { code: 'invalid_date_range', taskIds: ['bad-date'] },
      { code: 'no_working_days', taskIds: ['weekend-only'] },
    ]);
    expect(result.criticalTaskIds).toEqual([]);
  });

  it('returns no critical path when a cycle is present', () => {
    const result = calculateCriticalPath({
      directions: [oneDirection],
      tasks: [estimatedTask('a', 8), estimatedTask('b', 8)],
      dependencies: [
        {
          id: 'a-b',
          predecessorType: 'task',
          predecessorId: 'a',
          successorType: 'task',
          successorId: 'b',
        },
        {
          id: 'b-a',
          predecessorType: 'task',
          predecessorId: 'b',
          successorType: 'task',
          successorId: 'a',
        },
      ],
    });

    expect(result.calculationStatus).toBe('cycle');
    expect(result.cycles).toEqual(['dependency_cycle']);
    expect(result.criticalPathDurationDays).toBeNull();
    expect(result.criticalTaskIds).toEqual([]);
    expect(result.taskMetrics.every((task) => task.float === null && !task.isCritical)).toBe(true);
  });

  it('rejects unsupported direction-to-task edges from calculation', () => {
    const result = calculateCriticalPath({
      directions: [{ id: 'direction-1' }],
      tasks: [estimatedTask('task', 8)],
      dependencies: [
        {
          id: 'unsupported',
          predecessorType: 'direction',
          predecessorId: 'direction-1',
          successorType: 'task',
          successorId: 'task',
        },
      ],
    });

    expect(result.calculationStatus).toBe('invalid');
    expect(result.invalidDependencyIds).toEqual(['unsupported']);
    expect(result.criticalTaskIds).toEqual([]);
  });

  it('does not mark a non-controlling dependency critical just because both tasks are critical', () => {
    const result = calculateCriticalPath({
      directions: [oneDirection],
      tasks: [
        estimatedTask('a', 80),
        estimatedTask('a-tail', 160),
        estimatedTask('b-source', 160),
        estimatedTask('b', 80),
      ],
      dependencies: [
        {
          id: 'a-tail-link',
          predecessorType: 'task',
          predecessorId: 'a',
          successorType: 'task',
          successorId: 'a-tail',
        },
        {
          id: 'b-source-link',
          predecessorType: 'task',
          predecessorId: 'b-source',
          successorType: 'task',
          successorId: 'b',
        },
        {
          id: 'non-controlling-link',
          predecessorType: 'task',
          predecessorId: 'a',
          successorType: 'task',
          successorId: 'b',
        },
      ],
    });

    expect(result.criticalPathDurationDays).toBe(30);
    expect(result.criticalTaskIds).toEqual(['a', 'a-tail', 'b-source', 'b']);
    expect(result.criticalDependencyIds).toEqual(['a-tail-link', 'b-source-link']);
  });
});
