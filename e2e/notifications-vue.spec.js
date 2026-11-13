import { expect, test } from '@playwright/test';

test('nuxt notifications page renders', async ({ page }) => {
  const suffix = Date.now();
  const email = `notifications-${suffix}@rp-gant.test`;
  const password = 'NotificationsPassword123!';

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Notify');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill(password);
  await page.locator('#register-form input[name=confirmPassword]').fill(password);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  await page.goto('/notifications');
  await expect(page.locator('.notifications-page')).toBeVisible();
  await expect(page.locator('.notifications-page .empty')).toBeVisible();
  await page.locator('.back').click();
  await expect(page.locator('.projects-page')).toBeVisible();
});
