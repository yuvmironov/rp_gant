export const GANTT_BAR_HEIGHT = 28;
export const GANTT_ROW_HEIGHT = 38;

const ROUTE_CLEARANCE = 2;
const PORT_GAP = 2;
const CURVE_RADIUS = 6;
const DEPENDENCY_LANE_SPACING = 16;
const ROUTE_OVERLAP_TOLERANCE = 1.5;
const EPSILON = 0.001;

function finiteRect(rect) {
  return (
    rect &&
    [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) &&
    rect.right >= rect.left &&
    rect.bottom >= rect.top
  );
}

function centerX(rect) {
  return (rect.left + rect.right) / 2;
}

function centerY(rect) {
  return (rect.top + rect.bottom) / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function expandRect(rect, padding) {
  return {
    left: rect.left - padding,
    right: rect.right + padding,
    top: rect.top - padding,
    bottom: rect.bottom + padding,
  };
}

function pointKey(point) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

function addPoint(map, point, bounds) {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x > bounds.width ||
    point.y > bounds.height
  ) {
    return;
  }
  const key = pointKey(point);
  if (!map.has(key)) map.set(key, { x: point.x, y: point.y, key });
}

function segmentIntersectsRect(start, end, rect) {
  const left = rect.left + EPSILON;
  const right = rect.right - EPSILON;
  const top = rect.top + EPSILON;
  const bottom = rect.bottom - EPSILON;
  if (left >= right || top >= bottom) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  for (const [p, q] of [
    [-dx, start.x - left],
    [dx, right - start.x],
    [-dy, start.y - top],
    [dy, bottom - start.y],
  ]) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return false;
  }
  return maximum > EPSILON && minimum < 1 - EPSILON;
}

function segmentBlocked(start, end, obstacles) {
  return obstacles.some((rect) => segmentIntersectsRect(start, end, rect));
}

function makePorts(source, target, laneOffset) {
  const verticalOverlap = Math.min(source.right, target.right) - Math.max(source.left, target.left);
  const sameOrCloseX = verticalOverlap >= -8;
  const sourceCenterX = centerX(source);
  const targetCenterX = centerX(target);

  if (sameOrCloseX && Math.abs(centerY(source) - centerY(target)) > EPSILON) {
    const sharedLeft = Math.max(source.left, target.left);
    const sharedRight = Math.min(source.right, target.right);
    const sharedCenterX = (sharedLeft + sharedRight) / 2;
    const hasNarrowSharedPort =
      sharedLeft <= sharedRight && Math.abs(laneOffset) > (sharedRight - sharedLeft) / 2;
    const sourceX = hasNarrowSharedPort
      ? clamp(sharedCenterX - laneOffset, source.left, source.right)
      : sharedLeft <= sharedRight
        ? clamp(sharedCenterX + laneOffset, sharedLeft, sharedRight)
        : clamp((sourceCenterX + targetCenterX) / 2 + laneOffset, source.left, source.right);
    const targetX = hasNarrowSharedPort
      ? clamp(sharedCenterX + laneOffset, target.left, target.right)
      : sharedLeft <= sharedRight
        ? clamp(sourceX, sharedLeft, sharedRight)
        : clamp(sourceX, target.left, target.right);
    const targetBelow = centerY(target) > centerY(source);
    const sourceY = targetBelow ? source.bottom : source.top;
    const targetY = targetBelow ? target.top : target.bottom;
    const direction = targetBelow ? 1 : -1;
    return {
      source: { x: sourceX, y: sourceY },
      target: { x: targetX, y: targetY },
      start: { x: sourceX, y: sourceY + direction * PORT_GAP },
      end: { x: targetX, y: targetY - direction * PORT_GAP },
      routeStart: { x: sourceX, y: sourceY + direction * (PORT_GAP + ROUTE_CLEARANCE) },
      routeEnd: { x: targetX, y: targetY - direction * (PORT_GAP + ROUTE_CLEARANCE) },
    };
  }

  const forward = targetCenterX >= sourceCenterX;
  const sourceOnRight = forward;
  const targetOnLeft = forward;
  const sourceY = clamp(centerY(source) + laneOffset, source.top, source.bottom);
  const targetY = clamp(centerY(target) + laneOffset, target.top, target.bottom);
  const sourceX = sourceOnRight ? source.right : source.left;
  const targetX = targetOnLeft ? target.left : target.right;
  const direction = sourceOnRight ? 1 : -1;
  const targetDirection = targetOnLeft ? -1 : 1;

  return {
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    start: { x: sourceX + direction * PORT_GAP, y: sourceY },
    end: { x: targetX + targetDirection * PORT_GAP, y: targetY },
    routeStart: { x: sourceX + direction * (PORT_GAP + ROUTE_CLEARANCE), y: sourceY },
    routeEnd: { x: targetX + targetDirection * (PORT_GAP + ROUTE_CLEARANCE), y: targetY },
  };
}

