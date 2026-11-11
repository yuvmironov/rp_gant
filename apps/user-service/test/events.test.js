import { describe, expect, it } from 'vitest';
import { queueUserEvent } from '../src/events.js';

describe('user outbox events', () => {
  it('snapshots global and active project roles into event headers', async () => {
    const calls = [];
    const db = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('SELECT role_code')) {
          return { rows: [{ role_code: 'app_admin' }, { role_code: 'project_manager' }] };
        }
        return { rows: [] };
      },
    };

    await queueUserEvent(db, {
      aggregateType: 'project',
      aggregateId: 'project-id',
      eventType: 'project.member.role_changed',
      actorUserId: 'actor-id',
      payload: { changed: true },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("status = 'active'");
    expect(calls[0].params).toEqual(['actor-id', 'project-id']);
    const headers = JSON.parse(calls[1].params[4]);
    expect(headers.actor_roles).toEqual(['app_admin', 'project_manager']);
    expect(headers.project_id).toBe('project-id');
  });

  it('uses an explicitly captured role snapshot without re-querying mutable roles', async () => {
    let insert;
    const db = {
      async query(sql, params) {
        if (sql.includes('INSERT INTO events.outbox_events')) {
          insert = params;
          return { rows: [] };
        }
        throw new Error('unexpected role lookup');
      },
    };

    await queueUserEvent(db, {
      aggregateType: 'project',
      aggregateId: 'project-id',
      eventType: 'project.owner.transferred',
      actorUserId: 'former-owner',
      actorRoles: ['project_owner'],
      projectId: 'project-id',
    });

    expect(JSON.parse(insert[4]).actor_roles).toEqual(['project_owner']);
  });
});
