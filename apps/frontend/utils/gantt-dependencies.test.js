import { describe, expect, it } from 'vitest';
import {
  buildDependencyLines,
  pathIntersectsRects,
  routeDependency,
} from './gantt-dependencies.js';

const source = { id: 'source', left: 10, right: 42, top: 8, bottom: 36 };
const target = { id: 'target', left: 238, right: 270, top: 160, bottom: 188 };
const blocker = { id: 'blocker', left: 100, right: 174, top: 74, bottom: 102 };

function route(shape = 'orthogonal', from = source, to = target, obstacles = [from, to, blocker]) {
  return routeDependency({
    source: from,
    target: to,
    obstacles,
    canvasWidth: 300,
    canvasHeight: 220,
    shape,
  });
}

describe('Gantt dependency routing', () => {
  it('routes a long orthogonal dependency around intermediate task bars', () => {
    const result = route();

    expect(result.mode).toBe('orthogonal');
    expect(result.overlapsBars).toBe(false);
    expect(pathIntersectsRects(result.points, [blocker])).toBe(false);
  });

  it('keeps long curved dependencies curved while avoiding intermediate bars', () => {
    const result = route('curved');

    expect(result.mode).toBe('curved');
    expect(result.path).toContain('Q');
    expect(result.overlapsBars).toBe(false);
    expect(pathIntersectsRects(result.points, [blocker])).toBe(false);
  });

  it('preserves an explicitly straight link and reports when it crosses a bar', () => {
    const result = route('straight');

    expect(result.mode).toBe('straight');
    expect(result.path).toMatch(/^M .* L /);
    expect(result.overlapsBars).toBe(true);
  });

  it('keeps a visible fallback when obstacles leave no collision-free orthogonal route', () => {
    const from = { id: 'from', left: 10, right: 42, top: 8, bottom: 36 };
    const to = { id: 'to', left: 238, right: 270, top: 160, bottom: 188 };
    const wall = { id: 'wall', left: 0, right: 300, top: 38, bottom: 156 };
    const result = route('orthogonal', from, to, [from, to, wall]);

    expect(result.mode).toBe('fallback-visible');
    expect(result.overlapsBars).toBe(true);
  });

  it('routes links to a row above the source with the arrow pointing upward', () => {
    const from = { id: 'from', left: 100, right: 140, top: 84, bottom: 112 };
    const to = { id: 'to', left: 100, right: 140, top: 8, bottom: 36 };
    const result = route('orthogonal', from, to, [from, to]);

    expect(result.mode).toBe('orthogonal');
    expect(result.points[0].y).toBeGreaterThan(result.points.at(-1).y);
    expect(result.overlapsBars).toBe(false);
  });

  it('routes touching bars through the gap between their rows', () => {
    const from = { id: 'from', left: 100, right: 140, top: 8, bottom: 36 };
    const to = { id: 'to', left: 140, right: 180, top: 46, bottom: 74 };
    const result = route('orthogonal', from, to, [from, to]);

    expect(result.mode).toBe('orthogonal');
    expect(result.points[0].y).toBe(38);
    expect(result.points.at(-1).y).toBe(44);
    expect(result.overlapsBars).toBe(false);
  });

  it('routes overlapping dates without crossing the source or target bars', () => {
    const from = { id: 'from', left: 150, right: 230, top: 8, bottom: 36 };
    const to = { id: 'to', left: 90, right: 210, top: 84, bottom: 112 };
    const result = route('orthogonal', from, to, [from, to, blocker]);

    expect(result.mode).toBe('orthogonal');
    expect(result.overlapsBars).toBe(false);
    expect(pathIntersectsRects(result.points, [from, to, blocker])).toBe(false);
  });
});

