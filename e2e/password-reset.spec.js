import { expect, test } from '@playwright/test';

test('password reset through local mail', async ({ page, context }) => {
  const suffix = Date.now();
  const email = `reset-${suffix}@rp-gant.test`;
  const password = 'ResetPassword123!';
  const newPassword = 'ResetPassword456!';
  const mailPage = await context.newPage();

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Reset');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill(password);
  await page.locator('#register-form input[name=confirmPassword]').fill(password);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });
  await page.context().clearCookies();
  await page.goto('/login', { waitUntil: 'domcontentloaded' }).catch((error) => {
    if (!String(error.message).includes('ERR_ABORTED')) throw error;
  });
  await expect(page.locator('#auth-view')).toBeVisible();

  await page.evaluate(async (userEmail) => {
    const response = await fetch('/api/v1/auth/password/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, email);

  let resetLink;
  await expect
    .poll(
      async () => {
        await mailPage.goto('https://mail.rp-gant.localhost/api/v1/messages');
        const body = JSON.parse(await mailPage.locator('body').innerText());
        const message = body.messages?.find((item) =>
          item.To?.some((recipient) => recipient.Address === email),
        );
        if (!message) return false;
        await mailPage.goto(`https://mail.rp-gant.localhost/api/v1/message/${message.ID}`);
        const payload = JSON.parse(await mailPage.locator('body').innerText());
        resetLink = payload.Text?.match(/https?:\/\/\S+/)?.[0];
        return Boolean(resetLink);
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  expect(new URL(resetLink).pathname).toBe('/reset-password');
  await page.goto(resetLink);
  await expect(page.locator('.reset-form')).toBeVisible();
  await expect(page.locator('.account-callout')).toContainText(email);
  await expect(page.locator('#reset-token')).not.toHaveValue('');
  await expect(page.locator('#reset-token')).toHaveAttribute('readonly', '');
  await page.locator('#reset-password').fill(newPassword);
  await page.locator('#reset-confirm-password').fill(newPassword);
  await page.locator('.reset-form button[type=submit]').click();
  await expect(page.locator('.toast-item.success')).toContainText('Пароль сохранён');

  await page.locator('#login-tab').click();
  await page.locator('#login-form input[name=email]').fill(email);
  await page.locator('#login-form input[name=password]').fill(newPassword);
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible();
});

test('registration checks that password confirmation matches before sending', async ({ page }) => {
  const suffix = Date.now();
  let registerRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/auth/register')) {
      registerRequests += 1;
    }
  });

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(`mismatch-${suffix}@rp-gant.test`);
  await page.locator('#register-form input[name=lastName]').fill('Mismatch');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  const passwordInput = page.locator('#register-form input[name=password]');
  await passwordInput.fill('RegisterPassword123!');
  await page.getByRole('button', { name: 'Показать пароль' }).first().click();
  await expect(passwordInput).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Скрыть пароль' }).first().click();
  await expect(passwordInput).toHaveAttribute('type', 'password');
  await page.locator('#register-form input[name=confirmPassword]').fill('DifferentPassword123!');
  await page.locator('#register-form button[type=submit]').click();

  await expect(page.locator('.toast-item.error')).toContainText('Пароли не совпадают');
  expect(registerRequests).toBe(0);
});

test('registration waits for email verification before trying to sign in', async ({ page }) => {
  let loginRequests = 0;
  await page.route('**/api/v1/auth/register', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'user-needing-verification',
        requiresEmailVerification: true,
      }),
    }),
  );
  await page.route('**/api/v1/auth/login', (route) => {
    loginRequests += 1;
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(`verify-${Date.now()}@rp-gant.test`);
  await page.locator('#register-form input[name=lastName]').fill('Verify');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('VerifyPassword123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('VerifyPassword123!');
  await page.locator('#register-form button[type=submit]').click();

  await expect(page.locator('.toast-item.success')).toContainText('Подтвердите email');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Отправить письмо для подтверждения email' }),
  ).toBeVisible();
  expect(loginRequests).toBe(0);
});

test('legacy reset links land on the dedicated password form', async ({ page }) => {
  await page.route('**/api/v1/auth/password/reset/validate', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: 'invalid_token' }),
    }),
  );

  await page.goto('/login?reset=legacy-reset-token');

  await expect(page.locator('.invalid-state')).toBeVisible();
  await expect(page.locator('.invalid-state')).toContainText('Ссылка недействительна');
  expect(new URL(page.url()).pathname).toBe('/reset-password');
  expect(new URL(page.url()).search).toBe('');
});
