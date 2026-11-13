import { expect, test } from '@playwright/test';

test('link mode supports directions and task-to-direction', async ({ page }) => {
  const suffix = Date.now();
  const email = `dependency-links-${suffix}@rp-gant.test`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Dependency');
  await page.locator('#register-form input[name=firstName]').fill('Links');
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
    const project = await post('/projects', { name: `Dependency links ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, { name: 'Dependency links' });
    const first = await post(`/diagrams/${diagram.id}/directions`, {
      name: 'First direction',
      startDate: '2026-11-06',
      endDate: '2026-11-08',
    });
    const second = await post(`/diagrams/${diagram.id}/directions`, {
      name: 'Second direction',
      startDate: '2026-11-09',
      endDate: '2026-11-12',
    });
    const third = await post(`/diagrams/${diagram.id}/directions`, {
      name: 'Third direction',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
    });
    const task = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: first.id,
      name: 'Link task',
      startDate: '2026-11-06',
      endDate: '2026-11-07',
    });
    return {
      projectId: project.id,
      diagramId: diagram.id,
      firstId: first.id,
      secondId: second.id,
      thirdId: third.id,
      taskId: task.id,
    };
  });

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  const linkButton = page.locator('.gantt-toolbar button').filter({ hasText: 'Связать' });
  const directionBar = (name) => page.locator('.gantt-bar.direction-bar').filter({ hasText: name });
  const taskBar = page.locator('.gantt-bar:not(.direction-bar)').first();

  await linkButton.click();
  await directionBar('First direction').click();
  await expect(page.locator('.link-hint')).toContainText('направление-последователя');
  await directionBar('Second direction').click();
  await expect(linkButton).not.toHaveClass(/active/);

  await linkButton.click();
  await taskBar.click();
  await expect(page.locator('.link-hint')).toContainText('направление-последователя');
  await directionBar('Second direction').click();
  await expect(linkButton).not.toHaveClass(/active/);

  const dependencyCount = async () =>
    page.evaluate(async (diagramId) => {
      const response = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`, {
        cache: 'no-store',
      });
      const snapshot = await response.json();
      return snapshot.dependencies.length;
    }, ids.diagramId);
  await expect.poll(dependencyCount).toBe(2);

  await linkButton.click();
  await directionBar('First direction').click();
  await taskBar.click();
  await expect(page.locator('.toast-item.error')).toContainText('только к направлению');
  await expect.poll(dependencyCount).toBe(2);
  await linkButton.click();

  await page.locator('.gantt-toolbar button').filter({ hasText: 'Связи' }).click();
  const form = page.locator('.dependency-form-grid').first();
  await form.locator('select').nth(1).selectOption('direction');
  await form.locator('select').nth(0).selectOption('task');
  await form.locator('select').nth(2).selectOption(ids.taskId);
  await form.locator('select').nth(3).selectOption(ids.thirdId);
  await page.locator('.dependency-modal button').filter({ hasText: 'Сохранить' }).click();
  await expect(page.locator('.dependency-modal')).toHaveCount(0);
  await expect.poll(dependencyCount).toBe(3);

  await page.locator('.gantt-toolbar button').filter({ hasText: 'Связи' }).click();
  const directionItem = page
    .locator('.dependency-list-item')
    .filter({ hasText: 'First direction' })
    .filter({ hasText: 'Second direction' });
  await directionItem.click();
  const editForm = page.locator('.dependency-form-grid').first();
  await expect(editForm.locator('select').nth(0)).toHaveValue('direction');
  await expect(editForm.locator('select').nth(1)).toHaveValue('direction');
  await expect(editForm.locator('select').nth(2)).toHaveValue(ids.firstId);
  await expect(editForm.locator('select').nth(3)).toHaveValue(ids.secondId);
});