function buildVisibilityGraph(start, end, obstacles, bounds) {
  const nodesByKey = new Map();
  addPoint(nodesByKey, start, bounds);
  addPoint(nodesByKey, end, bounds);

  const corners = [];
  for (const rect of obstacles) {
    corners.push(
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    );
  }

  for (const corner of corners) {
    addPoint(nodesByKey, corner, bounds);
    addPoint(nodesByKey, { x: corner.x, y: start.y }, bounds);
    addPoint(nodesByKey, { x: start.x, y: corner.y }, bounds);
    addPoint(nodesByKey, { x: corner.x, y: end.y }, bounds);
    addPoint(nodesByKey, { x: end.x, y: corner.y }, bounds);
  }

  const nodes = [...nodesByKey.values()];
  const indexByKey = new Map(nodes.map((node, index) => [node.key, index]));
  const adjacency = nodes.map(() => []);
  const groups = new Map();

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const xKey = `x:${node.x.toFixed(3)}`;
    const yKey = `y:${node.y.toFixed(3)}`;
    for (const key of [xKey, yKey]) {
      const group = groups.get(key) ?? [];
      group.push(index);
      groups.set(key, group);
    }
  }

  for (const [key, indexes] of groups) {
    const horizontal = key.startsWith('y:');
    indexes.sort((a, b) =>
      horizontal ? nodes[a].x - nodes[b].x : nodes[a].y - nodes[b].y,
    );
    for (let position = 1; position < indexes.length; position += 1) {
      const firstIndex = indexes[position - 1];
      const secondIndex = indexes[position];
      const first = nodes[firstIndex];
      const second = nodes[secondIndex];
      if (segmentBlocked(first, second, obstacles)) continue;
      const distance = Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
      adjacency[firstIndex].push({ to: secondIndex, distance, direction: horizontal ? 'h' : 'v' });
      adjacency[secondIndex].push({ to: firstIndex, distance, direction: horizontal ? 'h' : 'v' });
    }
  }

  return {
    nodes,
    adjacency,
    startIndex: indexByKey.get(pointKey(start)),
    endIndex: indexByKey.get(pointKey(end)),
  };
}

function pushMinHeap(heap, item) {
  let index = heap.length;
  heap.push(item);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].cost <= item.cost) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = item;
}

function popMinHeap(heap) {
  const minimum = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const smaller = right < heap.length && heap[right].cost < heap[left].cost ? right : left;
      if (heap[smaller].cost >= last.cost) break;
      heap[index] = heap[smaller];
      index = smaller;
    }
    heap[index] = last;
  }
  return minimum;
}

function minDistancePath(graph) {
  if (graph.startIndex == null || graph.endIndex == null) return null;
  const states = new Map();
  const queue = [];
  const startKey = `${graph.startIndex}:n`;
  states.set(startKey, { cost: 0, previous: null, node: graph.startIndex, direction: 'n' });
  pushMinHeap(queue, { key: startKey, cost: 0 });

  while (queue.length) {
    const current = popMinHeap(queue);
    const state = states.get(current.key);
    if (!state || state.cost !== current.cost) continue;
    if (state.node === graph.endIndex) {
      const indexes = [];
      let cursor = current.key;
      while (cursor) {
        const currentState = states.get(cursor);
        indexes.push(currentState.node);
        cursor = currentState.previous;
      }
      return indexes.reverse().map((index) => graph.nodes[index]);
    }

    for (const edge of graph.adjacency[state.node]) {
      const bendPenalty = state.direction !== 'n' && state.direction !== edge.direction ? 12 : 0;
      const nextCost = state.cost + edge.distance + bendPenalty;
      const nextKey = `${edge.to}:${edge.direction}`;
      if (nextCost >= (states.get(nextKey)?.cost ?? Infinity)) continue;
      states.set(nextKey, {
        cost: nextCost,
        previous: current.key,
        node: edge.to,
        direction: edge.direction,
      });
      pushMinHeap(queue, { key: nextKey, cost: nextCost });
    }
  }
  return null;
}

