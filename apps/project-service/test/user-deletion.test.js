import { describe, expect, it } from 'vitest';
import { processProjectEvent } from '../src/events/consumer.js';
import { createProjectImplementation } from '../src/projects.js';

const userId = '00000000-0000-0000-0000-000000000001';
const eventId = '00000000-0000-0000-0000-000000000002';

function invoke(method, request) {
  return new Promise((resolve) =>
    method({ request }, (error, response) => resolve({ error, response })),
  );
}

describe('user deletion guards and project cleanup', () => {
  it('reports the number of projects owned by a user', async () => {
    const queries = [];
    const implementation = createProjectImplementation({
      db: {
        async query(sql, params) {
          queries.push({ sql, params });
          return { rowCount: 1, rows: [{ count: 2 }] };
        },
      },
      userClient: {},
    });

    const { error, response } = await invoke(implementation.CheckUserOwnsProjects, {
      user_id: userId,
    });

    expect(error).toBeNull();
    expect(response).toEqual({ owns_projects: true, count: 2 });
    expect(queries[0].params).toEqual([userId]);
  });

  it('cleans deleted-user assignments and comment identities in an idempotent transaction', async () => {
    const queries = [];
    let seen = false;
    const tx = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('SELECT 1 FROM events.processed_events')) {
          return { rowCount: seen ? 1 : 0, rows: [] };
        }
        if (sql.includes('INSERT INTO events.processed_events')) seen = true;
        return { rowCount: 1, rows: [] };
      },
    };
    const event = {
      event_id: eventId,
      event_type: 'user.deleted',
      payload: { userId },
    };

    await processProjectEvent(tx, event);
    await processProjectEvent(tx, event);

    expect(queries.map(({ sql }) => sql)).toEqual([
      expect.stringContaining('SELECT 1 FROM events.processed_events'),
      expect.stringContaining('DELETE FROM plan.assignments'),
      expect.stringContaining('UPDATE plan.comments'),
      expect.stringContaining(
        "INSERT INTO events.processed_events (consumer, event_id) VALUES ('project', $1)",
      ),
      expect.stringContaining('SELECT 1 FROM events.processed_events'),
    ]);
    expect(queries.slice(1, 3).every((query) => query.params[0] === userId)).toBe(true);
    expect(queries[4].sql).not.toContain('DELETE FROM');
  });
});
