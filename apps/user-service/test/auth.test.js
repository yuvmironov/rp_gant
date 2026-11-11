import { describe, expect, it } from 'vitest';
import { createUserImplementation, hashPassword, verifyPassword } from '../src/auth.js';

describe('password hashing', () => {
  it('hashes with Argon2id and verifies', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(passwordHash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(passwordHash, 'wrong password')).toBe(false);
  });
});

function invoke(method, request) {
  return new Promise((resolve) => {
    method({ request }, (error, response) => resolve({ error, response }));
  });
}

describe('auth email job creation', () => {
  it('commits registration and its verification email job together', async () => {
    const transaction = [];
    const client = {
      async query(sql, params = []) {
        transaction.push({ sql, params });
        if (sql.includes('INSERT INTO access.users'))
          return { rowCount: 1, rows: [{ id: 'user-1' }] };
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    const db = {
      async connect() {
        return client;
      },
      async query() {
        return { rowCount: 0, rows: [] };
      },
    };
    const service = createUserImplementation({ db, publicAppUrl: 'https://app.example.com' });

    const { error, response } = await invoke(service.Register, {
      email: 'person@example.com',
      password: 'correct horse battery staple',
      last_name: 'Иванов',
      first_name: 'Иван',
      locale: 'ru-RU',
    });

    expect(error).toBeNull();
    expect(response).toMatchObject({ user_id: 'user-1', requires_email_verification: true });
    const tokenIndex = transaction.findIndex(({ sql }) =>
      sql.includes('INSERT INTO access.email_verification_tokens'),
    );
    const jobIndex = transaction.findIndex(({ sql }) =>
      sql.includes('INSERT INTO jobs.auth_email_jobs'),
    );
    const commitIndex = transaction.findIndex(({ sql }) => sql === 'COMMIT');
    expect(tokenIndex).toBeGreaterThan(-1);
    expect(jobIndex).toBeGreaterThan(tokenIndex);
    expect(jobIndex).toBeLessThan(commitIndex);
    expect(transaction[jobIndex].params.slice(0, 4)).toEqual([
      'user-1',
      null,
      'person@example.com',
      'email_verification',
    ]);
  });

  it('commits a new project invitation and its email job together', async () => {
    const transaction = [];
    const invitationRow = {
      id: 'invitation-1',
      project_id: 'project-1',
      email: 'invitee@example.com',
      role_code: 'project_editor',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      accepted_at: null,
      revoked_at: null,
      invited_by_user_id: 'actor-1',
    };
    const client = {
      async query(sql, params = []) {
        transaction.push({ sql, params });
        if (sql.includes('SELECT * FROM access.users')) return { rowCount: 0, rows: [] };
        if (sql.includes('SELECT * FROM access.invitations')) return { rowCount: 0, rows: [] };
        if (sql.includes('INSERT INTO access.invitations')) {
          return { rowCount: 1, rows: [invitationRow] };
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    const db = {
      async connect() {
        return client;
      },
      async query(sql) {
        if (sql.includes('FROM access.project_memberships m')) {
          return { rowCount: 1, rows: [{}] };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    const service = createUserImplementation({ db, publicAppUrl: 'https://app.example.com' });

    const { error, response } = await invoke(service.CreateInvitation, {
      project_id: 'project-1',
      email: 'Invitee@example.com',
      role: 'PROJECT_ROLE_EDITOR',
      actor_user_id: 'actor-1',
    });

    expect(error).toBeNull();
    expect(response.invitation.email).toBe('invitee@example.com');
    const invitationIndex = transaction.findIndex(({ sql }) =>
      sql.includes('INSERT INTO access.invitations'),
    );
    const jobIndex = transaction.findIndex(({ sql }) =>
      sql.includes('INSERT INTO jobs.auth_email_jobs'),
    );
    const commitIndex = transaction.findIndex(({ sql }) => sql === 'COMMIT');
    expect(jobIndex).toBeGreaterThan(invitationIndex);
    expect(jobIndex).toBeLessThan(commitIndex);
    expect(transaction[jobIndex].params.slice(0, 4)).toEqual([
      null,
      'invitation-1',
      'invitee@example.com',
      'project_invitation',
    ]);
  });

  it('stores a password-reset message job without sending SMTP in the request handler', async () => {
    const queries = [];
    const db = {
      async connect() {
        return {
          async query(sql, params = []) {
            queries.push({ sql, params });
            if (sql.includes('SELECT * FROM access.users')) {
              return {
                rowCount: 1,
                rows: [
                  { id: 'user-1', email: 'person@example.com', locale: 'ru-RU', status: 'active' },
                ],
              };
            }
            return { rowCount: 1, rows: [] };
          },
          release() {},
        };
      },
    };
    const service = createUserImplementation({ db, publicAppUrl: 'https://app.example.com' });

    const { error, response } = await invoke(service.RequestPasswordReset, {
      email: 'PERSON@example.com',
    });

    expect(error).toBeNull();
    expect(response).toEqual({ accepted: true });
    const job = queries.find(({ sql }) => sql.includes('INSERT INTO jobs.auth_email_jobs'));
    expect(job.params.slice(0, 4)).toEqual([
      'user-1',
      null,
      'person@example.com',
      'password_reset',
    ]);
    expect(JSON.parse(job.params[4])).toMatchObject({
      link: expect.stringMatching(/^https:\/\/app\.example\.com\/login\?reset=/),
    });
    expect(job.params[5]).toBe('ru-RU');
  });
});

describe('session expiration', () => {
  it('revokes an expired non-remembered session when it is next validated', async () => {
    const queries = [];
    const db = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('SELECT s.*, u.status AS user_status')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'expired-session',
                user_id: 'user-1',
                user_status: 'active',
                absolute_expires_at: new Date(Date.now() + 60_000),
                idle_expires_at: new Date(Date.now() - 1_000),
                remember_token_hash: null,
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    };
    const service = createUserImplementation({ db, mailer: {} });

    const { error } = await invoke(service.ValidateSession, { session_token: 'expired-token' });

    expect(error.message).toBe('session_expired');
    expect(queries.some(({ sql }) => sql.includes('SET revoked_at = now()'))).toBe(true);
  });

  it('updates non-remembered sessions with a typed null remember expiry', async () => {
    let update;
    const db = {
      async query(sql, params) {
        if (sql.includes('SELECT s.*, u.status AS user_status')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'regular-session',
                user_id: 'user-1',
                user_status: 'active',
                absolute_expires_at: new Date(Date.now() + 60 * 60 * 1000),
                idle_expires_at: new Date(Date.now() + 5 * 60 * 1000),
                remember_token_hash: null,
                remember_absolute_expires_at: null,
                remember_idle_expires_at: null,
              },
            ],
          };
        }
        if (sql.includes('UPDATE access.user_sessions')) update = { sql, params };
        return { rowCount: 1, rows: [] };
      },
    };
    const service = createUserImplementation({ db, mailer: {} });

    const { error, response } = await invoke(service.ValidateSession, {
      session_token: 'active-token',
      extend_idle: true,
    });

    expect(error).toBeNull();
    expect(response.user_id).toBe('user-1');
    expect(update.params[1]).toBeNull();
    expect(update.sql).toContain('$2::timestamptz');
  });

  it('extends remembered-session idle expiry with authenticated activity', async () => {
    const updates = [];
    const absoluteExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const db = {
      async query(sql, params) {
        if (sql.includes('SELECT s.*, u.status AS user_status')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'remembered-session',
                user_id: 'user-1',
                user_status: 'active',
                absolute_expires_at: absoluteExpiresAt,
                idle_expires_at: new Date(Date.now() + 60_000),
                remember_token_hash: 'remember-hash',
                remember_absolute_expires_at: absoluteExpiresAt,
                remember_idle_expires_at: new Date(Date.now() + 60_000),
              },
            ],
          };
        }
        if (sql.includes('UPDATE access.user_sessions')) updates.push({ sql, params });
        return { rowCount: 1, rows: [] };
      },
    };
    const service = createUserImplementation({ db, mailer: {} });

    const { error, response } = await invoke(service.ValidateSession, {
      session_token: 'active-token',
      extend_idle: true,
    });

    expect(error).toBeNull();
    expect(response.user_id).toBe('user-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain('remember_idle_expires_at');
    expect(updates[0].params[1].getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });

  it('rejects a remembered session after its idle restore window expires', async () => {
    let selectSql = '';
    let rolledBack = false;
    const client = {
      async query(sql) {
        if (sql === 'ROLLBACK') rolledBack = true;
        if (sql.includes('SELECT s.*, u.status AS user_status')) {
          selectSql = sql;
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
      release() {},
    };
    const db = {
      async connect() {
        return client;
      },
    };
    const service = createUserImplementation({ db, mailer: {} });

    const { error } = await invoke(service.RestoreSession, { remember_token: 'old-token' });

    expect(error.message).toBe('remember_token_invalid');
    expect(selectSql).toContain('s.remember_idle_expires_at > now()');
    expect(rolledBack).toBe(true);
  });
});
