import { status } from '@grpc/grpc-js';

const TEMPLATES = new Set([
  'email_verification',
  'password_reset',
  'account_activation',
  'project_invitation',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELIVERY_STATUS = {
  pending: 'DELIVERY_STATUS_PENDING',
  sending: 'DELIVERY_STATUS_SENDING',
  sent: 'DELIVERY_STATUS_SENT',
  failed: 'DELIVERY_STATUS_FAILED',
  retrying: 'DELIVERY_STATUS_RETRYING',
};

function grpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fromStruct(value) {
  if (!value || typeof value !== 'object' || !value.fields) return value ?? {};
  return Object.fromEntries(
    Object.entries(value.fields).map(([key, field]) => {
      const kind = field?.kind;
      const property =
        kind === 'stringValue'
          ? 'stringValue'
          : kind === 'numberValue'
            ? 'numberValue'
            : kind === 'boolValue'
              ? 'boolValue'
              : null;
      return [key, property ? field[property] : undefined];
    }),
  );
}

function fromTimestamp(value) {
  if (!value) return null;
  const seconds = Number(value.seconds ?? 0);
  const nanos = Number(value.nanos ?? 0);
  const date = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTimestamp(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  const milliseconds = date.getTime();
  if (Number.isNaN(milliseconds)) return undefined;
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}

function toAuthEmailDelivery(row) {
  return {
    id: row.id,
    job_id: row.job_id,
    user_id: row.user_id ?? '',
    invitation_id: row.invitation_id ?? '',
    recipient_email: row.recipient_email,
    template_code: row.template_code,
    status: DELIVERY_STATUS[row.status] ?? 'DELIVERY_STATUS_UNSPECIFIED',
    attempt_count: Number(row.attempt_count),
    provider_message_id: row.provider_message_id ?? '',
    error_code: row.error_code ?? '',
    error_message: row.error_message ?? '',
    created_at: toTimestamp(row.created_at),
    sent_at: toTimestamp(row.sent_at),
    expires_at: toTimestamp(row.expires_at),
  };
}

export function createAuthEmailImplementation({ db }) {
  return {
    async SendAuthEmail(call, callback) {
      const request = call.request;
      const jobId = String(request.job_id ?? '');
      const recipientEmail = String(request.recipient_email ?? '')
        .trim()
        .toLowerCase();
      const templateCode = String(request.template_code ?? '');
      const expiresAt = fromTimestamp(request.expires_at);
      const variables = fromStruct(request.variables);
      const userId = String(request.user_id ?? '');
      const invitationId = String(request.invitation_id ?? '');

      if (
        !UUID_PATTERN.test(jobId) ||
        (userId && !UUID_PATTERN.test(userId)) ||
        (invitationId && !UUID_PATTERN.test(invitationId)) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)
      ) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_auth_email_request'));
        return;
      }
      if (!TEMPLATES.has(templateCode)) {
        callback(grpcError(status.INVALID_ARGUMENT, 'unsupported_auth_email_template'));
        return;
      }
      if (!expiresAt) {
        callback(grpcError(status.INVALID_ARGUMENT, 'auth_email_expiry_required'));
        return;
      }

      let connection;
      try {
        connection = await db.connect();
        await connection.query('BEGIN');
        await connection.query(
          `INSERT INTO delivery.auth_email_deliveries
             (job_id, user_id, invitation_id, recipient_email, template_code,
              status, variables, locale, expires_at, error_code, error_message)
           VALUES ($1, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, $4, $5,
                   CASE WHEN $8 <= now() THEN 'failed' ELSE 'pending' END,
                   CASE WHEN $8 <= now() THEN '{}'::jsonb ELSE $6::jsonb END,
                   $7, $8,
                   CASE WHEN $8 <= now() THEN 'email_job_expired' ELSE NULL END,
                   CASE WHEN $8 <= now() THEN 'Auth email job expired before dispatch' ELSE NULL END)
           ON CONFLICT (job_id) DO NOTHING`,
          [
            jobId,
            userId,
            invitationId,
            recipientEmail,
            templateCode,
            JSON.stringify(variables),
            String(request.locale ?? 'ru-RU'),
            expiresAt,
          ],
        );
        const result = await connection.query(
          `SELECT * FROM delivery.auth_email_deliveries WHERE job_id = $1 FOR UPDATE`,
          [jobId],
        );
        const delivery = result.rows[0];
        if (
          delivery.recipient_email !== recipientEmail ||
          delivery.template_code !== templateCode ||
          String(delivery.user_id ?? '') !== userId ||
          String(delivery.invitation_id ?? '') !== invitationId
        ) {
          throw grpcError(status.ALREADY_EXISTS, 'auth_email_job_conflict');
        }
        await connection.query('COMMIT');
        callback(null, {
          delivery_id: delivery.id,
          status: DELIVERY_STATUS[delivery.status] ?? 'DELIVERY_STATUS_UNSPECIFIED',
        });
      } catch (error) {
        if (connection) await connection.query('ROLLBACK').catch(() => {});
        callback(error);
      } finally {
        connection?.release();
      }
    },

    async GetAuthEmailStatus(call, callback) {
      const jobId = String(call.request.job_id ?? '');
      if (!jobId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'job_id_required'));
        return;
      }
      try {
        const result = await db.query(
          `SELECT * FROM delivery.auth_email_deliveries WHERE job_id = $1`,
          [jobId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'auth_email_delivery_not_found'));
          return;
        }
        callback(null, { delivery: toAuthEmailDelivery(result.rows[0]) });
      } catch (error) {
        callback(error);
      }
    },
  };
}