function simplifyPoints(points) {
  const simplified = [];
  for (const point of points) {
    const previous = simplified.at(-1);
    const beforePrevious = simplified.at(-2);
    if (
      previous &&
      beforePrevious &&
      ((Math.abs(previous.x - beforePrevious.x) < EPSILON &&
        Math.abs(point.x - previous.x) < EPSILON) ||
        (Math.abs(previous.y - beforePrevious.y) < EPSILON &&
          Math.abs(point.y - previous.y) < EPSILON))
    ) {
      simplified[simplified.length - 1] = point;
    } else if (!previous || Math.abs(previous.x - point.x) > EPSILON || Math.abs(previous.y - point.y) > EPSILON) {
      simplified.push(point);
    }
  }
  return simplified;
}

function orthogonalPath(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

function roundedPath(points) {
  if (points.length < 3) return { path: orthogonalPath(points), samples: points };
  let path = `M ${points[0].x} ${points[0].y}`;
  const samples = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const previousLength = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y);
    const nextLength = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
    const radius = Math.min(CURVE_RADIUS, previousLength / 2, nextLength / 2);
    if (radius < 1) {
      path += ` L ${corner.x} ${corner.y}`;
      samples.push(corner);
      continue;
    }
    const before = {
      x: corner.x - Math.sign(corner.x - previous.x) * radius,
      y: corner.y - Math.sign(corner.y - previous.y) * radius,
    };
    const after = {
      x: corner.x + Math.sign(next.x - corner.x) * radius,
      y: corner.y + Math.sign(next.y - corner.y) * radius,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
    samples.push(before);
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8;
      const inverse = 1 - t;
      samples.push({
        x: inverse * inverse * before.x + 2 * inverse * t * corner.x + t * t * after.x,
        y: inverse * inverse * before.y + 2 * inverse * t * corner.y + t * t * after.y,
      });
    }
  }
  const last = points.at(-1);
  path += ` L ${last.x} ${last.y}`;
  samples.push(last);
  return { path, samples };
}

function pointsHitRect(points, rect, padding = 0) {
  const obstacle = expandRect(rect, padding);
  for (const point of points) {
    if (
      point.x > obstacle.left + EPSILON &&
      point.x < obstacle.right - EPSILON &&
      point.y > obstacle.top + EPSILON &&
      point.y < obstacle.bottom - EPSILON
    ) {
      return true;
    }
  }
  for (let index = 1; index < points.length; index += 1) {
    if (segmentBlocked(points[index - 1], points[index], [obstacle])) return true;
  }
  return false;
}

export function pathIntersectsRects(points, rectangles, padding = 0) {
  return rectangles.some((rect) => pointsHitRect(points, rect, padding));
}

function sharedSegmentLength(firstStart, firstEnd, secondStart, secondEnd) {
  const dx = firstEnd.x - firstStart.x;
  const dy = firstEnd.y - firstStart.y;
  const firstLength = Math.hypot(dx, dy);
  const secondDx = secondEnd.x - secondStart.x;
  const secondDy = secondEnd.y - secondStart.y;
  const secondLength = Math.hypot(secondDx, secondDy);
  if (firstLength < EPSILON || secondLength < EPSILON) return 0;

  const cross = dx * secondDy - dy * secondDx;
  if (Math.abs(cross) / (firstLength * secondLength) > 0.01) return 0;
  const distanceFromLine = (point) => Math.abs(dx * (point.y - firstStart.y) - dy * (point.x - firstStart.x)) / firstLength;
  if (
    distanceFromLine(secondStart) > ROUTE_OVERLAP_TOLERANCE ||
    distanceFromLine(secondEnd) > ROUTE_OVERLAP_TOLERANCE
  ) {
    return 0;
  }

  const unitX = dx / firstLength;
  const unitY = dy / firstLength;
  const project = (point) => (point.x - firstStart.x) * unitX + (point.y - firstStart.y) * unitY;
  const secondStartProjection = project(secondStart);
  const secondEndProjection = project(secondEnd);
  return Math.max(
    0,
    Math.min(firstLength, Math.max(secondStartProjection, secondEndProjection)) -
      Math.max(0, Math.min(secondStartProjection, secondEndProjection)),
  );
}

