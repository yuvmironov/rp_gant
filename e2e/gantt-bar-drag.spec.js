import { expect, test } from '@playwright/test';

test('dragging a task bar does not open the editor', async ({ page }) => {
  const suffix = Date.now();
  const email = `bar-drag-${suffix}@rp-gant.test`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Bar');
  await page.locator('#register-form input[name=firstName]').fill('Drag');
  await page.locator('#register-form input[name=password]').fill('BarDrag123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('BarDrag123!');
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
    const project = await post('/projects', { name: `Bar drag ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, {
      name: 'Bar drag',
      dayMode: 'working',
    });
    const direction = await post(`/diagrams/${diagram.id}/directions`, { name: 'Direction' });
    const task = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Dragged task',
      startDate: '2026-11-06',
      endDate: '2026-11-10',
    });
    return { projectId: project.id, diagramId: diagram.id, taskId: task.id };
  });

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  const bar = page.locator('.gantt-bar:not(.direction-bar)').first();
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator('.task-modal')).toHaveCount(0);
  await expect
    .poll(async () => {
      const snapshot = await page.evaluate(async (diagramId) => {
        const response = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`, {
          cache: 'no-store',
        });
        return response.json();
      }, ids.diagramId);
      return snapshot.tasks.find((task) => task.id === ids.taskId)?.startDate;
    })
    .not.toBe('2026-11-06');

  await page.waitForTimeout(600);
  await page.locator('.gantt-bar:not(.direction-bar)').first().click();
  await expect(page.locator('.task-modal')).toBeVisible();
});
