import { describe, expect, it } from 'vitest';
import { processAuthEmailJobs } from '../src/auth-email-worker.js';

function makeDb(job) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('SELECT id, user_id, invitation_id')) return { rows: [job], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    queries,
    async connect() {
      return client;
    },
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
}

const job = {
  id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-000000000002',
  invitation_id: null,
  recipient_email: 'person@example.com',
  template_code: 'password_reset',
  variables: { link: 'https://example.com/reset?token=secret' },
  locale: 'en-US',
  attempts: 0,
  expires_at: new Date('2030-01-01T00:00:00.000Z'),
};

describe('auth email job worker', () => {
  it('dispatches through Notification Service and scrubs token variables after durable acceptance', async () => {
    const db = makeDb({ ...job });
    let request;
    const notificationClient = {
      SendAuthEmail(value, callback) {
        request = value;
        callback(null, { delivery_id: 'delivery-1', status: 'DELIVERY_STATUS_PENDING' });
      },
    };

    await expect(processAuthEmailJobs(db, notificationClient)).resolves.toBe(1);

    expect(request).toMatchObject({
      job_id: job.id,
      user_id: job.user_id,
      recipient_email: job.recipient_email,
      template_code: job.template_code,
      variables: {
        fields: {
          link: { kind: 'stringValue', stringValue: job.variables.link },
        },
      },
      locale: 'en-US',
      expires_at: { seconds: '1893456000', nanos: 0 },
    });
    const completion = db.queries.find(({ sql }) => sql.includes("SET status = 'sent'"));
    expect(completion.sql).toContain("variables = '{}'::jsonb");
    expect(completion.params).toEqual([job.id]);
  });

  it('backs off transient RPC errors and stops retrying at the attempt limit', async () => {
    const retryDb = makeDb({ ...job, attempts: 2 });
    const notificationClient = {
      SendAuthEmail(_request, callback) {
        callback(new Error('notification_unavailable'));
      },
    };
    await processAuthEmailJobs(retryDb, notificationClient);
    const retry = retryDb.queries.find(
      ({ sql, params }) => sql.includes('SET status = $2') && params[0] === job.id,
    );
    expect(retry.params[1]).toBe('pending');
    expect(retry.params[2]).toBe(40);
    expect(retry.params[3]).toBe('notification_unavailable');

    const exhaustedDb = makeDb({ ...job, attempts: 4 });
    await processAuthEmailJobs(exhaustedDb, notificationClient);
    const failed = exhaustedDb.queries.find(
      ({ sql, params }) => sql.includes('SET status = $2') && params[0] === job.id,
    );
    expect(failed.params[1]).toBe('failed');
    expect(failed.sql).toContain("THEN '{}'::jsonb");
  });
});
