import { describe, expect, it } from 'vitest';
import { createUserImplementation } from '../src/auth.js';

function invoke(method, request) {
  return new Promise((resolve) =>
    method({ request }, (error, response) => resolve({ error, response })),
  );
}

describe('project access queries', () => {
  it('marks app_admin as global while preserving only User Service membership data', async () => {
    const queries = [];
    const db = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("role_code = 'app_admin'")) return { rowCount: 1, rows: [{}] };
        if (sql.includes('FROM access.project_memberships')) return { rowCount: 0, rows: [] };
        return { rowCount: 0, rows: [] };
      },
    };
    const service = createUserImplementation({ db });

    const { error, response } = await invoke(service.ListAccessibleProjectIds, {
      user_id: 'admin-1',
    });

    expect(error).toBeNull();
    expect(response).toEqual({ items: [], is_admin: true });
    expect(queries).toHaveLength(2);
  });

  it('returns active memberships and an explicit false admin flag for ordinary users', async () => {
    const db = {
      async query(sql) {
        if (sql.includes("role_code = 'app_admin'")) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM access.project_memberships')) {
          return {
            rowCount: 1,
            rows: [{ project_id: 'project-1', role_code: 'project_owner' }],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    const service = createUserImplementation({ db });

    const { error, response } = await invoke(service.ListAccessibleProjectIds, {
      user_id: 'user-1',
    });

    expect(error).toBeNull();
    expect(response).toEqual({
      items: [
        {
          project_id: 'project-1',
          role: 'PROJECT_ROLE_OWNER',
          permissions: [],
          is_accessible: true,
        },
      ],
      is_admin: false,
    });
  });

  it('allows app_admin permissions without membership as defined by ADR-008', async () => {
    const queries = [];
    const db = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("role_code = 'app_admin'")) return { rowCount: 1, rows: [{}] };
        return { rowCount: 0, rows: [] };
      },
    };
    const service = createUserImplementation({ db });

    const { error, response } = await invoke(service.CheckProjectPermission, {
      user_id: 'admin-1',
      project_id: 'project-without-membership',
      permission: 'project.update',
    });

    expect(error).toBeNull();
    expect(response).toEqual({ allowed: true, role: 'PROJECT_ROLE_UNSPECIFIED' });
    expect(queries).toHaveLength(1);
  });
});
