import { expect, test } from '@playwright/test';

test('direction end covers all nested tasks', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page
    .locator('#register-form input[name=email]')
    .fill(`direction-end-${suffix}@rp-gant.test`);
  await page.locator('#register-form input[name=lastName]').fill('Direction');
  await page.locator('#register-form input[name=firstName]').fill('Dates');
  await page.locator('#register-form input[name=password]').fill('Direction123!');
  await page.locator('#register-form input[name=confirmPassword]').fill('Direction123!');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  const result = await page.evaluate(async () => {
    const csrf = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('__Host-csrf='))
      ?.slice('__Host-csrf='.length);
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' };
    const post = (path, body) =>
      fetch(`/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(
        (response) => response.json(),
      );
    const project = await post('/projects', { name: `Direction end ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, { name: 'Direction end' });
    const direction = await post(`/diagrams/${diagram.id}/directions`, {
      name: 'Direction',
      startDate: '2026-11-06',
      endDate: '2026-12-08',
    });
    const parent = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      name: 'Parent',
      startDate: '2026-11-06',
      endDate: '2026-12-07',
    });
    const child = await post(`/diagrams/${diagram.id}/tasks`, {
      directionId: direction.id,
      parentTaskId: parent.id,
      name: 'Nested child',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
    });
    const snapshot = await fetch(`/api/v1/diagrams/${diagram.id}/snapshot`, {
      cache: 'no-store',
    }).then((response) => response.json());
    return {
      projectId: project.id,
      diagramId: diagram.id,
      childId: child.id,
      childEnd: child.endDate.slice(0, 10),
      directionEnd: snapshot.directions[0].endDate.slice(0, 10),
      directionDays: snapshot.directions[0].days,
    };
  });

  expect(result.childEnd).toBe('2026-11-12');
  expect(result.directionEnd).toBe('2026-11-12');
  expect(result.directionDays).toBe(5);

  await page.goto(`/gantt?project=${result.projectId}&diagram=${result.diagramId}`);
  await expect(page.locator('.gantt-page')).toBeVisible();
  const childBar = page.locator('.gantt-bar:not(.direction-bar)').filter({ hasText: '1.1.1' });
  const endHandle = childBar.locator('.bar-handle.right');
  await expect(endHandle).toBeVisible();
  const directionBar = page.locator('.gantt-bar.direction-bar').first();
  const directionWidthBefore = await directionBar.evaluate((element) =>
    Number.parseFloat(element.style.width),
  );
  const handleBox = await endHandle.boundingBox();
  const dragDistance = await page.locator('.gantt-canvas').evaluate((element) => {
    const dayMs = 86_400_000;
    const dates = [Date.parse('2026-11-06'), Date.parse('2026-11-12'), Date.now()];
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    const daysInRange = Math.max(1, (max - min) / dayMs);
    return (element.getBoundingClientRect().width * 2.1) / daysInRange;
  });

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 - dragDistance,
    handleBox.y + handleBox.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(async ({ diagramId, childId }) => {
        const snapshot = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`, {
          cache: 'no-store',
        }).then((response) => response.json());
        const child = snapshot.tasks.find((task) => task.id === childId);
        return child?.endDate?.slice(0, 10);
      }, result),
    )
    .not.toBe('2026-11-12');
  await expect
    .poll(() => directionBar.evaluate((element) => Number.parseFloat(element.style.width)))
    .toBeLessThan(directionWidthBefore);

  const shortenedDates = await page.evaluate(async ({ diagramId, childId }) => {
    const snapshot = await fetch(`/api/v1/diagrams/${diagramId}/snapshot`, {
      cache: 'no-store',
    }).then((response) => response.json());
    return {
      childEnd: snapshot.tasks.find((task) => task.id === childId)?.endDate?.slice(0, 10),
      directionEnd: snapshot.directions[0].endDate.slice(0, 10),
      directionDays: snapshot.directions[0].days,
    };
  }, result);
  expect(shortenedDates.childEnd).not.toBe('2026-11-12');
  expect(shortenedDates.directionEnd).toBe(shortenedDates.childEnd);
  expect(shortenedDates.directionDays).toBeLessThan(result.directionDays);

  const oneDayBarWidths = await childBar.evaluate((bar) => ({
    barWidth: Number.parseFloat(bar.style.width),
    dayWidth: Number.parseFloat(
      bar.closest('.gantt-canvas').style.getPropertyValue('--timeline-day-width'),
    ),
  }));
  expect(oneDayBarWidths.barWidth).toBeCloseTo(oneDayBarWidths.dayWidth, 4);
});
