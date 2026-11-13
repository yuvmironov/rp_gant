import { expect, test } from '@playwright/test';

test('allows direction dependencies and forbids direction to task', async ({ page }) => {
  const suffix = Date.now();
  const email = `dependency-types-${suffix}@rp-gant.test`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Dependency');
  await page.locator('#register-form input[name=firstName]').fill('Types');
  await page.locator('#register-form input[name=password]').fill('Dependency123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('Dependency123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' };
    const post = async (path, body) => {
      const response = await fetch(`/api/v1${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const project = (await post('/projects', { name: `Dependency types ${Date.now()}` })).body;
    const diagram = (await post(`/projects/${project.id}/diagrams`, { name: 'Dependency types' }))
      .body;
    const first = (
      await post(`/diagrams/${diagram.id}/directions`, {
        name: 'First direction',
        startDate: '2026-11-06',
        endDate: '2026-11-08',
      })
    ).body;
    const second = (
      await post(`/diagrams/${diagram.id}/directions`, {
        name: 'Second direction',
        startDate: '2026-11-09',
        endDate: '2026-11-12',
      })
    ).body;
    const task = (
      await post(`/diagrams/${diagram.id}/tasks`, {
        directionId: first.id,
        name: 'Dependency task',
        startDate: '2026-11-06',
        endDate: '2026-11-07',
      })
    ).body;
    const directionToDirection = await post(`/diagrams/${diagram.id}/dependencies`, {
      predecessorType: 'direction',
      predecessorId: first.id,
      successorType: 'direction',
      successorId: second.id,
    });
    const directionCycle = await post(`/diagrams/${diagram.id}/dependencies`, {
      predecessorType: 'direction',
      predecessorId: second.id,
      successorType: 'direction',
      successorId: first.id,
    });
    const taskToDirection = await post(`/diagrams/${diagram.id}/dependencies`, {
      predecessorType: 'task',
      predecessorId: task.id,
      successorType: 'direction',
      successorId: second.id,
    });
    const directionToTask = await post(`/diagrams/${diagram.id}/dependencies`, {
      predecessorType: 'direction',
      predecessorId: first.id,
      successorType: 'task',
      successorId: task.id,
    });
    return {
      projectId: project.id,
      diagramId: diagram.id,
      directionToDirection,
      directionCycle,
      taskToDirection,
      directionToTask,
    };
  });

  expect(result.directionToDirection.status).toBe(201);
  expect(result.directionCycle.status).toBeGreaterThanOrEqual(400);
  expect(result.directionCycle.body.detail).toBe('dependency_cycle');
  expect(result.taskToDirection.status).toBe(201);
  expect(result.directionToTask.status).toBe(400);
  expect(result.directionToTask.body.detail).toBe('direction_to_task_dependency_forbidden');

  await page.goto(`/gantt?project=${result.projectId}&diagram=${result.diagramId}`);
  await expect(page.locator('.dep-line')).toHaveCount(2);
  await page.locator('.gantt-toolbar button').filter({ hasText: 'Связи' }).click();
  const form = page.locator('.dependency-form-grid').first();
  const predecessorType = form.locator('select').nth(0);
  const successorType = form.locator('select').nth(1);
  await predecessorType.selectOption('direction');
  await expect(successorType).toHaveValue('direction');
  await expect(successorType.locator('option[value=task]')).toHaveAttribute('disabled', '');
  await predecessorType.selectOption('task');
  await expect(successorType.locator('option[value=task]')).not.toHaveAttribute('disabled', '');
});
