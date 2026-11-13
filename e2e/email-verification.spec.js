import { expect, test } from '@playwright/test';

async function stubSuccessfulVerification(page) {
  const requests = [];
  await page.route('**/api/v1/auth/email/verify', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ userId: 'verified-user', verified: true }),
    });
  });
  return requests;
}

test('successful verification shows a separate screen and offers login', async ({ page }) => {
  const requests = await stubSuccessfulVerification(page);
  let loginRequests = 0;
  await page.route('**/api/v1/auth/login', (route) => {
    loginRequests += 1;
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/login?verify=one-time-token');

  await expect(page.getByRole('heading', { name: 'Email подтверждён' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/email-confirmed');
  expect(new URL(page.url()).search).toBe('');
  expect(requests).toEqual([{ token: 'one-time-token' }]);
  expect(loginRequests).toBe(0);

  await page.getByRole('link', { name: /Перейти ко входу/ }).click();
  await expect(page.locator('#login-form')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/login');
});

test('legacy root verification links preserve the token and reach the success screen', async ({
  page,
}) => {
  const requests = await stubSuccessfulVerification(page);

  await page.goto('/?verify=legacy-one-time-token');

  await expect(page.getByRole('heading', { name: 'Email подтверждён' })).toBeVisible();
  expect(requests).toEqual([{ token: 'legacy-one-time-token' }]);
  expect(new URL(page.url()).pathname).toBe('/email-confirmed');
  expect(new URL(page.url()).search).toBe('');
});

test('invalid verification tokens stay on login and do not show success', async ({ page }) => {
  let loginRequests = 0;
  await page.route('**/api/v1/auth/email/verify', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: 'invalid_token' }),
    }),
  );
  await page.route('**/api/v1/auth/login', (route) => {
    loginRequests += 1;
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/login?verify=expired-token');

  await expect(page.locator('.toast-item.error')).toContainText(
    'Ссылка подтверждения недействительна',
  );
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Email подтверждён' })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(new URL(page.url()).search).toBe('');
  expect(loginRequests).toBe(0);
});
