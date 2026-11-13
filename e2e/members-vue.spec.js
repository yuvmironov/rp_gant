import { expect, test } from '@playwright/test';

async function register(page, email, name) {
  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill(name);
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill('MembersPassword123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('MembersPassword123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });
}

async function createProject(page, name) {
  return page.evaluate(async (projectName) => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const response = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
      body: JSON.stringify({ name: projectName, description: 'members e2e' }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, name);
}

test('members page searches projects/users and keeps only pending invitations in the waiting list', async ({
  page,
  context,
  browser,
}) => {
  const suffix = Date.now();
  const ownerEmail = `members-owner-${suffix}@rp-gant.test`;
  const ownerName = 'Members Owner';
  const projectName = `Members project ${suffix}`;
  const availableEmail = `available-${suffix}@rp-gant.test`;
  const availableName = 'Available Candidate';
  const invitationEmail = `invited-${suffix}@rp-gant.test`;

  await register(page, ownerEmail, ownerName);
  const project = await createProject(page, projectName);
  const otherProjectName = `Other project ${suffix}`;
  await createProject(page, otherProjectName);

  const availableContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'https://app.rp-gant.localhost',
    ignoreHTTPSErrors: true,
  });
  try {
    await register(await availableContext.newPage(), availableEmail, availableName);
  } finally {
    await availableContext.close();
  }

  await page.goto(`/members?project=${project.id}`);
  await expect(page.locator('.members-page')).toBeVisible();
  await expect(page.locator('.members-page .list-item')).toContainText(ownerEmail);
  await expect(page.locator('.members-page h1')).toContainText('Участники');

  const projectSelect = page.locator('#project-select');
  await projectSelect.fill('Other project');
  await expect(page.getByRole('option', { name: otherProjectName })).toBeVisible();
  await page.getByRole('option', { name: otherProjectName }).click();
  await expect(projectSelect).toHaveValue(otherProjectName);
  await projectSelect.fill('Members project');
  await expect(page.getByRole('option', { name: projectName })).toBeVisible();
  await page.getByRole('option', { name: projectName }).click();
  await expect(projectSelect).toHaveValue(projectName);

  const userSelect = page.locator('#available-user-select');
  await userSelect.fill(availableEmail);
  await expect(page.getByRole('option', { name: new RegExp(availableEmail) })).toBeVisible();
  await userSelect.press('Enter');
  await page.locator('#member-role').selectOption('manager');
  await page.getByRole('button', { name: 'Добавить участника' }).click();

  const addedMember = page.locator('.members-card').nth(1).locator('.list-item').filter({
    hasText: availableEmail,
  });
  await expect(addedMember).toBeVisible();
  await expect(addedMember).toContainText('Менеджер');
  await userSelect.fill(availableEmail);
  await expect(page.getByText('Доступные участники не найдены.')).toBeVisible();
  await userSelect.press('Escape');
  const waitingCard = page.locator('.members-card').filter({ hasText: 'Ожидают ответа' });
  await expect(waitingCard).toContainText('Ожидающих приглашений нет.');

  await page.evaluate(
    async ({ projectId, email }) => {
      const csrf = document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('__Host-csrf='))
        ?.slice('__Host-csrf='.length);
      const response = await fetch(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
        body: JSON.stringify({ email, role: 'viewer' }),
      });
      if (!response.ok) throw new Error(await response.text());
    },
    { projectId: project.id, email: invitationEmail },
  );
  await page.reload();
  await expect(page.locator('.members-page')).toBeVisible();
  const pendingInvitation = waitingCard.locator('.list-item').filter({ hasText: invitationEmail });
  await expect(pendingInvitation).toContainText('Ожидает ответа');

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
});
