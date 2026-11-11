import nodemailer from 'nodemailer';
import { buildSmtpUrl } from '@rp-gant/service-kit';

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;
const LEASE_MS = 60_000;

function requiredLink(variables) {
  const link = String(variables?.link ?? '');
  if (!/^https?:\/\//i.test(link)) throw new Error('auth_email_link_invalid');
  return link;
}

export function renderAuthEmail(templateCode, variables = {}, locale = 'ru-RU') {
  const link = requiredLink(variables);
  const russian = String(locale).toLowerCase().startsWith('ru');
  const templates = {
    email_verification: russian
      ? {
          subject: 'Подтвердите адрес электронной почты RP Gant',
          text: `Подтвердите адрес электронной почты: ${link}`,
        }
      : { subject: 'Verify your RP Gant email', text: `Verify your email: ${link}` },
    password_reset: russian
      ? { subject: 'Сброс пароля RP Gant', text: `Чтобы сбросить пароль, откройте ссылку: ${link}` }
      : { subject: 'Reset your RP Gant password', text: `Reset your password: ${link}` },
    account_activation: russian
      ? { subject: 'Аккаунт RP Gant создан', text: `Чтобы задать пароль, откройте ссылку: ${link}` }
      : { subject: 'RP Gant account created', text: `Set your password: ${link}` },
    project_invitation: russian
      ? { subject: 'Приглашение в проект RP Gant', text: `Откройте приглашение в проект: ${link}` }
      : { subject: 'Invitation to RP Gant', text: `Accept the project invitation: ${link}` },
  };
  const message = templates[templateCode];
  if (!message) throw new Error(`unsupported_auth_email_template:${templateCode}`);
  return message;
}

export async function processAuthEmailDeliveries(db, transporter, env = process.env) {
  const connection = await db.connect();
  let deliveries;
  try {
    await connection.query('BEGIN');
    const result = await connection.query(
      `SELECT id, job_id, recipient_email, template_code, variables, locale,
              attempt_count, expires_at
       FROM delivery.auth_email_deliveries
       WHERE status IN ('pending', 'retrying', 'sending')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 10`,
    );
    deliveries = result.rows;
    for (const delivery of deliveries) {
      await connection.query(
        `UPDATE delivery.auth_email_deliveries
         SET status = 'sending', attempt_count = attempt_count + 1,
             next_attempt_at = now() + ($2 * interval '1 millisecond'), updated_at = now()
         WHERE id = $1`,
        [delivery.id, LEASE_MS],
      );
      delivery.attempt_count = Number(delivery.attempt_count) + 1;
    }
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  for (const delivery of deliveries) {
    const attemptNo = Number(delivery.attempt_count);
    const attempt = await db.query(
      `INSERT INTO delivery.auth_email_delivery_attempts (delivery_id, attempt_no, status)
       VALUES ($1, $2, 'started') RETURNING id`,
      [delivery.id, attemptNo],
    );
    try {
      if (new Date(delivery.expires_at).getTime() <= Date.now()) {
        throw new Error('auth_email_job_expired');
      }
      if (!transporter) throw new Error('smtp_not_configured');
      const message = renderAuthEmail(
        delivery.template_code,
        delivery.variables ?? {},
        delivery.locale,
      );
      const sent = await transporter.sendMail({
        from: env.SMTP_FROM ?? 'RP Gant <no-reply@rp-gant.local>',
        to: delivery.recipient_email,
        ...message,
      });
      await db.query(
        `UPDATE delivery.auth_email_deliveries
         SET status = 'sent', variables = '{}'::jsonb, next_attempt_at = NULL,
             provider_message_id = $2, error_code = NULL, error_message = NULL,
             sent_at = now(), updated_at = now()
         WHERE id = $1`,
        [delivery.id, sent.messageId ?? null],
      );
      await db.query(
        `UPDATE delivery.auth_email_delivery_attempts
         SET status = 'sent', provider_message_id = $2, finished_at = now()
         WHERE id = $1`,
        [attempt.rows[0].id, sent.messageId ?? null],
      );
    } catch (error) {
      const message = String(error.message ?? error).slice(0, 500);
      const failed = attemptNo >= MAX_ATTEMPTS || message === 'auth_email_job_expired';
      const code = message.slice(0, 64);
      await db.query(
        `UPDATE delivery.auth_email_deliveries
         SET status = $2::varchar(16),
             variables = CASE WHEN $2::varchar(16) = 'failed' THEN '{}'::jsonb ELSE variables END,
             next_attempt_at = CASE WHEN $2::varchar(16) = 'retrying'
               THEN now() + ($3 * interval '1 second') ELSE NULL END,
             error_code = $4, error_message = $5, updated_at = now()
         WHERE id = $1`,
        [
          delivery.id,
          failed ? 'failed' : 'retrying',
          Math.min(300, 2 ** attemptNo * 5),
          code,
          message,
        ],
      );
      await db.query(
        `UPDATE delivery.auth_email_delivery_attempts
         SET status = 'failed', error_code = $2, error_message = $3, finished_at = now()
         WHERE id = $1`,
        [attempt.rows[0].id, code, message],
      );
    }
  }

  return deliveries.length;
}

export function startAuthEmailDeliveryWorker(db, env = process.env, logger = console) {
  const smtpUrl = buildSmtpUrl(env);
  const transporter = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  let stopped = false;
  let running = false;
  const process = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processAuthEmailDeliveries(db, transporter, env);
    } catch (error) {
      logger.error?.({ err: error }, 'auth email delivery worker failed');
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
    transporter?.close();
  };
}
