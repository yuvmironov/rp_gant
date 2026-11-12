import { expect, test } from '@playwright/test';

test('admin can create admins and promote users', async ({ page }) => {
  const suffix = Date.now();
  const createdEmail = `admin-created-${suffix}@rp-gant.test`;
  const promotedEmail = `admin-promoted-${suffix}@rp-gant.test`;

  await page.goto('/login');
  await page.locator('#login-form input[name=email]').fill('admin@rp-gant.local');
  await page.locator('#login-form input[name=password]').fill('ChangeMeDevOnly!');
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible();

  await page.goto('/admin');
  await expect(page.locator('.executor-project-picker')).toContainText(
    'Эта привязка управляет только видимостью записи каталога',
  );
  const userForm = page
    .locator('form.inline')
    .filter({ has: page.locator('input[placeholder=Email]') });
  await userForm.locator('input[placeholder=Email]').fill(createdEmail);
  await userForm.locator('input[placeholder=Фамилия]').fill('Created');
  await userForm.locator('input[placeholder=Имя]').fill('Admin');
  await userForm.locator('input[type=checkbox]').check();
  await userForm.getByRole('button', { name: 'Создать' }).click();
  let row = page.locator('tr').filter({ hasText: createdEmail });
  await expect(row).toBeVisible();
  await expect(row.locator('td').nth(3)).toHaveText('админ');

  await userForm.locator('input[placeholder=Email]').fill(promotedEmail);
  await userForm.locator('input[placeholder=Фамилия]').fill('Promoted');
  await userForm.locator('input[placeholder=Имя]').fill('User');
  await userForm.locator('input[type=checkbox]').uncheck();
  await userForm.getByRole('button', { name: 'Создать' }).click();
  row = page.locator('tr').filter({ hasText: promotedEmail });
  await expect(row).toBeVisible();
  await expect(row.locator('td').nth(3)).toHaveText('пользователь');
  await row.getByRole('button', { name: 'Сделать админом' }).click();
  await expect(row.locator('td').nth(3)).toHaveText('админ');
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
