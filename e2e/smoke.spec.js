import { expect, test } from '@playwright/test';

test('local Vue MVP workflow', async ({ page }) => {
  const suffix = Date.now();
  const email = `mvp-${suffix}@rp-gant.test`;
  const password = 'MvpPassword123!';
  const projectName = `MVP project ${suffix}`;
  const diagramName = `MVP diagram ${suffix}`;
  const directionName = `MVP direction ${suffix}`;
  const taskName = `MVP task ${suffix}`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('MVP');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill(password);
  await page.locator('#register-form input[name=confirmPassword]').fill(password);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: '＋ Создать проект' }).click();
  await expect(page.locator('.modal-card')).toBeVisible();
  await page.locator('.modal-card input').fill(projectName);
  await page.locator('.modal-card button[type=submit]').click();
  await expect(page.locator('.project-row')).toContainText(projectName);
  await page.locator('.project-row').filter({ hasText: projectName }).click();
  await expect(page.locator('.project-page')).toBeVisible();
  await page.getByRole('button', { name: '＋ Диаграмма' }).click();
  await expect(page.locator('.modal-card')).toBeVisible();
  await page.locator('.modal-card input').fill(diagramName);
  await page.locator('.modal-card button[type=submit]').click();
  await expect(page.locator('.gantt-page')).toContainText(diagramName);

  await page.locator('.gantt-toolbar button').filter({ hasText: 'Направление' }).click();
  await expect(page.locator('.direction-modal')).toBeVisible();
  await page.locator('.direction-modal-name').fill(directionName);
  await page.locator('.direction-modal button').filter({ hasText: 'Создать направление' }).click();
  await expect(page.locator('.direction-modal')).toHaveCount(0);
  await page.locator('.gantt-toolbar button').filter({ hasText: 'Задача' }).click();
  await expect(page.locator('.task-modal')).toBeVisible();
  await page.locator('.task-modal-direction').selectOption({ label: directionName });
  await page.locator('.task-modal-name').fill(taskName);
  await page.locator('.task-modal button').filter({ hasText: 'Создать задачу' }).click();
  await expect(page.locator('.task-modal')).toHaveCount(0);
  await expect(page.locator('.gantt-labels')).toContainText(taskName);

  await page
    .locator('.gantt-row-label')
    .filter({ hasText: taskName })
    .locator('.label-name')
    .click();
  await expect(page.locator('.task-modal')).toBeVisible();
  await expect(page.locator('.task-modal-name')).toHaveValue(taskName);
});
