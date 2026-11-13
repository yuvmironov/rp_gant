import { expect, test } from '@playwright/test';

test('app_admin can list a project without membership', async ({ page }) => {
  const suffix = Date.now();
  const email = `admin-visibility-${suffix}@rp-gant.test`;
  const projectName = `Admin visibility ${suffix}`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Visibility');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('VisibilityPassword123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('VisibilityPassword123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  await page.evaluate(async (name) => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const response = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
      body: JSON.stringify({ name, description: 'ADR-008 visibility E2E' }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, projectName);

  await page.context().clearCookies();
  await page.goto('/login');
  await page.locator('#login-form input[name=email]').fill('admin@rp-gant.local');
  await page.locator('#login-form input[name=password]').fill('ChangeMeDevOnly!');
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible();
  await expect(page.locator('.project-row').filter({ hasText: projectName })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.locator('#auth-view')).toBeVisible();
});
