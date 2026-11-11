import { callNotification, toNotificationStruct } from './notification-client.js';

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;
const LEASE_MS = 60_000;

function toTimestamp(value) {
  const milliseconds = new Date(value).getTime();
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}

export async function processAuthEmailJobs(db, notificationClient) {
  const connection = await db.connect();
  let jobs;
  try {
    await connection.query('BEGIN');
    await connection.query(
      `UPDATE jobs.auth_email_jobs
       SET status = 'failed', variables = '{}'::jsonb, last_error = 'email_job_expired'
       WHERE status IN ('pending', 'sending') AND expires_at <= now()`,
    );
    const selected = await connection.query(
      `SELECT id, user_id, invitation_id, recipient_email, template_code,
              variables, locale, attempts, expires_at
       FROM jobs.auth_email_jobs
       WHERE status IN ('pending', 'sending')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND expires_at > now()
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 10`,
    );
    jobs = selected.rows;
    for (const job of jobs) {
      await connection.query(
        `UPDATE jobs.auth_email_jobs
         SET status = 'sending', attempts = attempts + 1,
             next_attempt_at = now() + ($2 * interval '1 millisecond')
         WHERE id = $1`,
        [job.id, LEASE_MS],
      );
      job.attempts = Number(job.attempts) + 1;
    }
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  for (const job of jobs) {
    try {
      const response = await callNotification(notificationClient, 'SendAuthEmail', {
        job_id: job.id,
        user_id: job.user_id ?? '',
        invitation_id: job.invitation_id ?? '',
        recipient_email: job.recipient_email,
        template_code: job.template_code,
        variables: toNotificationStruct(job.variables ?? {}),
        locale: job.locale ?? 'ru-RU',
        expires_at: toTimestamp(job.expires_at),
      });
      if (!response?.delivery_id) throw new Error('auth_email_delivery_not_accepted');
      if (response.status === 'DELIVERY_STATUS_FAILED') {
        await db.query(
          `UPDATE jobs.auth_email_jobs
           SET status = 'failed', variables = '{}'::jsonb,
               next_attempt_at = NULL, last_error = 'notification_delivery_failed'
           WHERE id = $1`,
          [job.id],
        );
        continue;
      }
      await db.query(
        `UPDATE jobs.auth_email_jobs
         SET status = 'sent', variables = '{}'::jsonb, sent_at = now(),
             next_attempt_at = NULL, last_error = NULL
         WHERE id = $1`,
        [job.id],
      );
    } catch (error) {
      const attempts = Number(job.attempts);
      const failed = attempts >= MAX_ATTEMPTS;
      await db.query(
        `UPDATE jobs.auth_email_jobs
         SET status = $2::varchar(16),
             variables = CASE WHEN $2::varchar(16) = 'failed' THEN '{}'::jsonb ELSE variables END,
             next_attempt_at = CASE WHEN $2::varchar(16) = 'pending'
               THEN now() + ($3 * interval '1 second') ELSE NULL END,
             last_error = $4
         WHERE id = $1`,
        [
          job.id,
          failed ? 'failed' : 'pending',
          Math.min(300, 2 ** attempts * 5),
          String(error.message ?? error).slice(0, 500),
        ],
      );
    }
  }

  return jobs.length;
}

export function startAuthEmailJobWorker(db, notificationClient, logger = console) {
  let stopped = false;
  let running = false;
  const process = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processAuthEmailJobs(db, notificationClient);
    } catch (error) {
      logger.error?.({ err: error }, 'auth email job worker failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(process, POLL_INTERVAL_MS);
  timer.unref?.();
  void process();
  return async () => {
    stopped = true;
    clearInterval(timer);
  };
}
