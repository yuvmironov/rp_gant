import { expect, test } from '@playwright/test';

test('nuxt members page renders project owner and delivers project invitations', async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const email = `members-${suffix}@rp-gant.test`;
  const password = 'MembersPassword123!';
  const projectName = `Members project ${suffix}`;
  const invitationEmail = `invited-${suffix}@rp-gant.test`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Members');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill(password);
  await page.locator('#register-form input[name=confirmPassword]').fill(password);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const project = await page.evaluate(async (name) => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const response = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
      body: JSON.stringify({ name, description: 'members e2e' }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, projectName);

  await page.goto(`/members?project=${project.id}`);
  await expect(page.locator('.members-page')).toBeVisible();
  await expect(page.locator('.members-page .list-item')).toContainText(email);
  await expect(page.locator('.members-page h1')).toContainText('Участники');

  await page.locator('.members-page form input[placeholder=Email]').fill(invitationEmail);
  await page.getByRole('button', { name: 'Добавить или пригласить' }).click();
  const invitation = page.locator('.members-page .list-item').filter({ hasText: invitationEmail });
  await expect(invitation).toContainText('pending');

  const mailPage = await context.newPage();
  let invitationLink;
  await expect
    .poll(
      async () => {
        await mailPage.goto('https://mail.rp-gant.localhost/api/v1/messages');
        const body = JSON.parse(await mailPage.locator('body').innerText());
        const message = body.messages?.find((item) =>
          item.To?.some((recipient) => recipient.Address === invitationEmail),
        );
        if (!message) return false;
        await mailPage.goto(`https://mail.rp-gant.localhost/api/v1/message/${message.ID}`);
        const payload = JSON.parse(await mailPage.locator('body').innerText());
        invitationLink = payload.Text?.match(/https?:\/\/\S+/)?.[0];
        return Boolean(invitationLink);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  expect(new URL(invitationLink).searchParams.has('invitation')).toBe(true);

  await page.locator('.back').click();
  await expect(page.locator('.projects-page')).toBeVisible();
});
