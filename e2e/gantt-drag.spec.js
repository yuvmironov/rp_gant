import { expect, test } from '@playwright/test';

test('drag task into parent updates hierarchy', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(`drag-${suffix}@rp-gant.test`);
  await page.locator('#register-form input[name=lastName]').fill('Drag');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('DragPassword123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('DragPassword123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const parentName = `Drag parent ${suffix}`;
  const siblingName = `Drag sibling ${suffix}`;
  const ids = await page.evaluate(
    async ({ name, sibling: siblingNameValue }) => {
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
      const project = await post('/projects', { name: `Drag project ${Date.now()}` });
      const diagram = await post(`/projects/${project.id}/diagrams`, { name: 'Drag diagram' });
      const direction = await post(`/diagrams/${diagram.id}/directions`, {
        name: 'Drag direction',
      });
      const parent = await post(`/diagrams/${diagram.id}/tasks`, {
        directionId: direction.id,
        name,
        priority: 'medium',
      });
      const child = await post(`/diagrams/${diagram.id}/tasks`, {
        directionId: direction.id,
        name: `${name} child`,
        priority: 'medium',
      });
      const siblingRow = await post(`/diagrams/${diagram.id}/tasks`, {
        directionId: direction.id,
        name: siblingNameValue,
        priority: 'medium',
      });
      return {
        projectId: project.id,
        diagramId: diagram.id,
        parentId: parent.id,
        childId: child.id,
        siblingId: siblingRow.id,
      };
    },
    { name: parentName, sibling: siblingName },
  );

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  await expect(page.locator('.gantt-page')).toContainText(parentName);
  const parent = page.locator('.gantt-row-label').filter({ hasText: parentName }).first();
  const child = page
    .locator('.gantt-row-label')
    .filter({ hasText: `${parentName} child` })
    .first();
  await child.dragTo(parent);
  await expect(page.locator('.gantt-labels')).toContainText('1.1.1');
  const sibling = page.locator('.gantt-row-label').filter({ hasText: siblingName }).first();
  await sibling.dragTo(parent, { targetPosition: { x: 30, y: 2 } });
  await expect(page.locator('.gantt-labels')).toContainText(`1.1. ${siblingName}`);
  await expect(page.locator('.gantt-labels')).toContainText(`1.2. ${parentName}`);
  await expect(page.locator('.gantt-labels')).toContainText('1.2.1');
  await expect(page.locator('.toast-item.error')).toHaveCount(0);
});
