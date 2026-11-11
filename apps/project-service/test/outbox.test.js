import { describe, expect, it } from 'vitest';
import { actorRolesFromPermissionRole, queueEvent } from '../src/events/outbox.js';

describe('project outbox events', () => {
  it.each([
    ['PROJECT_ROLE_OWNER', 'project_owner'],
    ['PROJECT_ROLE_MANAGER', 'project_manager'],
    ['PROJECT_ROLE_EDITOR', 'project_editor'],
    ['PROJECT_ROLE_PARTICIPANT', 'project_participant'],
    ['PROJECT_ROLE_VIEWER', 'project_viewer'],
    ['PROJECT_ROLE_UNSPECIFIED', 'app_admin'],
  ])('maps %s to its audit role', (permissionRole, auditRole) => {
    expect(actorRolesFromPermissionRole(permissionRole)).toEqual([auditRole]);
  });

  it('does not invent an audit role for an unknown permission role', () => {
    expect(actorRolesFromPermissionRole('UNKNOWN_ROLE')).toEqual([]);
  });

  it('persists the permission role snapshot in outbox headers', async () => {
    let insert;
    const db = {
      async query(sql, params) {
        insert = { sql, params };
      },
    };

    await queueEvent(db, {
      aggregateType: 'task',
      aggregateId: 'task-id',
      eventType: 'task.updated',
      actorUserId: 'actor-id',
      actorRoles: actorRolesFromPermissionRole('PROJECT_ROLE_EDITOR'),
      projectId: 'project-id',
    });

    expect(insert.sql).toContain('INSERT INTO events.outbox_events');
    expect(JSON.parse(insert.params[4]).actor_roles).toEqual(['project_editor']);
  });
});
