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
    const verificationLink = new URL(JSON.parse(transaction[jobIndex].params[4]).link);
    expect(verificationLink.pathname).toBe('/login');
    expect(verificationLink.searchParams.get('verify')).toBeTruthy();
  });

  it('sends resend-verification emails to the login route', async () => {
    const queries = [];
    const client = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('SELECT * FROM access.users')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'user-1',
                email: 'person@example.com',
                locale: 'ru-RU',
                email_verified_at: null,
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    const service = createUserImplementation({
      db: {
        async connect() {
          return client;
        },
      },
      publicAppUrl: 'https://app.example.com/',
    });

    const { error, response } = await invoke(service.ResendEmailVerification, {
      email: 'PERSON@example.com',
    });

    expect(error).toBeNull();
    expect(response).toEqual({ accepted: true });
    const job = queries.find(({ sql }) => sql.includes('INSERT INTO jobs.auth_email_jobs'));
    const verificationLink = new URL(JSON.parse(job.params[4]).link);
    expect(verificationLink.origin).toBe('https://app.example.com');
    expect(verificationLink.pathname).toBe('/login');
    expect(verificationLink.searchParams.get('verify')).toBeTruthy();
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
      link: expect.stringMatching(/^https:\/\/app\.example\.com\/reset-password\?token=/),
    });
    expect(job.params[5]).toBe('ru-RU');
  });
});

