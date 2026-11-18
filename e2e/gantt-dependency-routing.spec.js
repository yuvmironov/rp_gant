import { expect, test } from '@playwright/test';

async function createWorkspace(page, name) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `dependency-routing-${suffix}@rp-gant.test`;
  const password = 'DependencyRouting123!';
  await page.goto('/login');
  await page.locator('#register-tab').click();
  await page.locator('#register-form input[name=email]').fill(email);
  await page.locator('#register-form input[name=lastName]').fill('Routing');
  await page.locator('#register-form input[name=firstName]').fill('Tester');
  await page.locator('#register-form input[name=password]').fill(password);
  await page.locator('#register-form input[name=confirmPassword]').fill(password);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('.projects-page')).toBeVisible({ timeout: 20_000 });

  return page.evaluate(async (diagramName) => {
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
    const project = await post('/projects', { name: `Dependency routing ${Date.now()}` });
    const diagram = await post(`/projects/${project.id}/diagrams`, {
      name: diagramName,
      dayMode: 'calendar',
    });
    const direction = await post(`/diagrams/${diagram.id}/directions`, {
      name: 'Routing direction',
    });
    return { projectId: project.id, diagramId: diagram.id, directionId: direction.id };
  }, name);
}

async function postInPage(page, path, body) {
  return page.evaluate(
    async ({ requestPath, payload }) => {
      const csrf = document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('__Host-csrf='))
        ?.slice('__Host-csrf='.length);
      const response = await fetch(`/api/v1${requestPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { requestPath: path, payload: body },
  );
}

test('routes long curved dependencies around intermediate bars', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const ids = await createWorkspace(page, 'Long curved route');
  const source = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    name: 'Long source',
    startDate: '2026-11-03',
    endDate: '2026-11-05',
  });
  const blockers = [];
  for (let index = 0; index < 4; index += 1) {
    blockers.push(
      await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
        directionId: ids.directionId,
        name: `Intermediate ${index + 1}`,
        startDate: '2026-11-10',
        endDate: '2026-11-16',
      }),
    );
  }
  const target = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    name: 'Long target',
    startDate: '2026-11-20',
    endDate: '2026-11-22',
  });
  await postInPage(page, `/diagrams/${ids.diagramId}/dependencies`, {
    predecessorType: 'task',
    predecessorId: source.id,
    successorType: 'task',
    successorId: target.id,
    lineStyle: 'solid',
    arrowShape: 'curved',
  });

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  const line = page.locator('.dep-line');
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute('data-route-mode', 'curved');
  await expect(line).toHaveAttribute('d', /Q/);
  const lineColors = await line.evaluate((path) => {
    const styles = path.ownerDocument.defaultView.getComputedStyle.bind(
      path.ownerDocument.defaultView,
    );
    return {
      stroke: styles(path).stroke,
      criticalColor: styles(path.ownerDocument.documentElement)
        .getPropertyValue('--color-danger-600')
        .trim(),
    };
  });
  expect(lineColors.criticalColor).not.toBe('');
  expect(lineColors.stroke).not.toBe('none');
  await page.locator('.dep-hit').first().dispatchEvent('mouseenter');
  await expect(page.locator('.gantt-bar.dep-linked')).toHaveCount(0);
  const taskBarOutlines = await page
    .locator('.gantt-bar:not(.direction-bar)')
    .evaluateAll((bars) =>
      bars.map((bar) => bar.ownerDocument.defaultView.getComputedStyle(bar).outlineStyle),
    );
  expect(taskBarOutlines.every((outlineStyle) => outlineStyle === 'none')).toBe(true);
  await expect(page.locator('.gantt-bar.direction-bar')).toBeVisible();
  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOT_DIR}/gantt-dependency-desktop.png`,
      fullPage: false,
    });
  }

  const collision = await page.evaluate(() => {
    const path = document.querySelector('.dep-line');
    const matrix = path.getScreenCTM();
    const rows = [...document.querySelectorAll('.gantt-row-label.task')];
    const bars = [...document.querySelectorAll('.gantt-bar:not(.direction-bar)')];
    const blockerIndexes = rows
      .map((row, index) => (row.textContent.includes('Intermediate') ? index : -1))
      .filter((index) => index >= 0);
    const blockerRects = blockerIndexes.map((index) => {
      const rect = bars[index].getBoundingClientRect();
      return {
        left: rect.left + 1,
        right: rect.right - 1,
        top: rect.top + 1,
        bottom: rect.bottom - 1,
      };
    });
    const length = path.getTotalLength();
    for (let step = 1; step < 100; step += 1) {
      const point = path.getPointAtLength((length * step) / 100).matrixTransform(matrix);
      if (
        blockerRects.some(
          (rect) =>
            point.x > rect.left &&
            point.x < rect.right &&
            point.y > rect.top &&
            point.y < rect.bottom,
        )
      ) {
        return true;
      }
    }
    return false;
  });
  expect(collision).toBe(false);
  await expect(page.locator('.deps-overlay')).toHaveCSS('z-index', '4');
  await expect(page.locator('.deps-hit-overlay')).toHaveCSS('z-index', '1');
  await expect(page.locator('.gantt-bar:not(.direction-bar)').first()).toHaveCSS('z-index', '2');

  const arrowsToggle = page.getByRole('checkbox', { name: 'Стрелки' });
  await arrowsToggle.uncheck();
  await expect(line).toHaveCount(0);
  await arrowsToggle.check();
  await expect(line).toHaveCount(1);
  await page.getByRole('button', { name: '+', exact: true }).click();
  await expect(line).toHaveAttribute('data-route-mode', 'curved');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(line).toHaveCount(1);
  await page.locator('.gantt-timeline').scrollIntoViewIfNeeded();
  await expect(line).toHaveAttribute('data-route-mode', 'curved');
  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOT_DIR}/gantt-dependency-mobile.png`,
      fullPage: false,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.dep-hit').dispatchEvent('click');
  await expect(page.locator('.dependency-modal')).toBeVisible();
  await page.locator('.dependency-arrow-shape').selectOption('straight');
  await page.locator('.dependency-modal button').filter({ hasText: 'Сохранить' }).click();
  await expect(page.locator('.dependency-modal')).toHaveCount(0);
  await expect(line).toHaveAttribute('data-route-mode', 'straight');
  await expect(page.locator('.dep-line-halo')).toHaveCount(1);
  await page.locator('.gantt-bar:not(.direction-bar)').nth(1).click();
  await expect(page.locator('.task-modal')).toBeVisible();
  await expect(page.locator('.dependency-modal')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('routes fan-out dependencies through distinct lanes in the rendered chart', async ({
  page,
}) => {
  const ids = await createWorkspace(page, 'Fan-out dependency lanes');
  const source = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    name: 'Shared source',
    startDate: '2026-11-03',
    endDate: '2026-11-05',
  });
  const firstTarget = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    name: 'First target',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
  });
  const secondTarget = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    name: 'Second target',
    startDate: '2026-11-16',
    endDate: '2026-11-18',
  });
  for (const target of [firstTarget, secondTarget]) {
    await postInPage(page, `/diagrams/${ids.diagramId}/dependencies`, {
      predecessorType: 'task',
      predecessorId: source.id,
      successorType: 'task',
      successorId: target.id,
      lineStyle: 'solid',
      arrowShape: 'orthogonal',
    });
  }

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  const lines = page.locator('.dep-line');
  await expect(lines).toHaveCount(2);
  const sourcePorts = await lines.evaluateAll((paths) =>
    paths.map((path) => Number(path.getAttribute('d').match(/^M [^ ]+ ([^ ]+)/)?.[1])),
  );

  expect(new Set(sourcePorts).size).toBe(2);
  expect(Math.abs(sourcePorts[0] - sourcePorts[1])).toBeGreaterThanOrEqual(14);
  const strokes = await lines.evaluateAll((paths) =>
    paths.map((path) => path.ownerDocument.defaultView.getComputedStyle(path).stroke),
  );
  expect(strokes.every((stroke) => stroke !== 'none')).toBe(true);
});

test('keeps collapsed-child links visible through their summary and reports filter-hidden links', async ({
  page,
}) => {
  const ids = await createWorkspace(page, 'Collapsed dependency endpoint');
  const parent = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    name: 'Proxy parent',
  });
  const child = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    parentTaskId: parent.id,
    name: 'Proxy child',
    startDate: '2026-11-05',
    endDate: '2026-11-07',
  });
  const target = await postInPage(page, `/diagrams/${ids.diagramId}/tasks`, {
    directionId: ids.directionId,
    name: 'Visible target',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
  });
  await postInPage(page, `/diagrams/${ids.diagramId}/dependencies`, {
    predecessorType: 'task',
    predecessorId: child.id,
    successorType: 'task',
    successorId: target.id,
    lineStyle: 'dotted',
    arrowShape: 'orthogonal',
  });

  await page.goto(`/gantt?project=${ids.projectId}&diagram=${ids.diagramId}`);
  const line = page.locator('.dep-line');
  await expect(line).toHaveCount(1);
  await page
    .locator('.gantt-row-label.task')
    .filter({ hasText: 'Proxy parent' })
    .locator('.caret')
    .click();
  await expect(
    page.locator('.gantt-row-label.task').filter({ hasText: 'Proxy child' }),
  ).toHaveCount(0);
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute('data-source-key', `task:${parent.id}`);

  await page.getByPlaceholder('Поиск по задаче или WBS').fill('Visible target');
  await expect(page.locator('.dependency-filter-note')).toContainText('Скрыто связей: 1');
  await expect(line).toHaveCount(0);
});
