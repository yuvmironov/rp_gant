import { expect, test } from '@playwright/test';

test('task comments are isolated by task', async ({ page }) => {
  const suffix = Date.now();

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(`comments-${suffix}@rp-gant.test`);
  await page.locator('#register-form input[name=lastName]').fill('Comment');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('Comment123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('Comment123!');
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
    const project = await post('/projects', { name: `Comments project ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, { name: 'Comments diagram' });
    const direction = await post(`/diagrams/${diagram.id}/directions`, { name: 'Direction' });
    const first = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'First task',
    });
    const second = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Second task',
    });
    return { projectId: project.id, diagramId: diagram.id, firstId: first.id, secondId: second.id };
  });

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  await page
    .locator('.gantt-row-label')
    .filter({ hasText: 'First task' })
    .locator('.label-name')
    .click();
  await page
    .locator('.task-modal-comments textarea[placeholder="Новый комментарий"]')
    .fill('Only first');
  await page.getByRole('button', { name: 'Добавить комментарий' }).click();
  await expect(page.locator('.task-modal-comments')).toContainText('Only first');
  await expect(page.locator('.task-modal-comments')).toContainText('Comment Tester');
  await expect(page.locator('.task-modal-comments')).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );

  await page.locator('.task-modal-head .btn-icon').click();
  await page
    .locator('.gantt-row-label')
    .filter({ hasText: 'Second task' })
    .locator('.label-name')
    .click();
  await expect(page.locator('.task-modal-comments')).not.toContainText('Only first');
  await expect(page.locator('.task-modal-comments')).toContainText('Комментариев пока нет');

  const counts = await page.evaluate(async (diagramId) => {
    const response = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`, { cache: 'no-store' });
    const snapshot = await response.json();
    return Object.fromEntries(snapshot.tasks.map((task) => [task.name, task.commentsCount]));
  }, ids.diagramId);
  expect(counts['First task']).toBe(1);
  expect(counts['Second task']).toBe(0);
});
