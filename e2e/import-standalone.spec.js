import { expect, test } from '@playwright/test';

test('imports standalone HTML JSON format', async ({ page }) => {
  const suffix = Date.now();
  const email = `import-${suffix}@rp-gant.test`;
  const password = 'ImportPassword123!';
  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Import');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill(password);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' };
    const post = async (path, body) => {
      const response = await fetch(`/api/v1${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const project = await post('/projects', { name: `Import project ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, { name: 'Import target' });
    const payload = {
      project: 'Standalone import',
      tasks: [
        {
          id: '1',
          level: 1,
          type: 'Направление',
          task: 'Standalone direction',
          priority: 'Высокий',
          hasBP: true,
        },
        {
          id: '1.1',
          level: 2,
          parentId: '1',
          type: 'Задача',
          task: 'Standalone task',
          status: 'В работе',
          percentComplete: 40,
          priority: 'Средний',
          hasSP: true,
          start: '2026-01-05',
          end: '2026-01-10',
        },
        {
          id: '1.1.1',
          level: 3,
          parentId: '1.1',
          type: 'Подзадача',
          task: 'Standalone subtask',
          status: 'Выполнено',
          percentComplete: 100,
          start: '2026-01-05',
          end: '2026-01-06',
          dependencies: '1.1',
        },
      ],
    };
    const form = new FormData();
    form.append(
      'file',
      new window.Blob([JSON.stringify(payload)], { type: 'application/json' }),
      'plan.json',
    );
    form.append('format', 'json');
    const previewForm = new FormData();
    previewForm.append(
      'file',
      new window.Blob([JSON.stringify(payload)], { type: 'application/json' }),
      'plan.json',
    );
    previewForm.append('format', 'json');
    const previewResponse = await fetch(`/api/v1/diagrams/${diagram.id}/import?preview=true`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrf ?? '' },
      body: previewForm,
    });
    if (!previewResponse.ok) throw new Error(await previewResponse.text());
    const previewJob = await previewResponse.json();
    const before = await fetch(`/api/v1/diagrams/${diagram.id}/snapshot`).then((item) =>
      item.json(),
    );
    const response = await fetch(`/api/v1/diagrams/${diagram.id}/import`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrf ?? '' },
      body: form,
    });
    if (!response.ok) throw new Error(await response.text());
    const job = await response.json();
    const snapshot = await fetch(`/api/v1/diagrams/${diagram.id}/snapshot`).then((item) =>
      item.json(),
    );
    const exported = await fetch(
      `/api/v1/diagrams/${diagram.id}/export?format=json&compat=standalone`,
    ).then((item) => item.json());
    return { job, previewJob, before, snapshot, exported, diagramId: diagram.id };
  });

  expect(result.previewJob.status).toBe('cancelled');
  expect(result.previewJob.report.tasksCount).toBe(2);
  expect(result.before.tasks).toHaveLength(0);
  expect(result.job.status).toBe('completed');
  expect(result.snapshot.diagram.name).toBe('Standalone import');
  expect(result.snapshot.directions).toHaveLength(1);
  expect(result.snapshot.tasks).toHaveLength(2);
  expect(result.snapshot.tasks.find((task) => task.wbsCode === '1.1').progress).toBe(100);
  expect(result.snapshot.tasks.find((task) => task.wbsCode === '1.1').autoProgress).toBe(true);
  expect(result.snapshot.tasks.find((task) => task.wbsCode === '1.1.1').parentTaskId).toBeTruthy();
  expect(result.snapshot.dependencies).toHaveLength(1);
  expect(result.snapshot.schedule.criticalTaskIds.length).toBeGreaterThan(0);
  expect(result.exported.tasks).toHaveLength(3);
  expect(result.exported.tasks.find((task) => task.level === 2)).not.toHaveProperty('ownerId');
  expect(result.exported.tasks.find((task) => task.level === 1)).toHaveProperty('ownerId');
  expect(result.exported.directionOrder).toEqual(['1']);
  expect(Object.keys(result.exported.depStyles).length).toBe(1);
});
