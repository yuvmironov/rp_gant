import { expect, test } from '@playwright/test';

test('project detail shows diagrams and members', async ({ page }) => {
  const suffix = Date.now();
  const email = `project-detail-${suffix}@rp-gant.test`;
  const projectName = `Project detail ${suffix}`;
  const diagramName = `Existing diagram ${suffix}`;

  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Project');
  await page.locator('#register-form input[name=firstName]').fill('Detail');
  await page.locator('#register-form input[name=password]').fill('Project123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('Project123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const ids = await page.evaluate(
    async ({ name, diagram }) => {
      const csrf = document.cookie
        .split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('__Host-csrf='))
        ?.slice(12);
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' };
      const post = (path, body) =>
        fetch(`/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) =>
          r.json(),
        );
      const project = await post('/projects', { name, description: 'Описание проекта' });
      await post(`/projects/${project.id}/diagrams`, { name: diagram });
      await post(`/projects/${project.id}/diagrams`, { name: `${diagram} 2` });
      return { projectId: project.id };
    },
    { name: projectName, diagram: diagramName },
  );

  await page.goto('/projects');
  await page.locator('.project-row').filter({ hasText: projectName }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${ids.projectId}$`));
  await expect(page.locator('.project-title-line h1')).toHaveText(projectName);
  await expect(page.locator('.diagrams-table .details-row')).toHaveCount(2);

  await page.locator('.project-tabs button').filter({ hasText: 'Участники' }).click();
  await expect(page.locator('.members-table .details-row')).toHaveCount(1);
  await expect(page.locator('.members-table')).toContainText('Project Detail');

  await page.locator('.project-tabs button').filter({ hasText: 'Диаграммы' }).click();
  await page.getByRole('button', { name: '＋ Диаграмма' }).click();
  await page.locator('.modal-card input').fill(`New diagram ${suffix}`);
  await page.locator('.modal-card button[type=submit]').click();
  await expect(page.locator('.gantt-title')).toHaveText(`New diagram ${suffix}`);
});