function pathOverlapScore(points, otherPaths) {
  let score = 0;
  for (const otherPoints of otherPaths) {
    for (let firstIndex = 1; firstIndex < points.length; firstIndex += 1) {
      for (let secondIndex = 1; secondIndex < otherPoints.length; secondIndex += 1) {
        score += sharedSegmentLength(
          points[firstIndex - 1],
          points[firstIndex],
          otherPoints[secondIndex - 1],
          otherPoints[secondIndex],
        );
      }
    }
  }
  return score;
}

function simpleFallbackPath(start, end) {
  const middleX = (start.x + end.x) / 2;
  return {
    path: `M ${start.x} ${start.y} L ${middleX} ${start.y} L ${middleX} ${end.y} L ${end.x} ${end.y}`,
    points: [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end],
  };
}

export function routeDependency({ source, target, obstacles = [], canvasWidth, canvasHeight, shape = 'orthogonal', laneOffset = 0 }) {
  if (!finiteRect(source) || !finiteRect(target) || canvasWidth <= 0 || canvasHeight <= 0) {
    return null;
  }

  const ports = makePorts(source, target, laneOffset);
  const routeTop = Math.min(ports.routeStart.y, ports.routeEnd.y) - GANTT_ROW_HEIGHT;
  const routeBottom = Math.max(ports.routeStart.y, ports.routeEnd.y) + GANTT_ROW_HEIGHT;
  const relevantObstacles = obstacles.filter(
    (rect) => finiteRect(rect) && rect.bottom >= routeTop && rect.top <= routeBottom,
  );
  if (shape === 'straight') {
    return {
      path: `M ${ports.start.x} ${ports.start.y} L ${ports.end.x} ${ports.end.y}`,
      points: [ports.start, ports.end],
      mode: 'straight',
      overlapsBars: pathIntersectsRects(
        [ports.start, ports.end],
        relevantObstacles.filter((rect) => rect.id !== source.id && rect.id !== target.id),
      ),
    };
  }

  const routingObstacles = relevantObstacles
    .filter((rect) => rect.id !== source.id && rect.id !== target.id)
    .map((rect) => expandRect(rect, ROUTE_CLEARANCE));
  const allObstacles = [source, target, ...relevantObstacles.filter((rect) => rect.id !== source.id && rect.id !== target.id)];
  const graphObstacles = [
    expandRect(source, ROUTE_CLEARANCE),
    expandRect(target, ROUTE_CLEARANCE),
    ...routingObstacles,
  ];
  const graph = buildVisibilityGraph(ports.routeStart, ports.routeEnd, graphObstacles, {
    width: canvasWidth,
    height: canvasHeight,
  });
  const route = minDistancePath(graph);
  if (!route) {
    const fallback = simpleFallbackPath(ports.start, ports.end);
    return {
      path: fallback.path,
      points: fallback.points,
      mode: 'fallback-visible',
      overlapsBars: pathIntersectsRects(fallback.points, allObstacles),
    };
  }

  const points = simplifyPoints([ports.start, ports.routeStart, ...route.slice(1, -1), ports.routeEnd, ports.end]);
  if (shape === 'curved') {
    const curved = roundedPath(points);
    if (!pathIntersectsRects(curved.samples, allObstacles, 0.5)) {
      return { path: curved.path, points: curved.samples, mode: 'curved', overlapsBars: false };
    }
  }

  const collisionFree = !pathIntersectsRects(points, allObstacles);
  if (!collisionFree) {
    const fallback = simpleFallbackPath(ports.start, ports.end);
    return {
      path: fallback.path,
      points: fallback.points,
      mode: 'fallback-visible',
      overlapsBars: pathIntersectsRects(fallback.points, allObstacles),
    };
  }
  return { path: orthogonalPath(points), points, mode: shape === 'curved' ? 'curved-fallback-orthogonal' : 'orthogonal', overlapsBars: false };
}

