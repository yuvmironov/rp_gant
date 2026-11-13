import { expect, test } from '@playwright/test';

test('task hours calculate end date by calendar', async ({ page }) => {
  const suffix = Date.now();
  const email = `hours-${suffix}@rp-gant.test`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Hours');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('HoursPassword123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('HoursPassword123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const ids = await page.evaluate(async () => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' };
    const request = (method, path, body) =>
      fetch(`/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }).then((response) => response.json());
    const project = await request('POST', '/projects', { name: `Hours project ${Date.now()}` });
    const diagram = await request('POST', `/projects/${project.id}/diagrams`, {
      name: 'Working hours',
      dayMode: 'working',
    });
    const direction = await request('POST', `/diagrams/${diagram.id}/directions`, {
      name: 'Direction',
    });
    const task = await request('POST', `/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Hours task',
      startDate: '2026-11-06',
      estimatedHours: 16,
    });
    return { projectId: project.id, diagramId: diagram.id, directionId: direction.id, task };
  });

  expect(ids.task.endDate.slice(0, 10)).toBe('2026-11-09');
  expect(ids.task.estimatedHours).toBe(16);

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  await expect(page.locator('.gantt-labels')).toContainText('16 ч');
  await page.locator('.gantt-toolbar button').filter({ hasText: 'Задача' }).click();
  await page.locator('.task-modal-direction').selectOption(ids.directionId);
  await page.locator('.task-modal-start').fill('2026-11-06');
  await page.locator('.task-modal-hours').fill('8');
  await expect(page.locator('.task-modal-hours')).toHaveValue('8');
  await expect(page.locator('.task-modal-end')).toHaveValue('2026-11-06');
  await expect(page.locator('.task-modal-end')).toBeDisabled();

  const recalculated = await page.evaluate(async (diagramId) => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    await fetch(`/api/v1/diagrams/${diagramId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
      body: JSON.stringify({ dayMode: 'calendar' }),
    });
    const response = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`, { cache: 'no-store' });
    return response.json();
  }, ids.diagramId);
  expect(recalculated.tasks[0].endDate.slice(0, 10)).toBe('2026-11-07');

  const updated = await page.evaluate(
    async ({ taskId }) => {
      const csrf = document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('__Host-csrf='))
        ?.slice('__Host-csrf='.length);
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
        body: JSON.stringify({ startDate: '2026-11-09', estimatedHours: 8 }),
      });
      return response.json();
    },
    { taskId: ids.task.id },
  );
  expect(updated.endDate.slice(0, 10)).toBe('2026-11-09');
  expect(updated.estimatedHours).toBe(8);
});
