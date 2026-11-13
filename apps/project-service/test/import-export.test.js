import { describe, expect, it } from 'vitest';
import { normalizeStandaloneImport, standaloneCsvToPayload } from '../src/projects.js';

const ids = {
  directionOwner: '11111111-1111-4111-8111-111111111111',
  legacyOwner: '22222222-2222-4222-8222-222222222222',
  executor: '33333333-3333-4333-8333-333333333333',
  coExecutor: '44444444-4444-4444-8444-444444444444',
};
const activeMembers = new Set(Object.values(ids));

function report() {
  return { issues: [] };
}

describe('standalone assignment import/export compatibility', () => {
  it('keeps direction responsible and maps legacy task owner to executor without overriding executor', () => {
    const importReport = report();
    const payload = normalizeStandaloneImport(
      {
        tasks: [
          {
            id: '1',
            level: 1,
            type: 'Направление',
            task: 'Direction',
            ownerId: ids.directionOwner,
          },
          {
            id: '1.1',
            level: 2,
            type: 'Задача',
            task: 'Task with both fields',
            ownerId: ids.legacyOwner,
            execId: ids.executor,
            coId: ids.coExecutor,
          },
          { id: '1.2', level: 2, type: 'Задача', task: 'Legacy task', ownerId: ids.legacyOwner },
        ],
      },
      importReport,
      new Map(),
      activeMembers,
    );

    expect(payload.directions[0].assignments).toEqual([
      { role: 'responsible', assigneeType: 'user', assigneeId: ids.directionOwner },
    ]);
    expect(payload.tasks[0].assignments).toEqual([
      { role: 'executor', assigneeType: 'user', assigneeId: ids.executor },
      { role: 'co_executor', assigneeType: 'user', assigneeId: ids.coExecutor },
    ]);
    expect(payload.tasks[1].assignments).toEqual([
      { role: 'executor', assigneeType: 'user', assigneeId: ids.legacyOwner },
    ]);
    expect(importReport.issues).toContain('task_responsible_conflicts_with_executor:1.1');
    expect(
      payload.tasks.flatMap((task) => task.assignments).some((item) => item.role === 'responsible'),
    ).toBe(false);
  });

  it('reports unresolved legacy names and leaves them unassigned', () => {
    const importReport = report();
    const payload = normalizeStandaloneImport(
      {
        tasks: [
          { id: '1.1', level: 2, type: 'Р—Р°РґР°С‡Р°', task: 'Unmapped', execId: 'Unknown Person' },
        ],
      },
      importReport,
      new Map(),
      activeMembers,
    );

    expect(payload.tasks[0].assignments).toEqual([]);
    expect(importReport.issues).toContain('executor_not_mapped:1.1:Unknown Person');
  });

  it('imports legacy CSV owner/executor columns into context-specific roles', () => {
    const importReport = report();
    const csv = [
      'WBS ID;Наименование;Родитель;Уровень;Тип;Ответственный направления;Исполнитель;Соисполнитель',
      `1;Direction;;1;Направление;${ids.directionOwner};;`,
      `1.1;Task;1;2;Задача;;${ids.executor};${ids.coExecutor}`,
      `1.2;Legacy task;1;2;Задача;${ids.legacyOwner};;`,
    ].join('\n');

    const payload = standaloneCsvToPayload(csv, importReport, new Map(), activeMembers);

    expect(payload.directions[0].assignments).toEqual([
      { role: 'responsible', assigneeType: 'user', assigneeId: ids.directionOwner },
    ]);
    expect(payload.tasks[0].assignments).toEqual([
      { role: 'executor', assigneeType: 'user', assigneeId: ids.executor },
      { role: 'co_executor', assigneeType: 'user', assigneeId: ids.coExecutor },
    ]);
    expect(payload.tasks[1].assignments).toEqual([
      { role: 'executor', assigneeType: 'user', assigneeId: ids.legacyOwner },
    ]);
  });
});
