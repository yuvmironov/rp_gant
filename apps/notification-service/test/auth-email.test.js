import { describe, expect, it } from 'vitest';
import { createAuthEmailImplementation } from '../src/auth-email.js';
import { processAuthEmailDeliveries, renderAuthEmail } from '../src/auth-email-worker.js';

function invoke(method, request) {
  return new Promise((resolve) =>
    method({ request }, (error, response) => resolve({ error, response })),
  );
}

function makeDb(row) {
  const queries = [];
  const connection = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('SELECT * FROM delivery.auth_email_deliveries')) {
        return { rows: [row], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    queries,
    async connect() {
      return connection;
    },
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
}

const request = {
  job_id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-000000000002',
  recipient_email: 'person@example.com',
  template_code: 'password_reset',
  variables: { link: 'https://example.com/reset?token=secret' },
  locale: 'ru-RU',
  expires_at: { seconds: '1893456000', nanos: 0 },
};

const delivery = {
  id: '00000000-0000-4000-8000-000000000003',
  job_id: request.job_id,
  user_id: request.user_id,
  invitation_id: null,
  recipient_email: request.recipient_email,
  template_code: request.template_code,
  status: 'pending',
  attempt_count: 0,
};

describe('Notification Service auth email RPC', () => {
  it('durably enqueues a supported template with a job-id idempotency key', async () => {
    const db = makeDb(delivery);
    const service = createAuthEmailImplementation({ db });
    const { error, response } = await invoke(service.SendAuthEmail, request);

    expect(error).toBeNull();
    expect(response).toEqual({
      delivery_id: delivery.id,
      status: 'DELIVERY_STATUS_PENDING',
    });
    const insert = db.queries.find(({ sql }) =>
      sql.includes('INSERT INTO delivery.auth_email_deliveries'),
    );
    expect(insert.sql).toContain('ON CONFLICT (job_id) DO NOTHING');
    expect(insert.params).toEqual([
      request.job_id,
      request.user_id,
      '',
      request.recipient_email,
      request.template_code,
      JSON.stringify(request.variables),
      request.locale,
      new Date(1893456000000),
    ]);
  });

  it('rejects unsupported templates and job-id payload conflicts', async () => {
    const service = createAuthEmailImplementation({ db: makeDb(delivery) });
    const invalid = await invoke(service.SendAuthEmail, {
      ...request,
      template_code: 'custom_html',
    });
    expect(invalid.error.message).toBe('unsupported_auth_email_template');

    const conflict = await invoke(
      createAuthEmailImplementation({
        db: makeDb({ ...delivery, recipient_email: 'other@example.com' }),
      }).SendAuthEmail,
      request,
    );
    expect(conflict.error.message).toBe('auth_email_job_conflict');
  });
});

describe('auth email delivery worker', () => {
  it('sends a queued message, records provider metadata, and scrubs secret variables', async () => {
    const queries = [];
    const connection = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('SELECT id, job_id, recipient_email')) {
          return {
            rows: [
              {
                ...delivery,
                variables: request.variables,
                locale: 'en-US',
                expires_at: new Date('2030-01-01T00:00:00.000Z'),
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const db = {
      async connect() {
        return connection;
      },
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('INSERT INTO delivery.auth_email_delivery_attempts')) {
          return { rows: [{ id: 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    let sentMessage;
    const transporter = {
      async sendMail(message) {
        sentMessage = message;
        return { messageId: 'smtp-id-1' };
      },
    };

    await expect(
      processAuthEmailDeliveries(db, transporter, { SMTP_FROM: 'RP Gant <mail@example.com>' }),
    ).resolves.toBe(1);

    expect(sentMessage).toMatchObject({
      from: 'RP Gant <mail@example.com>',
      to: request.recipient_email,
      subject: 'Reset your RP Gant password',
      text: `Reset your password: ${request.variables.link}`,
    });
    expect(queries.some(({ sql }) => sql.includes("variables = '{}'::jsonb"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes("SET status = 'sent'"))).toBe(true);
  });

  it('persists a retry schedule and error journal after SMTP failure', async () => {
    const queries = [];
    const connection = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('SELECT id, job_id, recipient_email')) {
          return {
            rows: [
              {
                ...delivery,
                variables: request.variables,
                locale: 'en-US',
                expires_at: new Date('2030-01-01T00:00:00.000Z'),
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const db = {
      async connect() {
        return connection;
      },
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('INSERT INTO delivery.auth_email_delivery_attempts')) {
          return { rows: [{ id: 2 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const transporter = {
      async sendMail() {
        throw new Error('smtp temporarily unavailable');
      },
    };

    await expect(processAuthEmailDeliveries(db, transporter)).resolves.toBe(1);

    const retry = queries.find(({ sql }) => sql.includes('SET status = $2::varchar(16)'));
    expect(retry.params.slice(0, 4)).toEqual([
      delivery.id,
      'retrying',
      10,
      'smtp temporarily unavailable',
    ]);
    const attempt = queries.find(({ sql }) => sql.includes("SET status = 'failed'"));
    expect(attempt.params).toEqual([
      2,
      'smtp temporarily unavailable',
      'smtp temporarily unavailable',
    ]);
  });
});

describe('auth email templates', () => {
  it('renders localized text only for a validated HTTP(S) link', () => {
    expect(
      renderAuthEmail('email_verification', { link: 'https://example.com/verify' }, 'ru-RU'),
    ).toEqual({
      subject: 'Подтвердите адрес электронной почты RP Gant',
      text: 'Подтвердите адрес электронной почты: https://example.com/verify',
    });
    expect(() => renderAuthEmail('password_reset', { link: 'javascript:alert(1)' })).toThrow(
      'auth_email_link_invalid',
    );
  });
});