describe('email verification', () => {
  it('consumes a live verification token and marks the user email verified', async () => {
    const statements = [];
    const client = {
      async query(sql, params = []) {
        statements.push({ sql, params });
        if (sql.includes('FROM access.email_verification_tokens')) {
          return { rowCount: 1, rows: [{ id: 'verification-1', user_id: 'user-1' }] };
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    const service = createUserImplementation({
      db: {
        async connect() {
          return client;
        },
      },
    });

    const { error, response } = await invoke(service.VerifyEmail, { token: 'verification-secret' });

    expect(error).toBeNull();
    expect(response).toEqual({ user_id: 'user-1', verified: true });
    const lookup = statements.find(({ sql }) =>
      sql.includes('FROM access.email_verification_tokens'),
    );
    expect(lookup.sql).toContain('used_at IS NULL');
    expect(lookup.sql).toContain('expires_at > now()');
    expect(lookup.params[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(lookup.params[0]).not.toBe('verification-secret');
    expect(statements.some(({ sql }) => sql.includes('SET used_at = now()'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('SET email_verified_at'))).toBe(true);
    expect(statements.some(({ sql }) => sql === 'COMMIT')).toBe(true);
  });

  it('rejects an expired, used, or unknown verification token', async () => {
    let rolledBack = false;
    const service = createUserImplementation({
      db: {
        async connect() {
          return {
            async query(sql) {
              if (sql === 'ROLLBACK') rolledBack = true;
              if (sql.includes('FROM access.email_verification_tokens')) {
                return { rowCount: 0, rows: [] };
              }
              return { rowCount: 1, rows: [] };
            },
            release() {},
          };
        },
      },
    });

    const { error, response } = await invoke(service.VerifyEmail, { token: 'invalid-token' });

    expect(error.code).toBe(3);
    expect(error.message).toBe('invalid_token');
    expect(response).toBeUndefined();
    expect(rolledBack).toBe(true);
  });
});

describe('system settings', () => {
  const defaultSettings = [
    ['password_min_length', 8],
    ['password_max_length', 128],
    ['password_require_complexity', false],
    ['max_failed_attempts', 5],
    ['first_lockout_minutes', 10],
    ['second_lockout_minutes', 60],
    ['third_lockout_permanent', true],
    ['session_absolute_minutes', 60],
    ['session_idle_minutes', 10],
    ['max_sessions', 2],
    ['remember_me_absolute_days', 30],
    ['remember_me_idle_days', 7],
    ['email_verification_hours', 24],
    ['password_reset_hours', 1],
    ['invitation_days', 7],
    ['telegram_link_code_minutes', 10],
  ].map(([key, value]) => ({ key, value, description: `Description: ${key}` }));

  it('validates and atomically stores known settings with an outbox event', async () => {
    const statements = [];
    const storedRows = [...defaultSettings, { key: 'future_setting', value: { value: 'keep' } }];
    const client = {
      async query(sql, params = []) {
        statements.push({ sql, params });
        if (sql.includes('SELECT key, value, description FROM settings.system_settings')) {
          return { rowCount: storedRows.length, rows: storedRows };
        }
        if (sql.includes('SELECT role_code FROM access.user_roles')) {
          return { rowCount: 1, rows: [{ role_code: 'app_admin' }] };
        }
        if (sql.includes('SELECT * FROM settings.system_settings')) {
          return { rowCount: storedRows.length, rows: storedRows };
        }
        if (sql.includes('INSERT INTO settings.system_settings')) {
          storedRows.find((row) => row.key === params[0]).value = JSON.parse(params[1]);
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    const service = createUserImplementation({
      db: {
        async query(sql) {
          if (sql.includes('FROM access.user_roles')) return { rowCount: 1, rows: [{}] };
          return { rowCount: 0, rows: [] };
        },
        async connect() {
          return client;
        },
      },
    });

    const { error, response } = await invoke(service.UpdateSystemSettings, {
      actor_user_id: 'admin-1',
      items: [
        { key: 'max_sessions', value: { value: 4 }, description: 'Ignored existing description' },
      ],
    });

    expect(error).toBeNull();
    expect(response.items.find((item) => item.key === 'max_sessions').value).toEqual({
      fields: { value: { numberValue: 4 } },
    });
    expect(response.items.find((item) => item.key === 'future_setting').value).toEqual({
      fields: { value: { stringValue: 'keep' } },
    });
    const updateIndex = statements.findIndex(({ sql }) =>
      sql.includes('INSERT INTO settings.system_settings'),
    );
    const eventIndex = statements.findIndex(({ sql }) =>
      sql.includes('INSERT INTO events.outbox_events'),
    );
    const commitIndex = statements.findIndex(({ sql }) => sql === 'COMMIT');
    expect(updateIndex).toBeGreaterThan(-1);
    expect(eventIndex).toBeGreaterThan(updateIndex);
    expect(eventIndex).toBeLessThan(commitIndex);
    expect(JSON.parse(statements[eventIndex].params[3])).toEqual({
      keys: ['max_sessions'],
      actorUserId: 'admin-1',
    });
    expect(statements[updateIndex].params[2]).toBe('Description: max_sessions');
  });

  it('rejects unknown and inherited property names before opening a transaction', async () => {
    let connected = false;
    const service = createUserImplementation({
      db: {
        async query(sql) {
          return sql.includes('FROM access.user_roles')
            ? { rowCount: 1, rows: [{}] }
            : { rowCount: 0, rows: [] };
        },
        async connect() {
          connected = true;
          throw new Error('unknown setting should be rejected before opening a transaction');
        },
      },
    });

    const { error } = await invoke(service.UpdateSystemSettings, {
      actor_user_id: 'admin-1',
      items: [{ key: 'constructor', value: { value: 1 } }],
    });

    expect(error.code).toBe(3);
    expect(error.message).toBe('system_setting_unknown');
    expect(connected).toBe(false);
  });

  it('rejects invalid settings and rolls back without writing them', async () => {
    const statements = [];
    const client = {
      async query(sql, params = []) {
        statements.push({ sql, params });
        if (sql.includes('SELECT key, value, description FROM settings.system_settings')) {
          return { rowCount: defaultSettings.length, rows: defaultSettings };
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    const service = createUserImplementation({
      db: {
        async query(sql) {
          return sql.includes('FROM access.user_roles')
            ? { rowCount: 1, rows: [{}] }
            : { rowCount: 0, rows: [] };
        },
        async connect() {
          return client;
        },
      },
    });

    const { error } = await invoke(service.UpdateSystemSettings, {
      actor_user_id: 'admin-1',
      items: [{ key: 'max_sessions', value: { value: 0 } }],
    });

    expect(error.code).toBe(3);
    expect(error.message).toBe('system_setting_invalid:max_sessions');
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO settings.system_settings'))).toBe(
      false,
    );
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO events.outbox_events'))).toBe(
      false,
    );
    expect(statements.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
  });

  it('uses the configured password policy for registration', async () => {
    const settings = defaultSettings.map((row) =>
      row.key === 'password_min_length' ? { ...row, value: 16 } : row,
    );
    let connected = false;
    const service = createUserImplementation({
      db: {
        async query(sql) {
          return sql.includes('FROM settings.system_settings')
            ? { rowCount: settings.length, rows: settings }
            : { rowCount: 0, rows: [] };
        },
        async connect() {
          connected = true;
          throw new Error('registration should reject before opening a transaction');
        },
      },
    });

    const { error } = await invoke(service.Register, {
      email: 'person@example.com',
      password: 'short-pass',
      last_name: 'Иванов',
      first_name: 'Иван',
    });

    expect(error.code).toBe(3);
    expect(error.message).toBe('invalid_password');
    expect(connected).toBe(false);
  });
});

describe('password reset', () => {
  it('returns the account email only for a live reset token', async () => {
    let request;
    const service = createUserImplementation({
      db: {
        async query(sql, params) {
          request = { sql, params };
          return { rowCount: 1, rows: [{ email: 'person@example.com' }] };
        },
      },
    });

    const { error, response } = await invoke(service.ValidatePasswordResetToken, {
      token: 'secret-reset-token',
    });

    expect(error).toBeNull();
    expect(response).toEqual({ email: 'person@example.com' });
    expect(request.sql).toContain('t.used_at IS NULL AND t.expires_at > now()');
    expect(request.params[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(request.params[0]).not.toBe('secret-reset-token');
  });

  it('rejects an unknown, expired, or already-used reset token', async () => {
    const service = createUserImplementation({
      db: {
        async query() {
          return { rowCount: 0, rows: [] };
        },
      },
    });

    const { error } = await invoke(service.ValidatePasswordResetToken, { token: 'stale-token' });

    expect(error.code).toBe(3);
    expect(error.message).toBe('invalid_token');
  });

  it('persists the new Argon2 password, consumes the token, and revokes sessions', async () => {
    const statements = [];
    let storedHash;
    const client = {
      async query(sql, params = []) {
        statements.push({ sql, params });
        if (sql.includes('SELECT id, user_id FROM access.password_reset_tokens')) {
          return { rowCount: 1, rows: [{ id: 'reset-1', user_id: 'user-1' }] };
        }
        if (sql.includes('UPDATE access.users SET password_hash')) storedHash = params[1];
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
    const service = createUserImplementation({ db });

    const { error, response } = await invoke(service.ResetPassword, {
      token: 'valid-reset-token',
      new_password: 'NewPassword456!',
    });

    expect(error).toBeNull();
    expect(response.reset).toBe(true);
    expect(storedHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(storedHash, 'NewPassword456!')).toBe(true);
    expect(await verifyPassword(storedHash, 'OldPassword123!')).toBe(false);
    expect(
      statements.some(({ sql }) => sql.includes('UPDATE access.password_reset_tokens SET used_at')),
    ).toBe(true);
    expect(
      statements.some(({ sql }) => sql.includes('UPDATE access.user_sessions SET revoked_at')),
    ).toBe(true);
    expect(statements.some(({ sql }) => sql === 'COMMIT')).toBe(true);
  });
});
