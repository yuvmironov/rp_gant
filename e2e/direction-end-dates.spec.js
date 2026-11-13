import { expect, test } from '@playwright/test';

test('direction end covers all nested tasks', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page
    .locator('#register-form input[name=email]')
    .fill(`direction-end-${suffix}@rp-gant.test`);
  await page.locator('#register-form input[name=lastName]').fill('Direction');
  await page.locator('#register-form input[name=firstName]').fill('Dates');
  await page.locator('#register-form input[name=password]').fill('Direction123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('Direction123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
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
    const project = await post('/projects', { name: `Direction end ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, { name: 'Direction end' });
    const direction = await post(`/diagrams/${diagram.id}/directions`, {
      name: 'Direction',
      startDate: '2026-11-06',
      endDate: '2026-11-08',
    });
    const parent = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Parent',
      startDate: '2026-11-06',
      endDate: '2026-11-08',
    });
    const child = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      parentTaskId: parent.id,
      name: 'Nested child',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
    });
    const snapshot = await fetch(`/api/v1/diagrams/${diagram.id}/snapshot`, {
      cache: 'no-store',
    }).then((response) => response.json());
    return {
      childEnd: child.endDate.slice(0, 10),
      directionEnd: snapshot.directions[0].endDate.slice(0, 10),
      directionDays: snapshot.directions[0].days,
    };
  });

  expect(result.childEnd).toBe('2026-11-12');
  expect(result.directionEnd).toBe('2026-11-12');
  expect(result.directionDays).toBeGreaterThanOrEqual(5);
});
