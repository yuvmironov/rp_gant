import { expect, test } from '@playwright/test';

test('projects page creates and archives a project', async ({ page }) => {
  const suffix = Date.now();
  const email = `projects-${suffix}@rp-gant.test`;
  const projectName = `Projects UI ${suffix}`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Projects');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('Projects123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  await page.goto('/projects');
  await expect(page.locator('.projects-page')).toBeVisible();
  await page.getByRole('button', { name: '＋ Создать проект' }).click();
  await page.locator('.modal-card input').fill(projectName);
  await page.locator('.modal-card textarea').fill('Описание проекта');
  await page.locator('.modal-card button[type=submit]').click();
  await expect(page.locator('.project-row')).toContainText(projectName);

  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('.project-row')
    .filter({ hasText: projectName })
    .locator('.actions-cell button')
    .click();
  await page.locator('.project-menu button').filter({ hasText: 'Архивировать' }).click();
  await expect(page.locator('.project-row')).toHaveCount(0);
  await page.getByRole('button', { name: /Архив/ }).click();
  await expect(page.locator('.project-row')).toContainText(projectName);
});

test('projects page loads and paginates projects beyond the API page limit', async ({ page }) => {
  const requestedActiveOffsets = [];
  const totalProjects = 263;

  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: { user: { displayName: 'Pagination Tester', globalRoles: [] } },
    }),
  );
  await page.route('**/api/v1/notifications/unread-count', (route) =>
    route.fulfill({ json: { count: 0 } }),
  );
  await page.route(/\/api\/v1\/projects(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status') ?? 'active';
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 200);
    const total = status === 'active' ? totalProjects : 0;
    if (status === 'active') requestedActiveOffsets.push(offset);

    const items = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, index) => {
        const number = offset + index + 1;
        return {
          id: `project-${number}`,
          name: `Проект ${number}`,
          description: '',
          status,
          myRole: 'project_owner',
          diagramsCount: 0,
          owner: { displayName: 'Владелец' },
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
      },
    );

    await route.fulfill({ json: { items, page: { total, limit, offset } } });
  });

  await page.goto('/projects');

  await expect(page.locator('.project-row')).toHaveCount(10);
  await expect(page.locator('.projects-footer')).toContainText('Показано 1–10 из 263');
  await expect(page.getByLabel('Количество проектов на странице')).toHaveValue('10');
  expect(requestedActiveOffsets).toContain(200);

  await page.getByLabel('Количество проектов на странице').selectOption('20');
  await expect(page.locator('.project-row')).toHaveCount(20);
  await expect(page.locator('.projects-footer')).toContainText('Показано 1–20 из 263');
  await page.getByRole('button', { name: 'Последняя страница' }).click();
  await expect(page.locator('.projects-footer')).toContainText('Показано 261–263 из 263');
  await expect(page.locator('.project-row')).toHaveCount(3);
  await expect(page.locator('.project-row').last()).toContainText('Проект 263');

  await page.getByLabel('Количество проектов на странице').selectOption('30');
  await expect(page.locator('.projects-footer')).toContainText('Показано 1–30 из 263');
  await expect(page.locator('.project-row')).toHaveCount(30);
  await page.getByRole('button', { name: 'Последняя страница' }).click();
  await expect(page.locator('.projects-footer')).toContainText('Показано 241–263 из 263');
  await expect(page.locator('.project-row')).toHaveCount(23);
  await expect(page.locator('.project-row').last()).toContainText('Проект 263');

  await page.locator('.projects-search').fill('Проект 263');
  await expect(page.locator('.projects-footer')).toContainText('Показано 1–1 из 1');
  await expect(page.locator('.project-row')).toHaveCount(1);
});
