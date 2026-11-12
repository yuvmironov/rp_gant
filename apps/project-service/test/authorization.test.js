import { describe, expect, it } from 'vitest';
import { createProjectImplementation } from '../src/projects.js';

function invoke(method, request, actorUserId = 'user-1') {
  const metadata = { get: (key) => (key === 'x-actor-user-id' ? [actorUserId] : []) };
  return new Promise((resolve) =>
    method({ request, metadata }, (error, response) => resolve({ error, response })),
  );
}

function projectRow(id, ownerUserId = 'owner-1') {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    name: `Project ${id}`,
    description: '',
    owner_user_id: ownerUserId,
    status: 'active',
    settings: {},
    created_by_user_id: ownerUserId,
    updated_by_user_id: ownerUserId,
    created_at: now,
    updated_at: now,
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    diagrams_count: 0,
  };
}

function userClient({ accessible, permission = { allowed: false } }) {
  return {
    ListAccessibleProjectIds(_request, callback) {
      callback(null, accessible);
    },
    GetUsersByIds(_request, callback) {
      callback(null, { items: [] });
    },
    CheckProjectPermission(_request, callback) {
      callback(null, permission);
    },
  };
}

describe('Project Service authorization', () => {
  it('rejects responsible assignments on tasks before accessing the database', async () => {
    const service = createProjectImplementation({
      db: {
        async query() {
          throw new Error('should_not_query');
        },
      },
      userClient: userClient({
        accessible: { is_admin: false, items: [] },
        permission: { allowed: true },
      }),
    });

    const { error } = await invoke(service.SetTaskAssignments, {
      task_id: '11111111-1111-4111-8111-111111111111',
      assignments: [
        {
          role: 'ASSIGNMENT_ROLE_RESPONSIBLE',
          assignee_type: 'ASSIGNEE_TYPE_USER',
          assignee_id: '22222222-2222-4222-8222-222222222222',
        },
      ],
    });

    expect(error.code).toBe(3);
    expect(error.message).toBe('task_assignment_role_invalid');
  });

  it('rejects catalog executors as direction responsible before accessing the database', async () => {
    const service = createProjectImplementation({
      db: {
        async query() {
          throw new Error('should_not_query');
        },
      },
      userClient: userClient({
        accessible: { is_admin: false, items: [] },
        permission: { allowed: true },
      }),
    });

    const { error } = await invoke(service.SetDirectionResponsible, {
      direction_id: '11111111-1111-4111-8111-111111111111',
      assignment: {
        role: 'ASSIGNMENT_ROLE_RESPONSIBLE',
        assignee_type: 'ASSIGNEE_TYPE_EXECUTOR',
        assignee_id: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(error.code).toBe(3);
    expect(error.message).toBe('direction_responsible_user_required');
  });

  it('requires an active project member as the direction responsible', async () => {
    const directionId = '11111111-1111-4111-8111-111111111111';
    const projectId = '22222222-2222-4222-8222-222222222222';
    const userId = '33333333-3333-4333-8333-333333333333';
    let connected = false;
    const db = {
      async query(sql) {
        if (sql.includes('SELECT * FROM plan.directions')) {
          return {
            rowCount: 1,
            rows: [{ id: directionId, diagram_id: '44444444-4444-4444-8444-444444444444' }],
          };
        }
        if (sql.includes('SELECT project_id FROM project.diagrams')) {
          return { rowCount: 1, rows: [{ project_id: projectId }] };
        }
        throw new Error(`unexpected_query:${sql}`);
      },
      async connect() {
        connected = true;
        throw new Error('should_not_connect');
      },
    };
    const client = userClient({
      accessible: { is_admin: false, items: [] },
      permission: { allowed: true, role: 'PROJECT_ROLE_EDITOR' },
    });
    client.GetActiveProjectMemberIds = (_request, callback) => callback(null, { user_ids: [] });
    const service = createProjectImplementation({ db, userClient: client });

    const { error } = await invoke(
      service.SetDirectionResponsible,
      {
        direction_id: directionId,
        assignment: {
          role: 'ASSIGNMENT_ROLE_RESPONSIBLE',
          assignee_type: 'ASSIGNEE_TYPE_USER',
          assignee_id: userId,
        },
      },
      '55555555-5555-4555-8555-555555555555',
    );

    expect(error.code).toBe(7);
    expect(error.message).toBe('assignee_not_active_project_member');
    expect(connected).toBe(false);
  });

  it('lists all projects for app_admin even when User Service returns no memberships', async () => {
    const queries = [];
    const rows = [projectRow('project-1'), projectRow('project-2', 'owner-2')];
    const db = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('SELECT p.*, count(d.id)::int AS diagrams_count')) {
          return { rowCount: rows.length, rows };
        }
        if (sql.includes('SELECT count(*)::int AS total')) {
          return { rowCount: 1, rows: [{ total: 2 }] };
        }
        throw new Error(`unexpected_query:${sql}`);
      },
    };
    const service = createProjectImplementation({
      db,
      userClient: userClient({ accessible: { is_admin: true, items: [] } }),
    });

    const { error, response } = await invoke(service.ListProjects, { user_id: 'admin-1' });

    expect(error).toBeNull();
    expect(response.items.map((project) => project.id)).toEqual(['project-1', 'project-2']);
    expect(response.items.map((project) => project.my_role)).toEqual([
      'PROJECT_ROLE_UNSPECIFIED',
      'PROJECT_ROLE_UNSPECIFIED',
    ]);
    expect(response.page.total).toBe(2);
    expect(queries[0].sql).toContain('($1::boolean OR p.id = ANY($2::uuid[]))');
    expect(queries[0].params).toEqual([true, [], 50, 0, 'active']);
    expect(queries[1].params).toEqual([true, [], 'active']);
  });

  it('keeps ordinary project listings restricted to IDs returned by User Service', async () => {
    const projectId = 'project-1';
    let listQuery;
    const db = {
      async query(sql, params) {
        if (sql.includes('SELECT p.*, count(d.id)::int AS diagrams_count')) {
          listQuery = { sql, params };
          return { rowCount: 1, rows: [projectRow(projectId)] };
        }
        if (sql.includes('SELECT count(*)::int AS total')) {
          return { rowCount: 1, rows: [{ total: 1 }] };
        }
        throw new Error(`unexpected_query:${sql}`);
      },
    };
    const service = createProjectImplementation({
      db,
      userClient: userClient({
        accessible: {
          is_admin: false,
          items: [{ project_id: projectId, role: 'PROJECT_ROLE_OWNER' }],
        },
      }),
    });

    const { error, response } = await invoke(service.ListProjects, { user_id: 'user-1' });

    expect(error).toBeNull();
    expect(response.items.map((project) => project.id)).toEqual([projectId]);
    expect(listQuery.params).toEqual([false, [projectId], 50, 0, 'active']);
  });

  it('rejects new task assignments from the executor catalog', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const projectId = '22222222-2222-4222-8222-222222222222';
    let connected = false;
    const db = {
      async query(sql) {
        if (sql.includes('SELECT * FROM plan.tasks')) {
          return {
            rowCount: 1,
            rows: [{ id: taskId, diagram_id: '44444444-4444-4444-8444-444444444444' }],
          };
        }
        if (sql.includes('SELECT project_id FROM project.diagrams')) {
          return { rowCount: 1, rows: [{ project_id: projectId }] };
        }
        if (sql.includes('SELECT role, assignee_type, assignee_id')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected_query:${sql}`);
      },
      async connect() {
        connected = true;
        throw new Error('should_not_connect');
      },
    };
    const service = createProjectImplementation({
      db,
      userClient: userClient({
        accessible: { is_admin: false, items: [] },
        permission: { allowed: true, role: 'PROJECT_ROLE_EDITOR' },
      }),
    });

    const { error } = await invoke(
      service.SetTaskAssignments,
      {
        task_id: taskId,
        assignments: [
          {
            role: 'ASSIGNMENT_ROLE_EXECUTOR',
            assignee_type: 'ASSIGNEE_TYPE_EXECUTOR',
            assignee_id: '33333333-3333-4333-8333-333333333333',
          },
        ],
      },
      '44444444-4444-4444-8444-444444444444',
    );

    expect(error.code).toBe(3);
    expect(error.message).toBe('executor_assignment_not_supported');
    expect(connected).toBe(false);
  });

  it('rejects new executor assignments for users outside the active project membership', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const projectId = '22222222-2222-4222-8222-222222222222';
    const userId = '33333333-3333-4333-8333-333333333333';
    let connected = false;
    const db = {
      async query(sql) {
        if (sql.includes('SELECT * FROM plan.tasks')) {
          return {
            rowCount: 1,
            rows: [{ id: taskId, diagram_id: '44444444-4444-4444-8444-444444444444' }],
          };
        }
        if (sql.includes('SELECT project_id FROM project.diagrams')) {
          return { rowCount: 1, rows: [{ project_id: projectId }] };
        }
        if (sql.includes('SELECT role, assignee_type, assignee_id')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected_query:${sql}`);
      },
      async connect() {
        connected = true;
        throw new Error('should_not_connect');
      },
    };
    const client = userClient({
      accessible: { is_admin: false, items: [] },
      permission: { allowed: true, role: 'PROJECT_ROLE_EDITOR' },
    });
    client.GetActiveProjectMemberIds = (_request, callback) => callback(null, { user_ids: [] });
    const service = createProjectImplementation({ db, userClient: client });

    const { error } = await invoke(
      service.SetTaskAssignments,
      {
        task_id: taskId,
        assignments: [
          {
            role: 'ASSIGNMENT_ROLE_EXECUTOR',
            assignee_type: 'ASSIGNEE_TYPE_USER',
            assignee_id: userId,
          },
        ],
      },
      '44444444-4444-4444-8444-444444444444',
    );

    expect(error.code).toBe(7);
    expect(error.message).toBe('assignee_not_active_project_member');
    expect(connected).toBe(false);
  });

  it('enforces project permission server-side before reading the project', async () => {
    let databaseQueries = 0;
    const db = {
      async query() {
        databaseQueries += 1;
        return { rowCount: 0, rows: [] };
      },
    };
    const service = createProjectImplementation({
      db,
      userClient: userClient({
        accessible: { is_admin: false, items: [] },
        permission: { allowed: false },
      }),
    });

    const { error } = await invoke(service.GetProject, {
      project_id: 'private-project',
      actor_user_id: 'user-1',
    });

    expect(error.code).toBe(7);
    expect(error.message).toBe('permission_denied');
    expect(databaseQueries).toBe(0);
  });
});