describe('dependency endpoint visibility', () => {
  const task = (id, parentTaskId = null, directionId = 'direction') => ({
    id,
    parentTaskId,
    directionId,
    name: id,
  });
  const row = (type, id, index, entity) => ({
    type,
    key: `${type}-${id}`,
    index,
    ...(type === 'task' ? { task: entity } : { direction: entity }),
  });
  const bar = (entity, top, left = '0%', width = '20%') => ({
    task: entity,
    style: { top: `${top}px`, left, width },
  });

  it('maps a collapsed child dependency endpoint to its visible summary task', () => {
    const parent = task('parent');
    const child = task('child', 'parent');
    const successor = task('successor');
    const result = buildDependencyLines({
      dependencies: [{
        id: 'dependency',
        predecessorType: 'task',
        predecessorId: child.id,
        successorType: 'task',
        successorId: successor.id,
        arrowShape: 'orthogonal',
      }],
      tasks: [parent, child, successor],
      directions: [{ id: 'direction' }],
      rows: [row('direction', 'direction', 0, { id: 'direction' }), row('task', parent.id, 1, parent), row('task', successor.id, 2, successor)],
      taskBars: [bar(parent, 46), bar(successor, 84, '60%')],
      directionBars: [],
      directionAnchors: [{ direction: { id: 'direction' }, style: { top: '8px', left: '0%', width: '0%' } }],
      canvasWidth: 300,
      canvasHeight: 320,
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].sourceKey).toBe('task:parent');
  });

  it('reports links hidden by an active filter instead of silently dropping them', () => {
    const sourceTask = task('filtered');
    const targetTask = task('visible');
    const result = buildDependencyLines({
      dependencies: [{
        id: 'dependency',
        predecessorType: 'task',
        predecessorId: sourceTask.id,
        successorType: 'task',
        successorId: targetTask.id,
      }],
      tasks: [sourceTask, targetTask],
      directions: [{ id: 'direction' }],
      rows: [row('direction', 'direction', 0, { id: 'direction' }), row('task', targetTask.id, 1, targetTask)],
      taskBars: [bar(targetTask, 46, '50%')],
      directionBars: [],
      directionAnchors: [{ direction: { id: 'direction' }, style: { top: '8px', left: '0%', width: '0%' } }],
      canvasWidth: 300,
      canvasHeight: 320,
      filtering: true,
      matchedTaskIds: new Set([targetTask.id]),
    });

    expect(result.lines).toHaveLength(0);
    expect(result.filteredOutCount).toBe(1);
  });

  it('supports task-to-direction links when the direction has no date interval', () => {
    const sourceTask = task('source');
    const direction = { id: 'direction' };
    const result = buildDependencyLines({
      dependencies: [{
        id: 'task-to-direction',
        predecessorType: 'task',
        predecessorId: sourceTask.id,
        successorType: 'direction',
        successorId: direction.id,
        lineStyle: 'dashed',
        arrowShape: 'curved',
      }],
      tasks: [sourceTask],
      directions: [direction],
      rows: [row('direction', direction.id, 0, direction), row('task', sourceTask.id, 1, sourceTask)],
      taskBars: [bar(sourceTask, 46, '45%', '25%')],
      directionBars: [],
      directionAnchors: [{ direction, style: { top: '8px', left: '0%', width: '0%' } }],
      canvasWidth: 300,
      canvasHeight: 320,
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].targetKey).toBe('direction:direction');
    expect(result.lines[0].dash).toBe('dashed');
    expect(result.lines[0].shape).toBe('curved');
  });

  it('offsets parallel links so their paths do not completely overlap', () => {
    const sourceTask = task('source');
    const targetTask = task('target');
    const result = buildDependencyLines({
      dependencies: ['one', 'two'].map((id) => ({
        id,
        predecessorType: 'task',
        predecessorId: sourceTask.id,
        successorType: 'task',
        successorId: targetTask.id,
      })),
      tasks: [sourceTask, targetTask],
      directions: [{ id: 'direction' }],
      rows: [row('direction', 'direction', 0, { id: 'direction' }), row('task', sourceTask.id, 1, sourceTask), row('task', targetTask.id, 2, targetTask)],
      taskBars: [bar(sourceTask, 46, '0%'), bar(targetTask, 84, '60%')],
      directionBars: [],
      directionAnchors: [{ direction: { id: 'direction' }, style: { top: '8px', left: '0%', width: '0%' } }],
      canvasWidth: 300,
      canvasHeight: 320,
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].path).not.toBe(result.lines[1].path);
  });

  it('separates fan-out links that share a source but have different targets', () => {
    const sourceTask = task('source');
    const firstTarget = task('first-target');
    const secondTarget = task('second-target');
    const result = buildDependencyLines({
      dependencies: [firstTarget, secondTarget].map((target) => ({
        id: `from-source-to-${target.id}`,
        predecessorType: 'task',
        predecessorId: sourceTask.id,
        successorType: 'task',
        successorId: target.id,
      })),
      tasks: [sourceTask, firstTarget, secondTarget],
      directions: [{ id: 'direction' }],
      rows: [
        row('direction', 'direction', 0, { id: 'direction' }),
        row('task', sourceTask.id, 1, sourceTask),
        row('task', firstTarget.id, 2, firstTarget),
        row('task', secondTarget.id, 3, secondTarget),
      ],
      taskBars: [
        bar(sourceTask, 46),
        bar(firstTarget, 84, '60%'),
        bar(secondTarget, 122, '60%'),
      ],
      directionBars: [],
      directionAnchors: [{ direction: { id: 'direction' }, style: { top: '8px', left: '0%', width: '0%' } }],
      canvasWidth: 300,
      canvasHeight: 320,
    });
    const startY = result.lines.map((line) => Number(line.path.match(/^M [^ ]+ ([^ ]+)/)?.[1]));

    expect(result.lines).toHaveLength(2);
    expect(new Set(startY).size).toBe(2);
  });

  it('separates fan-in links that share a target but have different sources', () => {
    const firstSource = task('first-source');
    const secondSource = task('second-source');
    const targetTask = task('target');
    const result = buildDependencyLines({
      dependencies: [firstSource, secondSource].map((source) => ({
        id: `from-${source.id}-to-target`,
        predecessorType: 'task',
        predecessorId: source.id,
        successorType: 'task',
        successorId: targetTask.id,
      })),
      tasks: [firstSource, secondSource, targetTask],
      directions: [{ id: 'direction' }],
      rows: [
        row('direction', 'direction', 0, { id: 'direction' }),
        row('task', firstSource.id, 1, firstSource),
        row('task', secondSource.id, 2, secondSource),
        row('task', targetTask.id, 3, targetTask),
      ],
      taskBars: [
        bar(firstSource, 46),
        bar(secondSource, 84),
        bar(targetTask, 122, '60%'),
      ],
      directionBars: [],
      directionAnchors: [{ direction: { id: 'direction' }, style: { top: '8px', left: '0%', width: '0%' } }],
      canvasWidth: 300,
      canvasHeight: 320,
    });
    const endY = result.lines.map((line) => Number(line.path.match(/ ([^ ]+) ([^ ]+)$/)?.[2]));

    expect(result.lines).toHaveLength(2);
    expect(new Set(endY).size).toBe(2);
  });

  it('moves a link away from an overlapping segment with unrelated endpoints', () => {
    const longSource = task('long-source');
    const shortSource = task('short-source');
    const shortTarget = task('short-target');
    const longTarget = task('long-target');
    const result = buildDependencyLines({
      dependencies: [
        {
          id: 'long-straight',
          predecessorType: 'task',
          predecessorId: longSource.id,
          successorType: 'task',
          successorId: longTarget.id,
          arrowShape: 'straight',
        },
        {
          id: 'short-orthogonal',
          predecessorType: 'task',
          predecessorId: shortSource.id,
          successorType: 'task',
          successorId: shortTarget.id,
          arrowShape: 'orthogonal',
        },
      ],
      tasks: [longSource, shortSource, shortTarget, longTarget],
      directions: [{ id: 'direction' }],
      rows: [
        row('direction', 'direction', 0, { id: 'direction' }),
        row('task', longSource.id, 1, longSource),
        row('task', shortSource.id, 2, shortSource),
        row('task', shortTarget.id, 3, shortTarget),
        row('task', longTarget.id, 4, longTarget),
      ],
      taskBars: [
        bar(longSource, 46, '26.667%', '13.333%'),
        bar(shortSource, 84, '20%', '13.333%'),
        bar(shortTarget, 122, '33.333%', '13.333%'),
        bar(longTarget, 160, '26.667%', '13.333%'),
      ],
      directionBars: [],
      directionAnchors: [{ direction: { id: 'direction' }, style: { top: '8px', left: '0%', width: '0%' } }],
      canvasWidth: 300,
      canvasHeight: 320,
    });
    const shortStartX = Number(result.lines[1].path.match(/^M ([^ ]+)/)?.[1]);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[1].laneOffset).not.toBe(0);
    expect(shortStartX).not.toBeCloseTo(120);
  });

  it('uses a row anchor for a direction without dates and skips the forbidden direction-to-task edge', () => {
    const targetTask = task('target');
    const direction = { id: 'direction' };
    const result = buildDependencyLines({
      dependencies: [
        { id: 'allowed', predecessorType: 'direction', predecessorId: direction.id, successorType: 'direction', successorId: 'other' },
        { id: 'forbidden', predecessorType: 'direction', predecessorId: direction.id, successorType: 'task', successorId: targetTask.id },
      ],
      tasks: [targetTask],
      directions: [direction, { id: 'other' }],
      rows: [row('direction', direction.id, 0, direction), row('direction', 'other', 2, { id: 'other' }), row('task', targetTask.id, 1, targetTask)],
      taskBars: [bar(targetTask, 46, '60%')],
      directionBars: [],
      directionAnchors: [
        { direction, style: { top: '8px', left: '0%', width: '0%' } },
        { direction: { id: 'other' }, style: { top: '84px', left: '0%', width: '0%' } },
      ],
      canvasWidth: 300,
      canvasHeight: 320,
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].sourceKey).toBe('direction:direction');
    expect(result.unresolvedCount).toBe(1);
  });
});