function rectFromStyle(style, canvasWidth, id, type) {
  const left = (Number.parseFloat(style.left) / 100) * canvasWidth;
  const width = (Number.parseFloat(style.width) / 100) * canvasWidth;
  const top = Number.parseFloat(style.top);
  const height = Number.parseFloat(style.height ?? 28);
  return { id, type, left, right: left + width, top, bottom: top + height, width, height };
}

export function buildDependencyLines({
  dependencies = [],
  tasks = [],
  directions = [],
  rows = [],
  taskBars = [],
  directionBars = [],
  directionAnchors = directionBars,
  canvasWidth,
  canvasHeight,
  filtering = false,
  matchedTaskIds = new Set(),
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const directionById = new Map(directions.map((direction) => [direction.id, direction]));
  const taskRectById = new Map(taskBars.map((bar) => [bar.task.id, rectFromStyle(bar.style, canvasWidth, bar.task.id, 'task')]));
  const directionRectById = new Map(directionAnchors.map((bar) => [bar.direction.id, rectFromStyle(bar.style, canvasWidth, bar.direction.id, 'direction')]));
  const directionRows = new Set(rows.filter((row) => row.type === 'direction').map((row) => row.direction.id));
  const rowByTaskId = new Set(rows.filter((row) => row.type === 'task').map((row) => row.task.id));
  const resolveEndpoint = (type, id) => {
    if (type === 'task') {
      const task = taskById.get(id);
      if (!task) return { status: 'missing' };
      if (taskRectById.has(id)) return { status: 'visible', key: `task:${id}`, rect: taskRectById.get(id) };
      if (filtering && !matchedTaskIds.has(id)) return { status: 'filtered' };
      let parent = task.parentTaskId ? taskById.get(task.parentTaskId) : null;
      while (parent) {
        if (taskRectById.has(parent.id) && rowByTaskId.has(parent.id)) {
          return { status: 'collapsed-proxy', key: `task:${parent.id}`, rect: taskRectById.get(parent.id) };
        }
        parent = parent.parentTaskId ? taskById.get(parent.parentTaskId) : null;
      }
      if (directionRectById.has(task.directionId) && directionRows.has(task.directionId)) {
        return { status: 'collapsed-proxy', key: `direction:${task.directionId}`, rect: directionRectById.get(task.directionId) };
      }
      return { status: filtering ? 'filtered' : 'missing' };
    }
    if (type === 'direction') {
      if (!directionById.has(id) || !directionRows.has(id)) return { status: filtering ? 'filtered' : 'missing' };
      if (directionRectById.has(id)) return { status: 'visible', key: `direction:${id}`, rect: directionRectById.get(id) };
      const row = rows.find((item) => item.type === 'direction' && item.direction.id === id);
      if (!row) return { status: 'missing' };
      const anchorX = 0;
      const top = row.index * GANTT_ROW_HEIGHT + 8;
      return {
        status: 'virtual-row-anchor',
        key: `direction:${id}`,
        rect: { id, type: 'direction', left: anchorX, right: anchorX, top, bottom: top + GANTT_BAR_HEIGHT, width: 0, height: GANTT_BAR_HEIGHT },
      };
    }
    return { status: 'invalid-type' };
  };

  const resolved = [];
  let filteredOutCount = 0;
  let unresolvedCount = 0;
  for (const dependency of dependencies) {
    if (dependency.predecessorType === 'direction' && dependency.successorType === 'task') {
      unresolvedCount += 1;
      continue;
    }
    const source = resolveEndpoint(dependency.predecessorType, dependency.predecessorId);
    const target = resolveEndpoint(dependency.successorType, dependency.successorId);
    if (source.status === 'filtered' || target.status === 'filtered') {
      filteredOutCount += 1;
      continue;
    }
    if (!source.rect || !target.rect || source.key === target.key) {
      unresolvedCount += 1;
      continue;
    }
    resolved.push({ dependency, source, target, laneOffset: 0 });
  }

  const groupBy = (keyFor) => {
    const groups = new Map();
    for (const item of resolved) {
      const key = keyFor(item);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    return groups;
  };
  const sourceGroups = groupBy((item) => item.source.key);
  const targetGroups = groupBy((item) => item.target.key);
  const endpointPairs = groupBy((item) => `${item.source.key}>${item.target.key}`);
  const assignLanes = (groups) => {
    const offsets = new Map();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((first, second) => String(first.dependency.id).localeCompare(String(second.dependency.id)));
      group.forEach((item, index) => {
        offsets.set(item, (index - (group.length - 1) / 2) * DEPENDENCY_LANE_SPACING);
      });
    }
    return offsets;
  };
  const sourceLanes = assignLanes(sourceGroups);
  const targetLanes = assignLanes(targetGroups);
  const pairLanes = assignLanes(endpointPairs);
  for (const item of resolved) {
    const pairKey = `${item.source.key}>${item.target.key}`;
    const pairGroup = endpointPairs.get(pairKey);
    const sourceGroup = sourceGroups.get(item.source.key);
    const targetGroup = targetGroups.get(item.target.key);
    item.laneOffset = pairGroup.length > 1
      ? pairLanes.get(item)
      : sourceGroup.length > 1
        ? sourceLanes.get(item)
        : targetGroup.length > 1
          ? targetLanes.get(item)
          : 0;
  }

  const obstacles = [
    ...taskRectById.values(),
    ...directionRectById.values(),
    ...rows
      .filter((row) => row.type === 'direction' && !directionRectById.has(row.direction.id))
      .map((row) => ({
        id: row.direction.id,
        type: 'direction',
        left: 0,
        right: 0,
        top: row.index * GANTT_ROW_HEIGHT + 8,
        bottom: row.index * GANTT_ROW_HEIGHT + 8 + GANTT_BAR_HEIGHT,
        width: 0,
        height: GANTT_BAR_HEIGHT,
      })),
  ];

  const lines = [];
  const routedPaths = [];
  for (const { dependency, source, target, laneOffset } of resolved) {
    const laneCandidates = [
      laneOffset,
      laneOffset + DEPENDENCY_LANE_SPACING,
      laneOffset - DEPENDENCY_LANE_SPACING,
      laneOffset + DEPENDENCY_LANE_SPACING * 2,
      laneOffset - DEPENDENCY_LANE_SPACING * 2,
      laneOffset + DEPENDENCY_LANE_SPACING * 3,
      laneOffset - DEPENDENCY_LANE_SPACING * 3,
    ];
    let selectedRoute = null;
    let selectedLaneOffset = laneOffset;
    let selectedOverlap = Infinity;
    for (const candidateLaneOffset of laneCandidates) {
      const route = routeDependency({
        source: source.rect,
        target: target.rect,
        obstacles,
        canvasWidth,
        canvasHeight,
        shape: dependency.arrowShape || 'orthogonal',
        laneOffset: candidateLaneOffset,
      });
      if (!route) continue;
      const overlap = pathOverlapScore(route.points, routedPaths);
      if (overlap < selectedOverlap) {
        selectedRoute = route;
        selectedLaneOffset = candidateLaneOffset;
        selectedOverlap = overlap;
      }
      if (overlap <= ROUTE_OVERLAP_TOLERANCE) break;
    }
    if (!selectedRoute) {
      unresolvedCount += 1;
      continue;
    }
    routedPaths.push(selectedRoute.points);
    lines.push({
      id: dependency.id,
      dependency,
      path: selectedRoute.path,
      routeMode: selectedRoute.mode,
      overlapsBars: selectedRoute.overlapsBars,
      sourceKey: source.key,
      targetKey: target.key,
      critical: dependency.isCritical,
      color: dependency.color || '#94a3b8',
      dash: dependency.lineStyle,
      shape: dependency.arrowShape || 'orthogonal',
      laneOffset: selectedLaneOffset,
    });
  }

  return { lines, filteredOutCount, unresolvedCount };
}
