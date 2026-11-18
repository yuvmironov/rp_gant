import { describe, expect, it } from 'vitest';
import { queueCriticalPathChange, withCriticalPathMutation } from '../src/projects.js';

const diagramId = '00000000-0000-4000-8000-000000000001';
const directionId = '00000000-0000-4000-8000-000000000002';
const taskId = '00000000-0000-4000-8000-000000000003';
const responsibleId = '00000000-0000-4000-8000-000000000004';

function createDatabase({ tasks = [], dependencies = [], revision = 7 } = {}) {
  const statements = [];
  const outboxRows = [];
  const state = { tasks, dependencies, revision };
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes('SELECT day_mode FROM project.diagrams')) {
        return { rowCount: 1, rows: [{ day_mode: 'calendar' }] };
      }
      if (sql.includes('SELECT id FROM plan.directions')) {
        return { rowCount: 1, rows: [{ id: directionId }] };
      }
      if (
        sql.includes(
          'SELECT id, direction_id, parent_task_id, start_date, end_date, estimated_hours',
        )
      ) {
        return { rowCount: state.tasks.length, rows: state.tasks };
      }
      if (sql.includes('SELECT * FROM plan.dependencies')) {
        return { rowCount: state.dependencies.length, rows: state.dependencies };
      }
      if (sql.includes('SELECT holiday_date FROM plan.diagram_holidays')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE project.diagrams')) {
        state.revision += 1;
        return {
          rowCount: 1,
          rows: [
            {
              project_id: '00000000-0000-4000-8000-000000000010',
              current_revision: state.revision,
            },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT assignment.assignee_id')) {
        return { rowCount: 1, rows: [{ assignee_id: responsibleId }] };
      }
      if (sql.includes('INSERT INTO events.outbox_events')) outboxRows.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  return {
    state,
    statements,
    outboxRows,
    db: {
      query: client.query.bind(client),
      async connect() {
        return client;
      },
    },
  };
}

const task = {
  id: taskId,
  direction_id: directionId,
  parent_task_id: null,
  start_date: '2026-11-06',
  end_date: '2026-11-06',
  estimated_hours: null,
};

describe('critical path event outbox', () => {
  it('publishes a changed task set and responsible recipients in the outbox payload', async () => {
    const fixture = createDatabase({ tasks: [task] });
    const result = await queueCriticalPathChange(fixture.db, {
      diagramId,
      before: { calculationStatus: 'complete', criticalTaskIds: ['old-task'] },
      actorId: 'actor-id',
      actorRoles: ['project_manager'],
    });

    expect(result.changed).toBe(true);
    expect(result.revision).toBe(8);
    expect(fixture.outboxRows).toHaveLength(1);
    const [aggregateType, aggregateId, eventType, serializedPayload, serializedHeaders] =
      fixture.outboxRows[0].params;
    expect([aggregateType, aggregateId, eventType]).toEqual([
      'diagram',
      diagramId,
      'diagram.critical_path.changed',
    ]);
    expect(JSON.parse(serializedPayload)).toEqual({
      diagramId,
      revision: 8,
      criticalTaskIds: [taskId],
      previousCriticalTaskIds: ['old-task'],
      responsibleUserIds: [responsibleId],
    });
    expect(JSON.parse(serializedHeaders)).toMatchObject({
      actor_user_id: 'actor-id',
      actor_roles: ['project_manager'],
      diagram_id: diagramId,
    });
  });

  it('does not emit a duplicate event when the critical task set is unchanged', async () => {
    const fixture = createDatabase({ tasks: [task] });
    const result = await queueCriticalPathChange(fixture.db, {
      diagramId,
      before: { calculationStatus: 'complete', criticalTaskIds: [taskId] },
      actorId: 'actor-id',
    });

    expect(result.changed).toBe(false);
    expect(fixture.outboxRows).toHaveLength(0);
    expect(fixture.statements.some(({ sql }) => sql.includes('UPDATE project.diagrams'))).toBe(
      false,
    );
  });

  it('rolls back mutations that introduce cycles through summary-task dependencies', async () => {
    const fixture = createDatabase({ tasks: [task] });

    await expect(
      withCriticalPathMutation(fixture.db, { diagramId, actorId: 'actor-id' }, async (client) => {
        fixture.state.tasks = [
          task,
          {
            id: 'child-task',
            direction_id: directionId,
            parent_task_id: taskId,
            start_date: '2026-11-06',
            end_date: '2026-11-06',
            estimated_hours: null,
          },
        ];
        fixture.state.dependencies = [
          {
            id: 'parent-child',
            predecessor_type: 'task',
            predecessor_id: taskId,
            successor_type: 'task',
            successor_id: 'child-task',
          },
        ];
        await client.query('INSERT INTO plan.tasks (id) VALUES ($1)', ['child-task']);
      }),
    ).rejects.toMatchObject({ message: 'dependency_cycle' });

    expect(fixture.outboxRows).toHaveLength(0);
    expect(fixture.statements.at(-1).sql).toBe('ROLLBACK');
  });

  it('commits the mutation and path event in the same outbox transaction', async () => {
    const fixture = createDatabase();
    const write = await withCriticalPathMutation(
      fixture.db,
      { diagramId, actorId: 'actor-id' },
      async (client) => {
        fixture.state.tasks = [task];
        await client.query('INSERT INTO plan.tasks (id) VALUES ($1)', [taskId]);
        return 'created';
      },
    );

    const outboxIndex = fixture.statements.findIndex(({ sql }) =>
      sql.includes('INSERT INTO events.outbox_events'),
    );
    const commitIndex = fixture.statements.findIndex(({ sql }) => sql === 'COMMIT');
    expect(write.result).toBe('created');
    expect(write.changed).toBe(true);
    expect(fixture.outboxRows).toHaveLength(1);
    expect(fixture.statements[0].sql).toBe('BEGIN');
    expect(outboxIndex).toBeGreaterThan(-1);
    expect(outboxIndex).toBeLessThan(commitIndex);
  });
});
