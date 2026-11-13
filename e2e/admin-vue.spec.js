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
  await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Разделы администрирования' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: /Пользователи/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Каталог исполнителей')).toHaveCount(0);

  await tabs.getByRole('tab', { name: /Журнал аудита/ }).click();
  await expect(page.getByRole('heading', { name: 'Журнал аудита' })).toBeVisible();
  await tabs.getByRole('tab', { name: /Конфигурация/ }).click();
  await expect(page.getByRole('heading', { name: 'Системные настройки' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Парольная политика' })).toBeVisible();
  await expect(page.locator('#setting-password_min_length')).toHaveValue(/\d+/);
  await expect(page.locator('#setting-password_max_length')).toHaveValue(/\d+/);
  await expect(page.getByRole('heading', { name: 'Защита входа' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сессии и «Запомнить меня»' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ссылки и коды подтверждения' })).toBeVisible();
  await page.locator('#setting-password_min_length').fill('200');
  await page.locator('#setting-password_max_length').fill('100');
  await page.getByRole('button', { name: 'Сохранить конфигурацию' }).click();
  await expect(page.locator('#setting-password_min_length-error')).toBeVisible();
  await expect(page.locator('#setting-password_max_length-error')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить изменения' }).click();

  const maxPasswordLength = page.locator('#setting-password_max_length');
  const originalMaxPasswordLength = Number(await maxPasswordLength.inputValue());
  const updatedMaxPasswordLength =
    originalMaxPasswordLength === 1024
      ? originalMaxPasswordLength - 1
      : originalMaxPasswordLength + 1;
  page.on('dialog', (dialog) => dialog.accept());
  for (const value of [updatedMaxPasswordLength, originalMaxPasswordLength]) {
    await maxPasswordLength.fill(String(value));
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Сохранить конфигурацию' }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(maxPasswordLength).toHaveValue(String(value));
  }
  await tabs.getByRole('tab', { name: /Пользователи/ }).click();
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
