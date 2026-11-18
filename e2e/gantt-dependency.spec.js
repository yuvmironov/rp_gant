import { expect, test } from '@playwright/test';

test('backward dependency is routed outside task bars', async ({ page }) => {
  const suffix = Date.now();
  const email = `dependency-${suffix}@rp-gant.test`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Dependency');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('Dependency123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('Dependency123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const ids = await page.evaluate(async () => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' };
    const post = (path, body) =>
      fetch(`/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(
        (response) => response.json(),
      );
    const project = await post('/projects', { name: `Dependency ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, {
      name: 'Backward dependency',
      dayMode: 'working',
    });
    const direction = await post(`/diagrams/${diagram.id}/directions`, { name: 'Direction' });
    const predecessor = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Predecessor',
      startDate: '2026-11-06',
      endDate: '2026-11-07',
    });
    const successor = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Successor',
      startDate: '2026-11-06',
      endDate: '2026-11-12',
    });
    await post(`/diagrams/${diagram.id}/dependencies`, {
      predecessorType: 'task',
      predecessorId: predecessor.id,
      successorType: 'task',
      successorId: successor.id,
      lineStyle: 'solid',
      arrowShape: 'orthogonal',
    });
    const alignedPredecessor = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Aligned predecessor',
      startDate: '2026-11-06',
      endDate: '2026-11-06',
    });
    const alignedSuccessor = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Aligned successor',
      startDate: '2026-11-07',
      endDate: '2026-11-08',
    });
    await post(`/diagrams/${diagram.id}/dependencies`, {
      predecessorType: 'task',
      predecessorId: alignedPredecessor.id,
      successorType: 'task',
      successorId: alignedSuccessor.id,
      lineStyle: 'solid',
      arrowShape: 'orthogonal',
    });
    return { projectId: project.id, diagramId: diagram.id };
  });

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  await expect(page.locator('.dep-line')).toHaveCount(2);

  const adjacentEndpoints = await page.evaluate(async () => {
    const diagramId = new URL(document.URL).searchParams.get('diagram');
    const snapshot = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`).then((response) =>
      response.json(),
    );
    const predecessorId = snapshot.tasks.find((task) => task.name === 'Aligned predecessor').id;
    const successorId = snapshot.tasks.find((task) => task.name === 'Aligned successor').id;
    const dependencyIndex = snapshot.dependencies.findIndex(
      (dependency) =>
        dependency.predecessorId === predecessorId && dependency.successorId === successorId,
    );
    const line = document.querySelectorAll('.dep-line')[dependencyIndex];
    const matrix = line.getScreenCTM();
    const start = line.getPointAtLength(0).matrixTransform(matrix);
    const end = line.getPointAtLength(line.getTotalLength()).matrixTransform(matrix);
    const taskRows = [...document.querySelectorAll('.gantt-row-label.task')];
    const taskBars = [...document.querySelectorAll('.gantt-bar:not(.direction-bar)')];
    const predecessorIndex = taskRows.findIndex((row) =>
      row.textContent.includes('Aligned predecessor'),
    );
    const successorIndex = taskRows.findIndex((row) =>
      row.textContent.includes('Aligned successor'),
    );
    const predecessor = taskBars[predecessorIndex];
    const successor = taskBars[successorIndex];
    return {
      startY: start.y,
      predecessorBottom: predecessor.getBoundingClientRect().bottom,
      endX: end.x,
      endY: end.y,
      successorLeft: successor.getBoundingClientRect().left,
      successorTop: successor.getBoundingClientRect().top,
    };
  });
  expect(adjacentEndpoints.startY).toBeGreaterThan(adjacentEndpoints.predecessorBottom);
  expect(adjacentEndpoints.startY - adjacentEndpoints.predecessorBottom).toBeLessThanOrEqual(3);
  expect(Math.abs(adjacentEndpoints.endX - adjacentEndpoints.successorLeft)).toBeLessThan(1);
  expect(adjacentEndpoints.endY).toBeLessThan(adjacentEndpoints.successorTop);
  expect(adjacentEndpoints.successorTop - adjacentEndpoints.endY).toBeLessThanOrEqual(7);

  const intersectsBar = await page.evaluate(async () => {
    const diagramId = new URL(document.URL).searchParams.get('diagram');
    const snapshot = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`).then((response) =>
      response.json(),
    );
    const predecessorId = snapshot.tasks.find((task) => task.name === 'Predecessor').id;
    const successorId = snapshot.tasks.find((task) => task.name === 'Successor').id;
    const dependencyIndex = snapshot.dependencies.findIndex(
      (dependency) =>
        dependency.predecessorId === predecessorId && dependency.successorId === successorId,
    );
    const path = document.querySelectorAll('.dep-line')[dependencyIndex];
    const matrix = path.getScreenCTM();
    const bars = [...document.querySelectorAll('.gantt-bar:not(.direction-bar)')].map((bar) => {
      const rect = bar.getBoundingClientRect();
      return {
        left: rect.left + 1,
        right: rect.right - 1,
        top: rect.top + 1,
        bottom: rect.bottom - 1,
      };
    });
    const length = path.getTotalLength();
    for (let step = 1; step < 20; step += 1) {
      const point = path.getPointAtLength((length * step) / 20).matrixTransform(matrix);
      if (
        bars.some(
          (bar) =>
            point.x > bar.left && point.x < bar.right && point.y > bar.top && point.y < bar.bottom,
        )
      ) {
        return true;
      }
    }
    return false;
  });

  expect(intersectsBar).toBe(false);
});
