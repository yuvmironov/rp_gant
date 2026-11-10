import { expect, test } from '@playwright/test';

const adminEmail = 'admin@rp-gant.local';
const adminPassword = 'ChangeMeDevOnly!';

async function signIn(page) {
  await page.locator('#login-form input[name=email]').fill(adminEmail);
  await page.locator('#login-form input[name=password]').fill(adminPassword);
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function appCookies(context) {
  return context.cookies('https://app.rp-gant.localhost');
}

test('remember me persists and restores login, and can be disabled', async ({ page, context }) => {
  await page.goto('/login');
  const rememberCheckbox = page.locator('#remember-me');
  await expect(rememberCheckbox).toBeChecked();

  await signIn(page);
  let cookies = await appCookies(context);
  const rememberCookie = cookies.find((cookie) => cookie.name === '__Host-remember');
  expect(rememberCookie).toBeDefined();
  expect(rememberCookie.expires).toBeGreaterThan(Date.now() / 1000);

  await context.clearCookies({ name: '__Host-session' });
  await page.goto('/login');
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });
  cookies = await appCookies(context);
  expect(cookies.some((cookie) => cookie.name === '__Host-session')).toBe(true);
  expect(cookies.some((cookie) => cookie.name === '__Host-remember')).toBe(true);

  await signOut(page);
  cookies = await appCookies(context);
  expect(cookies.some((cookie) => cookie.name === '__Host-session')).toBe(false);
  expect(cookies.some((cookie) => cookie.name === '__Host-remember')).toBe(false);

  await rememberCheckbox.waitFor({ state: 'visible' });
  await rememberCheckbox.uncheck();
  await signIn(page);
  cookies = await appCookies(context);
  expect(cookies.some((cookie) => cookie.name === '__Host-remember')).toBe(false);

  await signOut(page);
});
