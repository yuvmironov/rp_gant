import { createHash, randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { getActorRoles, queueUserEvent } from './events.js';
import { status } from '@grpc/grpc-js';

const SESSION_ABSOLUTE_MS = 60 * 60 * 1000;
const SESSION_IDLE_MS = 10 * 60 * 1000;
const REMEMBER_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
const REMEMBER_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_SESSION_PREDICATE = `(
  (absolute_expires_at > now() AND idle_expires_at > now())
  OR (
    remember_token_hash IS NOT NULL
    AND remember_absolute_expires_at > now()
    AND remember_idle_expires_at > now()
  )
)`;
const EMAIL_VERIFICATION_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_MS = 60 * 60 * 1000;
const INVITATION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = '__Host-session';
const REMEMBER_COOKIE = '__Host-remember';
const CSRF_COOKIE = '__Host-csrf';

function grpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function mapDbError(error) {
  if (error.code === '23505') {
    if (String(error.constraint ?? '').includes('executor')) {
      return grpcError(status.ALREADY_EXISTS, 'executor_conflict');
    }
    return grpcError(status.ALREADY_EXISTS, 'email_taken');
  }
  if (error.message === 'session_limit_reached') {
    return grpcError(status.ABORTED, 'session_limit_reached');
  }
  return error;
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email) {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function toProjectRole(role) {
  return (
    {
      project_owner: 'PROJECT_ROLE_OWNER',
      project_manager: 'PROJECT_ROLE_MANAGER',
      project_editor: 'PROJECT_ROLE_EDITOR',
      project_participant: 'PROJECT_ROLE_PARTICIPANT',
      project_viewer: 'PROJECT_ROLE_VIEWER',
    }[role] ?? 'PROJECT_ROLE_UNSPECIFIED'
  );
}

function toMembership(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    user_id: row.user_id,
    role: toProjectRole(row.role_code),
    status: row.status,
    invited_at: toTimestamp(row.invited_at),
    joined_at: toTimestamp(row.joined_at),
    revoked_at: toTimestamp(row.revoked_at),
    revoked_reason: row.revoked_reason ?? '',
    user: row.email ? toUserSummary(row) : undefined,
  };
}

function toUser(row, roles) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    last_name: row.last_name ?? '',
    first_name: row.first_name ?? '',
    middle_name: row.middle_name ?? '',
    position: row.position ?? '',
    status: row.status === 'blocked' ? 'USER_STATUS_BLOCKED' : 'USER_STATUS_ACTIVE',
    email_verified: Boolean(row.email_verified_at),
    email_verified_at: toTimestamp(row.email_verified_at),
    timezone: row.timezone,
    locale: row.locale,
    global_roles: roles.filter((role) => role === 'app_admin').map(() => 'GLOBAL_ROLE_APP_ADMIN'),
    last_login_at: toTimestamp(row.last_login_at),
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
  };
}

function toExecutor(row) {
  return {
    id: row.id,
    last_name: row.last_name,
    first_name: row.first_name,
    middle_name: row.middle_name ?? '',
    full_name: row.full_name,
    position: row.position ?? '',
    linked_user_id: row.linked_user_id ?? '',
    is_active: row.is_active,
    created_at: toTimestamp(row.created_at),
    updated_at: toTimestamp(row.updated_at),
  };
}

function fromProjectRole(role) {
  return (
    {
      PROJECT_ROLE_OWNER: 'project_owner',
      PROJECT_ROLE_MANAGER: 'project_manager',
      PROJECT_ROLE_EDITOR: 'project_editor',
      PROJECT_ROLE_PARTICIPANT: 'project_participant',
      PROJECT_ROLE_VIEWER: 'project_viewer',
    }[role] ?? null
  );
}

function toUserSummary(row) {
  return {
    id: row.user_id ?? row.id,
    email: row.email,
    display_name: row.display_name,
    position: row.position ?? '',
    status: row.status === 'blocked' ? 'USER_STATUS_BLOCKED' : 'USER_STATUS_ACTIVE',
    email_verified: Boolean(row.email_verified_at),
    global_roles: [],
  };
}

function toInvitation(row) {
  const status =
    row.accepted_at != null
      ? 'accepted'
      : row.revoked_at != null
        ? 'revoked'
        : new Date(row.expires_at) <= new Date()
          ? 'expired'
          : 'pending';
  return {
    id: row.id,
    project_id: row.project_id,
    email: row.email,
    role: toProjectRole(row.role_code),
    status,
    expires_at: toTimestamp(row.expires_at),
    accepted_at: toTimestamp(row.accepted_at),
    revoked_at: toTimestamp(row.revoked_at),
    invited_by_user_id: row.invited_by_user_id ?? '',
  };
}

async function canManageProject(db, projectId, userId) {
  if (!userId) return false;
  const result = await db.query(
    `SELECT 1
     FROM access.project_memberships m
     JOIN access.role_permissions rp
       ON rp.role_code = m.role_code AND rp.permission_code = 'project.members.manage'
     WHERE m.project_id = $1 AND m.user_id = $2 AND m.status = 'active'
     UNION ALL
     SELECT 1 FROM access.user_roles
     WHERE user_id = $2 AND role_code = 'app_admin'
     LIMIT 1`,
    [projectId, userId],
  );
  return result.rowCount > 0;
}

async function canManageExecutors(db, userId) {
  if (!userId) return false;
  const result = await db.query(
    `SELECT 1 FROM access.user_roles WHERE user_id = $1 AND role_code = 'app_admin'
     UNION ALL
     SELECT 1 FROM access.project_memberships
     WHERE user_id = $1 AND role_code = 'project_owner' AND status = 'active'
     LIMIT 1`,
    [userId],
  );
  return result.rowCount > 0;
}

async function isAdmin(db, userId) {
  if (!userId) return false;
  const result = await db.query(
    `SELECT 1 FROM access.user_roles WHERE user_id = $1 AND role_code = 'app_admin'`,
    [userId],
  );
  return result.rowCount > 0;
}

async function findUserByEmail(db, email) {
  const result = await db.query('SELECT * FROM access.users WHERE email = $1', [email]);
  return result.rows[0] ?? null;
}

function invitationLink(publicAppUrl, token) {
  return `${publicAppUrl.replace(/\/$/, '')}/login?invitation=${encodeURIComponent(token)}`;
}

function resetLink(publicAppUrl, token) {
  return `${publicAppUrl.replace(/\/$/, '')}/login?reset=${encodeURIComponent(token)}`;
}

async function queueAuthEmail(
  queryable,
  { userId, invitationId, email, templateCode, variables, locale = 'ru-RU', expiresAt },
) {
  await queryable.query(
    `INSERT INTO jobs.auth_email_jobs
       (user_id, invitation_id, recipient_email, template_code, variables, locale, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      userId ?? null,
      invitationId ?? null,
      normalizeEmail(email),
      templateCode,
      JSON.stringify(variables ?? {}),
      locale,
      expiresAt,
    ],
  );
}

const telegramCodes = new Map();

function settingsStructValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
}

function storedSettingsValue(value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    'value' in value
  ) {
    return value.value;
  }
  return value ?? {};
}

function toSettings(row) {
  return {
    key: row.key,
    value: settingsStructValue(row.value),
    description: row.description ?? '',
    updated_by_user_id: row.updated_by_user_id ?? '',
    updated_at: toTimestamp(row.updated_at),
  };
}

function rolesFromRequest(roles) {
  return (roles ?? []).filter((role) => role === 'GLOBAL_ROLE_APP_ADMIN').map(() => 'app_admin');
}

function cookie(name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'Secure', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function clearCookie(name) {
  return cookie(name, '', { maxAge: 0 });
}

function loginCookies({ sessionToken, rememberToken, csrfToken, remember }) {
  const values = [
    cookie(SESSION_COOKIE, sessionToken),
    cookie(CSRF_COOKIE, csrfToken, { httpOnly: false }),
  ];
  if (remember && rememberToken) {
    values.push(
      cookie(REMEMBER_COOKIE, rememberToken, {
        maxAge: Math.floor(REMEMBER_ABSOLUTE_MS / 1000),
      }),
    );
  }
  return values;
}

function logoutCookies() {
  return [clearCookie(SESSION_COOKIE), clearCookie(REMEMBER_COOKIE), clearCookie(CSRF_COOKIE)];
}

async function getRoles(queryable, userId) {
  const result = await queryable.query(
    'SELECT role_code FROM access.user_roles WHERE user_id = $1',
    [userId],
  );
  return result.rows.map((row) => row.role_code);
}

export async function hashPassword(password) {
  return argonHash(password);
}

export async function verifyPassword(passwordHash, password) {
  return argonVerify(passwordHash, password);
}

export async function ensureDevAdmin(db, env = process.env) {
  const email = normalizeEmail(env.DEV_ADMIN_EMAIL ?? '');
  const password = String(env.DEV_ADMIN_PASSWORD ?? '');
  if (!email || !password) return false;

  const lastName =
    String(env.DEV_ADMIN_LAST_NAME ?? '').trim() ||
    'Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂє';
  const firstName =
    String(env.DEV_ADMIN_FIRST_NAME ?? '').trim() ||
    'Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР Р†Р вЂљРІР‚СљР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРІвЂћСћР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р вЂ Р В РІР‚С™Р РЋРІР‚С”Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РІР‚вЂњР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р В РІР‚С™Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРІР‚СњР В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРІвЂћСћ';
  const middleName = String(env.DEV_ADMIN_MIDDLE_NAME ?? '').trim() || null;
  const displayName = `${lastName} ${firstName}`.trim();
  const passwordHash = await hashPassword(password);

  const existing = await db.query('SELECT id FROM access.users WHERE email = $1', [email]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const result = await db.query(
      `INSERT INTO access.users
         (email, password_hash, display_name, last_name, first_name, middle_name, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING id`,
      [email, passwordHash, displayName, lastName, firstName, middleName],
    );
    userId = result.rows[0].id;
  } else {
    await db.query(
      `UPDATE access.users
       SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()),
           status = 'active', updated_at = now()
       WHERE id = $1`,
      [userId, passwordHash],
    );
  }
  await db.query(
    `INSERT INTO access.user_roles (user_id, role_code)
     VALUES ($1, 'app_admin')
     ON CONFLICT DO NOTHING`,
    [userId],
  );
  await db.query(
    `UPDATE access.user_sessions
     SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return true;
}

export function createUserImplementation({
  db,
  devAutoVerify = false,
  publicAppUrl = process.env.PUBLIC_APP_URL ?? 'https://app.rp-gant.localhost',
}) {
  return {
    async Register(call, callback) {
      const email = normalizeEmail(call.request.email);
      const password = String(call.request.password ?? '');
      const lastName = String(call.request.last_name ?? '').trim();
      const firstName = String(call.request.first_name ?? '').trim();
      const middleName = String(call.request.middle_name ?? '').trim();
      const displayName =
        String(call.request.display_name ?? '').trim() || `${lastName} ${firstName}`.trim();

      if (!isValidEmail(email)) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_email'));
        return;
      }
      if (password.length < 8 || password.length > 128) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_password'));
        return;
      }
      if (!lastName || !firstName || !displayName) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_name'));
        return;
      }

      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const passwordHash = await hashPassword(password);
        const timezone = String(call.request.timezone ?? 'Europe/Moscow');
        const locale = String(call.request.locale ?? 'ru-RU');
        const emailVerifiedAt = devAutoVerify ? new Date() : null;
        const result = await client.query(
          `INSERT INTO access.users
             (email, password_hash, display_name, last_name, first_name, middle_name,
              timezone, locale, email_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            email,
            passwordHash,
            displayName,
            lastName,
            firstName,
            middleName || null,
            timezone,
            locale,
            emailVerifiedAt,
          ],
        );
        const userId = result.rows[0].id;
        if (!devAutoVerify) {
          const token = randomToken();
          await client.query(
            `INSERT INTO access.email_verification_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, now() + ($3 * interval '1 millisecond'))`,
            [userId, hashToken(token), EMAIL_VERIFICATION_MS],
          );
          await queueAuthEmail(client, {
            userId,
            email,
            templateCode: 'email_verification',
            variables: {
              link: `${publicAppUrl.replace(/\/$/, '')}/?verify=${encodeURIComponent(token)}`,
            },
            locale,
            expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_MS),
          });
        }

        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.created',
          actorUserId: userId,
          entityType: 'user',
          entityId: userId,
          payload: { userId },
        }).catch(() => {});
        callback(null, {
          user_id: userId,
          requires_email_verification: !devAutoVerify,
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async VerifyEmail(call, callback) {
      const token = String(call.request.token ?? '');
      if (!token) {
        callback(grpcError(status.INVALID_ARGUMENT, 'token_required'));
        return;
      }

      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT id, user_id
           FROM access.email_verification_tokens
           WHERE token_hash = $1
             AND used_at IS NULL
             AND expires_at > now()
           FOR UPDATE`,
          [hashToken(token)],
        );
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_token'));
          return;
        }

        const row = result.rows[0];
        await client.query(
          `UPDATE access.email_verification_tokens
           SET used_at = now()
           WHERE id = $1`,
          [row.id],
        );
        await client.query(
          `UPDATE access.users
           SET email_verified_at = COALESCE(email_verified_at, now()),
               updated_at = now()
           WHERE id = $1`,
          [row.user_id],
        );
        await client.query('COMMIT');
        callback(null, { user_id: row.user_id, verified: true });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async Login(call, callback) {
      const email = normalizeEmail(call.request.email);
      const password = String(call.request.password ?? '');
      const remember = Boolean(call.request.remember_me);

      if (!email || !password) {
        callback(grpcError(status.INVALID_ARGUMENT, 'credentials_required'));
        return;
      }

      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const userResult = await client.query(
          'SELECT * FROM access.users WHERE email = $1 FOR UPDATE',
          [email],
        );
        if (userResult.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.UNAUTHENTICATED, 'invalid_credentials'));
          return;
        }

        const user = userResult.rows[0];
        if (user.status === 'blocked') {
          await client.query('ROLLBACK');
          callback(grpcError(status.PERMISSION_DENIED, 'account_blocked'));
          return;
        }
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          await client.query('ROLLBACK');
          callback(grpcError(status.FAILED_PRECONDITION, 'account_locked'));
          return;
        }

        const passwordMatches = await verifyPassword(user.password_hash, password);
        if (!passwordMatches) {
          let attempts = Number(user.failed_login_attempts) + 1;
          let level = Number(user.lockout_level);
          let lockedUntil = user.locked_until;
          let userStatus = user.status;

          if (attempts >= 5) {
            level = Math.min(level + 1, 3);
            attempts = 0;
            if (level >= 3) {
              userStatus = 'blocked';
              lockedUntil = null;
            } else {
              lockedUntil = new Date(Date.now() + (level === 1 ? 10 : 60) * 60 * 1000);
            }
          }

          await client.query(
            `UPDATE access.users
             SET failed_login_attempts = $1,
                 lockout_level = $2,
                 locked_until = $3,
                 status = $4,
                 updated_at = now()
             WHERE id = $5`,
            [attempts, level, lockedUntil, userStatus, user.id],
          );
          await client.query('COMMIT');
          await queueUserEvent(db, {
            aggregateType: 'user',
            aggregateId: user.id,
            eventType: 'auth.login.failed',
            actorUserId: user.id,
            entityType: 'user',
            entityId: user.id,
            payload: { userId: user.id, reasonCode: 'invalid_credentials' },
          }).catch(() => {});
          callback(grpcError(status.UNAUTHENTICATED, 'invalid_credentials'));
          return;
        }

        if (!user.email_verified_at) {
          await client.query('ROLLBACK');
          callback(grpcError(status.PERMISSION_DENIED, 'email_not_verified'));
          return;
        }

        await client.query(
          `UPDATE access.user_sessions
           SET revoked_at = now()
           WHERE user_id = $1
             AND revoked_at IS NULL
             AND NOT ${ACTIVE_SESSION_PREDICATE}`,
          [user.id],
        );

        const sessionToken = randomToken();
        const rememberToken = remember ? randomToken() : null;
        const csrfToken = randomToken();
        const now = Date.now();
        const absoluteExpiresAt = new Date(
          now + (remember ? REMEMBER_ABSOLUTE_MS : SESSION_ABSOLUTE_MS),
        );
        const idleExpiresAt = new Date(now + (remember ? REMEMBER_IDLE_MS : SESSION_IDLE_MS));

        const sessionResult = await client.query(
          `INSERT INTO access.user_sessions
             (user_id, session_token_hash, absolute_expires_at, idle_expires_at,
              remember_token_hash, remember_absolute_expires_at, remember_idle_expires_at,
              user_agent, ip, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           RETURNING id`,
          [
            user.id,
            hashToken(sessionToken),
            absoluteExpiresAt,
            idleExpiresAt,
            rememberToken ? hashToken(rememberToken) : null,
            remember ? absoluteExpiresAt : null,
            remember ? idleExpiresAt : null,
            String(call.request.user_agent ?? '') || null,
            String(call.request.client_ip ?? '') || null,
          ],
        );

        await client.query(
          `UPDATE access.users
           SET failed_login_attempts = 0,
               lockout_level = 0,
               locked_until = NULL,
               last_login_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [user.id],
        );

        const roles = await getRoles(client, user.id);
        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: user.id,
          eventType: 'auth.login.succeeded',
          actorUserId: user.id,
          entityType: 'user',
          entityId: user.id,
          payload: { userId: user.id, sessionId: sessionResult.rows[0].id },
        }).catch(() => {});

        callback(null, {
          user: toUser({ ...user, last_login_at: new Date() }, roles),
          session_id: sessionResult.rows[0].id,
          set_cookie: loginCookies({
            sessionToken,
            rememberToken,
            csrfToken,
            remember,
          }),
          absolute_expires_at: toTimestamp(absoluteExpiresAt),
          idle_expires_at: toTimestamp(idleExpiresAt),
          remember_expires_at: remember ? toTimestamp(absoluteExpiresAt) : undefined,
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async EnsureProjectOwner(call, callback) {
      const projectId = String(call.request.project_id ?? '');
      const ownerUserId = String(call.request.owner_user_id ?? '');
      if (!projectId || !ownerUserId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'project_owner_required'));
        return;
      }

      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const user = await client.query(
          'SELECT status FROM access.users WHERE id = $1 FOR UPDATE',
          [ownerUserId],
        );
        if (user.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        if (user.rows[0].status !== 'active') {
          await client.query('ROLLBACK');
          callback(grpcError(status.PERMISSION_DENIED, 'account_blocked'));
          return;
        }

        const result = await client.query(
          `INSERT INTO access.project_memberships
             (project_id, user_id, role_code, status, joined_at)
           VALUES ($1, $2, 'project_owner', 'active', now())
           ON CONFLICT (project_id, user_id) DO UPDATE
             SET role_code = 'project_owner',
                 status = 'active',
                 joined_at = COALESCE(access.project_memberships.joined_at, now()),
                 revoked_at = NULL,
                 revoked_reason = NULL,
                 updated_at = now()
           RETURNING *`,
          [projectId, ownerUserId],
        );
        await client.query('COMMIT');
        callback(null, { membership: toMembership(result.rows[0]) });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async ListAccessibleProjectIds(call, callback) {
      const userId = String(call.request.user_id ?? '');
      if (!userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'user_id_required'));
        return;
      }

      try {
        const admin = await isAdmin(db, userId);
        const result = await db.query(
          `SELECT project_id, role_code
           FROM access.project_memberships
           WHERE user_id = $1 AND status = 'active'
           ORDER BY created_at DESC`,
          [userId],
        );
        callback(null, {
          items: result.rows.map((row) => ({
            project_id: row.project_id,
            role: toProjectRole(row.role_code),
            permissions: [],
            is_accessible: true,
          })),
          is_admin: admin,
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CheckProjectPermission(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const projectId = String(call.request.project_id ?? '');
      const permission = String(call.request.permission ?? '');
      if (!userId || !projectId || !permission) {
        callback(grpcError(status.INVALID_ARGUMENT, 'permission_request_invalid'));
        return;
      }

      try {
        const admin = await db.query(
          `SELECT 1 FROM access.user_roles WHERE user_id = $1 AND role_code = 'app_admin'`,
          [userId],
        );
        if (admin.rowCount > 0) {
          callback(null, { allowed: true, role: 'PROJECT_ROLE_UNSPECIFIED' });
          return;
        }

        const membership = await db.query(
          `SELECT role_code
           FROM access.project_memberships
           WHERE user_id = $1 AND project_id = $2 AND status = 'active'`,
          [userId, projectId],
        );
        if (membership.rowCount === 0) {
          callback(null, { allowed: false, role: 'PROJECT_ROLE_UNSPECIFIED' });
          return;
        }

        const role = membership.rows[0].role_code;
        const permissionResult = await db.query(
          `SELECT 1
           FROM access.role_permissions
           WHERE role_code = $1 AND permission_code = $2`,
          [role, permission],
        );
        callback(null, {
          allowed: permissionResult.rowCount > 0,
          role: toProjectRole(role),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ResendEmailVerification(call, callback) {
      const email = normalizeEmail(call.request.email);
      if (!isValidEmail(email)) {
        callback(null, { accepted: true });
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const user = await findUserByEmail(client, email);
        if (user && !user.email_verified_at) {
          const token = randomToken();
          await client.query(
            `UPDATE access.email_verification_tokens SET used_at = now()
             WHERE user_id = $1 AND used_at IS NULL`,
            [user.id],
          );
          await client.query(
            `INSERT INTO access.email_verification_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, now() + ($3 * interval '1 millisecond'))`,
            [user.id, hashToken(token), EMAIL_VERIFICATION_MS],
          );
          await queueAuthEmail(client, {
            userId: user.id,
            email,
            templateCode: 'email_verification',
            variables: {
              link: `${publicAppUrl.replace(/\/$/, '')}/?verify=${encodeURIComponent(token)}`,
            },
            locale: user.locale ?? 'ru-RU',
            expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_MS),
          });
        }
        await client.query('COMMIT');
        callback(null, { accepted: true });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async RequestPasswordReset(call, callback) {
      const email = normalizeEmail(call.request.email);
      if (!isValidEmail(email)) {
        callback(null, { accepted: true });
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const user = await findUserByEmail(client, email);
        if (user && user.status === 'active') {
          const token = randomToken();
          await client.query(
            `UPDATE access.password_reset_tokens SET used_at = now()
             WHERE user_id = $1 AND used_at IS NULL`,
            [user.id],
          );
          await client.query(
            `INSERT INTO access.password_reset_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, now() + ($3 * interval '1 millisecond'))`,
            [user.id, hashToken(token), PASSWORD_RESET_MS],
          );
          await queueAuthEmail(client, {
            userId: user.id,
            email,
            templateCode: 'password_reset',
            variables: { link: resetLink(publicAppUrl, token) },
            locale: user.locale ?? 'ru-RU',
            expiresAt: new Date(Date.now() + PASSWORD_RESET_MS),
          });
        }
        await client.query('COMMIT');
        callback(null, { accepted: true });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async ResetPassword(call, callback) {
      const token = String(call.request.token ?? '');
      const newPassword = String(call.request.new_password ?? '');
      if (!token || newPassword.length < 8 || newPassword.length > 128) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_password'));
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT id, user_id FROM access.password_reset_tokens
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
           FOR UPDATE`,
          [hashToken(token)],
        );
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_token'));
          return;
        }
        const row = result.rows[0];
        await client.query(
          `UPDATE access.users SET password_hash = $2, updated_at = now() WHERE id = $1`,
          [row.user_id, await hashPassword(newPassword)],
        );
        await client.query(
          `UPDATE access.password_reset_tokens SET used_at = now() WHERE id = $1`,
          [row.id],
        );
        await client.query(
          `UPDATE access.user_sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [row.user_id],
        );
        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: row.user_id,
          eventType: 'auth.password.reset',
          actorUserId: row.user_id,
          entityType: 'user',
          entityId: row.user_id,
          payload: { userId: row.user_id },
        }).catch(() => {});
        callback(null, {
          reset: true,
          set_cookie: [
            clearCookie(SESSION_COOKIE),
            clearCookie(REMEMBER_COOKIE),
            clearCookie(CSRF_COOKIE),
          ],
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async ChangePassword(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const currentPassword = String(call.request.current_password ?? '');
      const newPassword = String(call.request.new_password ?? '');
      if (!userId || !currentPassword || newPassword.length < 8 || newPassword.length > 128) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_password'));
        return;
      }
      try {
        const result = await db.query('SELECT * FROM access.users WHERE id = $1', [userId]);
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        if (!(await verifyPassword(result.rows[0].password_hash, currentPassword))) {
          callback(grpcError(status.PERMISSION_DENIED, 'invalid_current_password'));
          return;
        }
        await db.query(
          `UPDATE access.users SET password_hash = $2, updated_at = now() WHERE id = $1`,
          [userId, await hashPassword(newPassword)],
        );
        await db.query(
          `UPDATE access.user_sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'auth.password.changed',
          actorUserId: userId,
          entityType: 'user',
          entityId: userId,
          payload: { userId },
        }).catch(() => {});
        callback(null, { changed: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async SetProjectOwnerMembership(call, callback) {
      const projectId = String(call.request.project_id ?? '');
      const newOwnerUserId = String(call.request.new_owner_user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!projectId || !newOwnerUserId || !(await canManageProject(db, projectId, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'project_manage_forbidden'));
        return;
      }
      let client;
      try {
        const actorRoles = await getActorRoles(db, actorUserId, projectId);
        client = await db.connect();
        await client.query('BEGIN');
        await client.query(
          `UPDATE access.project_memberships SET role_code = 'project_manager', updated_at = now()
           WHERE project_id = $1 AND role_code = 'project_owner' AND status = 'active'`,
          [projectId],
        );
        await client.query(
          `INSERT INTO access.project_memberships
             (project_id, user_id, role_code, status, invited_by_user_id, joined_at)
           VALUES ($1, $2, 'project_owner', 'active', $3, now())
           ON CONFLICT (project_id, user_id) DO UPDATE
             SET role_code = 'project_owner', status = 'active', revoked_at = NULL,
                 revoked_reason = NULL, updated_at = now()
           RETURNING *`,
          [projectId, newOwnerUserId, actorUserId],
        );
        await client.query('COMMIT');
        const items = await db.query(
          `SELECT m.*, u.email, u.display_name, u.position, u.status, u.email_verified_at
           FROM access.project_memberships m JOIN access.users u ON u.id = m.user_id
           WHERE m.project_id = $1 AND m.status = 'active'`,
          [projectId],
        );
        await queueUserEvent(db, {
          aggregateType: 'project',
          aggregateId: projectId,
          eventType: 'project.owner.transferred',
          actorUserId,
          actorRoles,
          projectId,
          entityType: 'user',
          entityId: newOwnerUserId,
          payload: { projectId, newOwnerUserId },
        }).catch(() => {});
        callback(null, { memberships: items.rows.map(toMembership) });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async ListProjectMembers(call, callback) {
      const projectId = String(call.request.project_id ?? '');
      const limit = Math.min(Math.max(Number(call.request.page?.limit ?? 100), 1), 200);
      const offset = Math.max(Number(call.request.page?.offset ?? 0), 0);
      try {
        const result = await db.query(
          `SELECT m.*, u.email, u.display_name, u.position, u.status, u.email_verified_at
           FROM access.project_memberships m
           JOIN access.users u ON u.id = m.user_id
           WHERE m.project_id = $1 AND m.status IN ('active', 'invited')
           ORDER BY m.role_code, u.display_name
           LIMIT $2 OFFSET $3`,
          [projectId, limit, offset],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total FROM access.project_memberships
           WHERE project_id = $1 AND status IN ('active', 'invited')`,
          [projectId],
        );
        callback(null, {
          items: result.rows.map(toMembership),
          page: { total: count.rows[0].total, limit, offset },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateProjectMemberRole(call, callback) {
      const projectId = String(call.request.project_id ?? '');
      const userId = String(call.request.user_id ?? '');
      const roleCode = fromProjectRole(call.request.role);
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!projectId || !userId || !roleCode || roleCode === 'project_owner') {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_project_role'));
        return;
      }
      if (!(await canManageProject(db, projectId, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'project_manage_forbidden'));
        return;
      }
      try {
        const actorRoles = await getActorRoles(db, actorUserId, projectId);
        const current = await db.query(
          `SELECT role_code FROM access.project_memberships
           WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
          [projectId, userId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'project_member_not_found'));
          return;
        }
        if (current.rows[0].role_code === 'project_owner') {
          callback(grpcError(status.FAILED_PRECONDITION, 'project_owner_role_immutable'));
          return;
        }
        const result = await db.query(
          `UPDATE access.project_memberships
           SET role_code = $3, updated_at = now()
           WHERE project_id = $1 AND user_id = $2 AND status = 'active'
           RETURNING *`,
          [projectId, userId, roleCode],
        );
        const user = await db.query('SELECT * FROM access.users WHERE id = $1', [userId]);
        await queueUserEvent(db, {
          aggregateType: 'project',
          aggregateId: projectId,
          eventType: 'project.member.role_changed',
          actorUserId,
          actorRoles,
          projectId,
          entityType: 'user',
          entityId: userId,
          payload: { projectId, userId, role: roleCode },
        }).catch(() => {});
        callback(null, {
          membership: toMembership({
            ...result.rows[0],
            user_id: userId,
            email: user.rows[0].email,
            display_name: user.rows[0].display_name,
            position: user.rows[0].position,
            status: user.rows[0].status,
            email_verified_at: user.rows[0].email_verified_at,
          }),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async RemoveProjectMember(call, callback) {
      const projectId = String(call.request.project_id ?? '');
      const userId = String(call.request.user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await canManageProject(db, projectId, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'project_manage_forbidden'));
        return;
      }
      try {
        const actorRoles = await getActorRoles(db, actorUserId, projectId);
        const current = await db.query(
          `SELECT role_code FROM access.project_memberships
           WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
          [projectId, userId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'project_member_not_found'));
          return;
        }
        if (current.rows[0].role_code === 'project_owner') {
          callback(grpcError(status.FAILED_PRECONDITION, 'project_owner_cannot_be_removed'));
          return;
        }
        await db.query(
          `UPDATE access.project_memberships
           SET status = 'revoked', revoked_at = now(), revoked_reason = 'member_removed', updated_at = now()
           WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
          [projectId, userId],
        );
        await queueUserEvent(db, {
          aggregateType: 'project',
          aggregateId: projectId,
          eventType: 'project.member.removed',
          actorUserId,
          actorRoles,
          projectId,
          entityType: 'user',
          entityId: userId,
          payload: { projectId, userId },
        }).catch(() => {});
        callback(null, { removed: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CreateInvitation(call, callback) {
      const projectId = String(call.request.project_id ?? '');
      const email = normalizeEmail(call.request.email);
      const roleCode = fromProjectRole(call.request.role);
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!isValidEmail(email) || !roleCode || roleCode === 'project_owner') {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_invitation'));
        return;
      }
      if (!(await canManageProject(db, projectId, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'project_manage_forbidden'));
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const existing = await findUserByEmail(client, email);
        if (existing) {
          const current = await client.query(
            `SELECT role_code FROM access.project_memberships
             WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
            [projectId, existing.id],
          );
          if (current.rows[0]?.role_code === 'project_owner') {
            await client.query('ROLLBACK');
            callback(grpcError(status.ALREADY_EXISTS, 'project_owner_already_member'));
            return;
          }
          await client.query(
            `UPDATE access.invitations SET revoked_at = now()
             WHERE project_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
            [projectId, email],
          );
          const token = randomToken();
          const invitation = await client.query(
            `INSERT INTO access.invitations
               (project_id, email, role_code, invited_by_user_id, token_hash, expires_at, accepted_at)
             VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'), now())
             RETURNING *`,
            [projectId, email, roleCode, actorUserId, hashToken(token), INVITATION_MS],
          );
          await client.query(
            `INSERT INTO access.project_memberships
               (project_id, user_id, role_code, status, invited_by_user_id, invited_at, joined_at)
             VALUES ($1, $2, $3, 'active', $4, now(), now())
             ON CONFLICT (project_id, user_id) DO UPDATE
               SET role_code = $3, status = 'active', invited_by_user_id = $4,
                   joined_at = COALESCE(access.project_memberships.joined_at, now()),
                   revoked_at = NULL, revoked_reason = NULL, updated_at = now()`,
            [projectId, existing.id, roleCode, actorUserId],
          );
          await queueAuthEmail(client, {
            userId: existing.id,
            invitationId: invitation.rows[0].id,
            email,
            templateCode: 'project_invitation',
            variables: { link: `${publicAppUrl.replace(/\/$/, '')}/projects/${projectId}` },
            locale: existing.locale ?? 'ru-RU',
            expiresAt: new Date(invitation.rows[0].expires_at),
          });
          await client.query('COMMIT');
          await queueUserEvent(db, {
            aggregateType: 'project',
            aggregateId: projectId,
            eventType: 'project.member.added',
            actorUserId,
            entityType: 'user',
            entityId: existing.id,
            payload: { projectId, userId: existing.id, role: roleCode },
          }).catch(() => {});
          callback(null, { invitation: toInvitation(invitation.rows[0]) });
          return;
        }

        const token = randomToken();
        const current = await client.query(
          `SELECT * FROM access.invitations
           WHERE project_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
          [projectId, email],
        );
        const invitation =
          current.rowCount > 0
            ? await client.query(
                `UPDATE access.invitations
                 SET role_code = $2, invited_by_user_id = $3, token_hash = $4,
                     expires_at = now() + ($5 * interval '1 millisecond')
                 WHERE id = $1 RETURNING *`,
                [current.rows[0].id, roleCode, actorUserId, hashToken(token), INVITATION_MS],
              )
            : await client.query(
                `INSERT INTO access.invitations
                   (project_id, email, role_code, invited_by_user_id, token_hash, expires_at)
                 VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'))
                 RETURNING *`,
                [projectId, email, roleCode, actorUserId, hashToken(token), INVITATION_MS],
              );
        await queueAuthEmail(client, {
          invitationId: invitation.rows[0].id,
          email,
          templateCode: 'project_invitation',
          variables: { link: invitationLink(publicAppUrl, token) },
          expiresAt: new Date(invitation.rows[0].expires_at),
        });
        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'project',
          aggregateId: projectId,
          eventType: 'invitation.created',
          actorUserId,
          entityType: 'invitation',
          entityId: invitation.rows[0].id,
          payload: { projectId, email, role: roleCode },
        }).catch(() => {});
        callback(null, { invitation: toInvitation(invitation.rows[0]) });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async ListProjectInvitations(call, callback) {
      const projectId = String(call.request.project_id ?? '');
      const limit = Math.min(Math.max(Number(call.request.page?.limit ?? 100), 1), 200);
      const offset = Math.max(Number(call.request.page?.offset ?? 0), 0);
      try {
        const result = await db.query(
          `SELECT * FROM access.invitations WHERE project_id = $1
           ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [projectId, limit, offset],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total FROM access.invitations WHERE project_id = $1`,
          [projectId],
        );
        callback(null, {
          items: result.rows.map(toInvitation),
          page: { total: count.rows[0].total, limit, offset },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ResendInvitation(call, callback) {
      const invitationId = String(call.request.invitation_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      let client;
      try {
        const current = await db.query('SELECT * FROM access.invitations WHERE id = $1', [
          invitationId,
        ]);
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'invitation_not_found'));
          return;
        }
        if (!(await canManageProject(db, current.rows[0].project_id, actorUserId))) {
          callback(grpcError(status.PERMISSION_DENIED, 'project_manage_forbidden'));
          return;
        }
        if (current.rows[0].accepted_at || current.rows[0].revoked_at) {
          callback(grpcError(status.FAILED_PRECONDITION, 'invitation_not_pending'));
          return;
        }
        const token = randomToken();
        client = await db.connect();
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE access.invitations
           SET token_hash = $2, expires_at = now() + ($3 * interval '1 millisecond'),
               invited_by_user_id = $4
           WHERE id = $1 RETURNING *`,
          [invitationId, hashToken(token), INVITATION_MS, actorUserId],
        );
        await queueAuthEmail(client, {
          invitationId: result.rows[0].id,
          email: result.rows[0].email,
          templateCode: 'project_invitation',
          variables: { link: invitationLink(publicAppUrl, token) },
          expiresAt: new Date(result.rows[0].expires_at),
        });
        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'project',
          aggregateId: result.rows[0].project_id,
          eventType: 'invitation.resent',
          actorUserId,
          entityType: 'invitation',
          entityId: result.rows[0].id,
          payload: { projectId: result.rows[0].project_id, email: result.rows[0].email },
        }).catch(() => {});
        callback(null, { invitation: toInvitation(result.rows[0]) });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async RevokeInvitation(call, callback) {
      const invitationId = String(call.request.invitation_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      try {
        const current = await db.query('SELECT * FROM access.invitations WHERE id = $1', [
          invitationId,
        ]);
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'invitation_not_found'));
          return;
        }
        if (!(await canManageProject(db, current.rows[0].project_id, actorUserId))) {
          callback(grpcError(status.PERMISSION_DENIED, 'project_manage_forbidden'));
          return;
        }
        await db.query(
          `UPDATE access.invitations SET revoked_at = now()
           WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
          [invitationId],
        );
        await queueUserEvent(db, {
          aggregateType: 'project',
          aggregateId: current.rows[0].project_id,
          eventType: 'invitation.revoked',
          actorUserId,
          entityType: 'invitation',
          entityId: invitationId,
          payload: { projectId: current.rows[0].project_id, email: current.rows[0].email },
        }).catch(() => {});
        callback(null, { revoked: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async AcceptInvitation(call, callback) {
      const token = String(call.request.token ?? '');
      const userId = String(call.request.user_id ?? '');
      if (!token || !userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invitation_token_required'));
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const invitation = await client.query(
          `SELECT * FROM access.invitations
           WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
           FOR UPDATE`,
          [hashToken(token)],
        );
        if (invitation.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.INVALID_ARGUMENT, 'invalid_invitation_token'));
          return;
        }
        const user = await client.query('SELECT * FROM access.users WHERE id = $1', [userId]);
        if (user.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        if (normalizeEmail(user.rows[0].email) !== normalizeEmail(invitation.rows[0].email)) {
          await client.query('ROLLBACK');
          callback(grpcError(status.PERMISSION_DENIED, 'invitation_email_mismatch'));
          return;
        }
        const membership = await client.query(
          `INSERT INTO access.project_memberships
             (project_id, user_id, role_code, status, invited_by_user_id, invited_at, joined_at)
           VALUES ($1, $2, $3, 'active', $4, now(), now())
           ON CONFLICT (project_id, user_id) DO UPDATE
             SET role_code = $3, status = 'active', invited_by_user_id = $4,
                 joined_at = COALESCE(access.project_memberships.joined_at, now()),
                 revoked_at = NULL, revoked_reason = NULL, updated_at = now()
           RETURNING *`,
          [
            invitation.rows[0].project_id,
            userId,
            invitation.rows[0].role_code,
            invitation.rows[0].invited_by_user_id,
          ],
        );
        await client.query(`UPDATE access.invitations SET accepted_at = now() WHERE id = $1`, [
          invitation.rows[0].id,
        ]);
        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'project',
          aggregateId: invitation.rows[0].project_id,
          eventType: 'invitation.accepted',
          actorUserId: userId,
          entityType: 'user',
          entityId: userId,
          payload: {
            projectId: invitation.rows[0].project_id,
            userId,
            role: invitation.rows[0].role_code,
          },
        }).catch(() => {});
        callback(null, {
          membership: toMembership({
            ...membership.rows[0],
            user_id: userId,
            email: user.rows[0].email,
            display_name: user.rows[0].display_name,
            position: user.rows[0].position,
            status: user.rows[0].status,
            email_verified_at: user.rows[0].email_verified_at,
          }),
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async GetUserRoles(call, callback) {
      const userId = String(call.request.user_id ?? '');
      try {
        const roles = await getRoles(db, userId);
        callback(null, {
          global_roles: roles
            .filter((role) => role === 'app_admin')
            .map(() => 'GLOBAL_ROLE_APP_ADMIN'),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async SetUserGlobalRoles(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await isAdmin(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'admin_forbidden'));
        return;
      }
      if (!userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'user_id_required'));
        return;
      }
      try {
        const user = await db.query('SELECT * FROM access.users WHERE id = $1', [userId]);
        if (user.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        const actorRoles = await getActorRoles(db, actorUserId);
        const roles = (call.request.roles ?? []).includes('GLOBAL_ROLE_APP_ADMIN');
        await db.query(
          `DELETE FROM access.user_roles WHERE user_id = $1 AND role_code = 'app_admin'`,
          [userId],
        );
        if (roles) {
          await db.query(
            `INSERT INTO access.user_roles (user_id, role_code) VALUES ($1, 'app_admin')
             ON CONFLICT DO NOTHING`,
            [userId],
          );
        }
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.roles.updated',
          actorUserId,
          actorRoles,
          entityType: 'user',
          entityId: userId,
          payload: { userId, appAdmin: roles },
        }).catch(() => {});
        callback(null, {
          user: toUser(user.rows[0], roles ? ['app_admin'] : []),
          roles: roles ? ['GLOBAL_ROLE_APP_ADMIN'] : [],
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateUserProfile(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'user_id_required'));
        return;
      }
      if (actorUserId && actorUserId !== userId && !(await isAdmin(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'admin_forbidden'));
        return;
      }
      try {
        const result = await db.query(
          `UPDATE access.users SET
             display_name = COALESCE($2, display_name),
             last_name = COALESCE($3, last_name),
             first_name = COALESCE($4, first_name),
             middle_name = COALESCE($5, middle_name),
             position = COALESCE($6, position),
             timezone = COALESCE($7, timezone),
             locale = COALESCE($8, locale),
             updated_at = now()
           WHERE id = $1 RETURNING *`,
          [
            userId,
            call.request.display_name ?? null,
            call.request.last_name ?? null,
            call.request.first_name ?? null,
            call.request.middle_name ?? null,
            call.request.position ?? null,
            call.request.timezone ?? null,
            call.request.locale ?? null,
          ],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.updated',
          actorUserId: actorUserId || userId,
          entityType: 'user',
          entityId: userId,
          payload: { userId },
        }).catch(() => {});
        callback(null, { user: toUser(result.rows[0], await getRoles(db, userId)) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async BlockUser(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await isAdmin(db, actorUserId)) || userId === actorUserId) {
        callback(grpcError(status.PERMISSION_DENIED, 'admin_forbidden'));
        return;
      }
      try {
        const result = await db.query(
          `UPDATE access.users SET status = 'blocked', updated_at = now()
           WHERE id = $1 RETURNING id`,
          [userId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        await db.query(
          `UPDATE access.user_sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.blocked',
          actorUserId,
          entityType: 'user',
          entityId: userId,
          payload: { userId, reason: String(call.request.reason ?? '') },
        }).catch(() => {});
        callback(null, { blocked: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UnblockUser(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await isAdmin(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'admin_forbidden'));
        return;
      }
      try {
        const result = await db.query(
          `UPDATE access.users SET status = 'active', failed_login_attempts = 0,
             lockout_level = 0, locked_until = NULL, updated_at = now()
           WHERE id = $1 RETURNING id`,
          [userId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.unblocked',
          actorUserId,
          entityType: 'user',
          entityId: userId,
          payload: { userId },
        }).catch(() => {});
        callback(null, { unblocked: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async RestoreSession(call, callback) {
      const rememberToken = String(call.request.remember_token ?? '');
      if (!rememberToken) {
        callback(grpcError(status.UNAUTHENTICATED, 'remember_token_required'));
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT s.*, u.status AS user_status
           FROM access.user_sessions s
           JOIN access.users u ON u.id = s.user_id
           WHERE s.remember_token_hash = $1 AND s.revoked_at IS NULL
             AND s.remember_absolute_expires_at > now()
             AND s.remember_idle_expires_at > now()
           FOR UPDATE`,
          [hashToken(rememberToken)],
        );
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.UNAUTHENTICATED, 'remember_token_invalid'));
          return;
        }
        const session = result.rows[0];
        if (session.user_status !== 'active') {
          await client.query('ROLLBACK');
          callback(grpcError(status.PERMISSION_DENIED, 'account_blocked'));
          return;
        }
        const user = await client.query('SELECT * FROM access.users WHERE id = $1', [
          session.user_id,
        ]);
        const sessionToken = randomToken();
        const csrfToken = randomToken();
        const now = Date.now();
        const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_MS);
        const idleExpiresAt = new Date(now + SESSION_IDLE_MS);
        const rememberIdleExpiresAt = new Date(
          Math.min(
            now + REMEMBER_IDLE_MS,
            new Date(session.remember_absolute_expires_at).getTime(),
          ),
        );
        await client.query(
          `UPDATE access.user_sessions
           SET revoked_at = now(), remember_token_hash = NULL
           WHERE id = $1`,
          [session.id],
        );
        const created = await client.query(
          `INSERT INTO access.user_sessions
             (user_id, session_token_hash, absolute_expires_at, idle_expires_at,
              remember_token_hash, remember_absolute_expires_at, remember_idle_expires_at,
              user_agent, ip, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           RETURNING id`,
          [
            session.user_id,
            hashToken(sessionToken),
            absoluteExpiresAt,
            idleExpiresAt,
            hashToken(rememberToken),
            session.remember_absolute_expires_at,
            rememberIdleExpiresAt,
            String(call.request.user_agent ?? '') || null,
            String(call.request.client_ip ?? '') || null,
          ],
        );
        const roles = await getRoles(client, session.user_id);
        await client.query('COMMIT');
        callback(null, {
          user: toUser(user.rows[0], roles),
          session_id: created.rows[0].id,
          set_cookie: loginCookies({
            sessionToken,
            rememberToken,
            csrfToken,
            remember: true,
          }),
          absolute_expires_at: toTimestamp(absoluteExpiresAt),
          idle_expires_at: toTimestamp(idleExpiresAt),
          remember_expires_at: toTimestamp(session.remember_absolute_expires_at),
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async GetUser(call, callback) {
      const userId = String(call.request.user_id ?? '');
      try {
        const result = await db.query('SELECT * FROM access.users WHERE id = $1', [userId]);
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        callback(null, { user: toUser(result.rows[0], await getRoles(db, userId)) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async AdminCreateUser(call, callback) {
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await isAdmin(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'admin_forbidden'));
        return;
      }
      const email = normalizeEmail(call.request.email);
      const lastName = String(call.request.last_name ?? '').trim();
      const firstName = String(call.request.first_name ?? '').trim();
      const displayName =
        String(call.request.display_name ?? '').trim() || `${lastName} ${firstName}`.trim();
      if (!isValidEmail(email) || !lastName || !firstName || !displayName) {
        callback(grpcError(status.INVALID_ARGUMENT, 'invalid_user'));
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const temporaryPassword = randomToken();
        const result = await client.query(
          `INSERT INTO access.users
             (email, password_hash, display_name, last_name, first_name, middle_name,
              position, timezone, locale, email_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           RETURNING *`,
          [
            email,
            await hashPassword(temporaryPassword),
            displayName,
            lastName,
            firstName,
            String(call.request.middle_name ?? '').trim() || null,
            String(call.request.position ?? '').trim() || null,
            String(call.request.timezone ?? 'Europe/Moscow'),
            String(call.request.locale ?? 'ru-RU'),
          ],
        );
        const userId = result.rows[0].id;
        for (const role of call.request.global_roles ?? []) {
          if (role === 'GLOBAL_ROLE_APP_ADMIN') {
            await client.query(
              `INSERT INTO access.user_roles (user_id, role_code) VALUES ($1, 'app_admin')
               ON CONFLICT DO NOTHING`,
              [userId],
            );
          }
        }
        const token = randomToken();
        await client.query(
          `INSERT INTO access.password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + interval '1 hour')`,
          [userId, hashToken(token)],
        );
        await queueAuthEmail(client, {
          userId,
          email,
          templateCode: 'account_activation',
          variables: { link: resetLink(publicAppUrl, token) },
          locale: String(call.request.locale ?? 'ru-RU'),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_MS),
        });
        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.created',
          actorUserId,
          entityType: 'user',
          entityId: userId,
          payload: { userId, adminCreated: true },
        }).catch(() => {});
        callback(null, {
          user: toUser(result.rows[0], rolesFromRequest(call.request.global_roles)),
        });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async DeleteUser(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await isAdmin(db, actorUserId)) || userId === actorUserId) {
        callback(grpcError(status.PERMISSION_DENIED, 'admin_forbidden'));
        return;
      }
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE access.users SET status = 'blocked', updated_at = now()
           WHERE id = $1 RETURNING id`,
          [userId],
        );
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        await client.query(
          `UPDATE access.user_sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        await client.query(`DELETE FROM access.user_roles WHERE user_id = $1`, [userId]);
        await client.query(
          `UPDATE access.project_memberships SET status = 'revoked', revoked_at = now(),
             revoked_reason = 'member_removed' WHERE user_id = $1 AND status = 'active'`,
          [userId],
        );
        await client.query('COMMIT');
        await queueUserEvent(db, {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.deleted',
          actorUserId,
          entityType: 'user',
          entityId: userId,
          payload: { userId, reason: String(call.request.reason ?? '') },
        }).catch(() => {});
        callback(null, { deleted: true });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        callback(mapDbError(error));
      } finally {
        client?.release();
      }
    },

    async GetRoles(call, callback) {
      try {
        const result = await db.query(
          'SELECT code, scope, name, description FROM access.roles ORDER BY code',
        );
        callback(null, {
          items: result.rows.map((row) => ({
            code: row.code,
            scope: row.scope,
            name: row.name,
            description: row.description ?? '',
          })),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetPermissions(call, callback) {
      try {
        const result = await db.query(
          'SELECT code, scope, description FROM access.permissions ORDER BY code',
        );
        callback(null, {
          items: result.rows.map((row) => ({
            code: row.code,
            scope: row.scope,
            description: row.description ?? '',
          })),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetProjectAccess(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const projectId = String(call.request.project_id ?? '');
      try {
        const membership = await db.query(
          `SELECT role_code FROM access.project_memberships
           WHERE user_id = $1 AND project_id = $2 AND status = 'active'`,
          [userId, projectId],
        );
        if (membership.rowCount === 0) {
          callback(null, {
            access: {
              project_id: projectId,
              role: 'PROJECT_ROLE_UNSPECIFIED',
              permissions: [],
              is_accessible: false,
            },
          });
          return;
        }
        const role = membership.rows[0].role_code;
        const permissions = await db.query(
          'SELECT permission_code FROM access.role_permissions WHERE role_code = $1',
          [role],
        );
        callback(null, {
          access: {
            project_id: projectId,
            role: toProjectRole(role),
            permissions: permissions.rows.map((row) => row.permission_code),
            is_accessible: true,
          },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetNotificationContacts(call, callback) {
      const ids = call.request.user_ids ?? [];
      try {
        const result = await db.query(
          `SELECT u.id, u.email, u.email_verified_at, t.telegram_user_id, t.telegram_username
           FROM access.users u
           LEFT JOIN access.telegram_links t ON t.user_id = u.id AND t.revoked_at IS NULL
           WHERE u.id = ANY($1::uuid[])`,
          [ids],
        );
        callback(null, {
          items: result.rows.map((row) => ({
            user_id: row.id,
            email: row.email,
            email_verified: Boolean(row.email_verified_at),
            telegram_user_id: Number(row.telegram_user_id ?? 0),
            telegram_username: row.telegram_username ?? '',
            telegram_linked: row.telegram_user_id != null,
          })),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CreateTelegramLinkCode(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const code = randomToken().slice(0, 16);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      telegramCodes.set(code, { userId, expiresAt });
      callback(null, {
        code,
        deep_link: `https://t.me/rp_gant_local_bot?start=${code}`,
        expires_at: toTimestamp(expiresAt),
      });
    },

    async LinkTelegram(call, callback) {
      const code = String(call.request.code ?? '');
      const entry = telegramCodes.get(code);
      if (!entry || entry.expiresAt <= new Date()) {
        callback(grpcError(status.INVALID_ARGUMENT, 'telegram_code_invalid'));
        return;
      }
      try {
        await db.query(
          `INSERT INTO access.telegram_links (user_id, telegram_user_id, telegram_username)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE
             SET telegram_user_id = $2, telegram_username = $3,
                 linked_at = now(), revoked_at = NULL`,
          [entry.userId, call.request.telegram_user_id, call.request.telegram_username || null],
        );
        telegramCodes.delete(code);
        callback(null, { linked: true, user_id: entry.userId });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UnlinkTelegram(call, callback) {
      const userId = String(call.request.user_id ?? '');
      try {
        await db.query(
          `UPDATE access.telegram_links SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        callback(null, { unlinked: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetSystemSettings(call, callback) {
      try {
        const result = await db.query('SELECT * FROM settings.system_settings ORDER BY key');
        callback(null, { items: result.rows.map(toSettings) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateSystemSettings(call, callback) {
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await isAdmin(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'admin_forbidden'));
        return;
      }
      try {
        for (const item of call.request.items ?? []) {
          await db.query(
            `INSERT INTO settings.system_settings (key, value, description, updated_by_user_id)
             VALUES ($1, $2::jsonb, $3, $4)
             ON CONFLICT (key) DO UPDATE
               SET value = $2::jsonb, description = $3, updated_by_user_id = $4,
                   updated_at = now()`,
            [
              item.key,
              JSON.stringify(storedSettingsValue(item.value)),
              item.description ?? '',
              actorUserId,
            ],
          );
        }
        const result = await db.query('SELECT * FROM settings.system_settings ORDER BY key');
        callback(null, { items: result.rows.map(toSettings) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetCurrentUser(call, callback) {
      const userId = String(call.request.user_id ?? '');
      if (!userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'user_id_required'));
        return;
      }

      try {
        const result = await db.query('SELECT * FROM access.users WHERE id = $1', [userId]);
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        const roles = await getRoles(db, userId);
        callback(null, { user: toUser(result.rows[0], roles) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async CreateExecutor(call, callback) {
      const actorUserId = String(call.request.actor_user_id ?? '');
      const lastName = String(call.request.last_name ?? '').trim();
      const firstName = String(call.request.first_name ?? '').trim();
      const middleName = String(call.request.middle_name ?? '').trim();
      const position = String(call.request.position ?? '').trim();
      if (!lastName || !firstName) {
        callback(grpcError(status.INVALID_ARGUMENT, 'executor_name_required'));
        return;
      }
      if (!(await canManageExecutors(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'executor_manage_forbidden'));
        return;
      }
      try {
        const fullName = [lastName, firstName, middleName].filter(Boolean).join(' ');
        const result = await db.query(
          `INSERT INTO access.executors (last_name, first_name, middle_name, full_name, position)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [lastName, firstName, middleName || null, fullName, position || null],
        );
        await queueUserEvent(db, {
          aggregateType: 'executor',
          aggregateId: result.rows[0].id,
          eventType: 'executor.created',
          actorUserId,
          entityType: 'executor',
          entityId: result.rows[0].id,
          payload: { executorId: result.rows[0].id },
        }).catch(() => {});
        callback(null, { executor: toExecutor(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UpdateExecutor(call, callback) {
      const executorId = String(call.request.executor_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await canManageExecutors(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'executor_manage_forbidden'));
        return;
      }
      try {
        const current = await db.query(
          'SELECT * FROM access.executors WHERE id = $1 AND deleted_at IS NULL',
          [executorId],
        );
        if (current.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'executor_not_found'));
          return;
        }
        const row = current.rows[0];
        const lastName = String(call.request.last_name ?? row.last_name).trim();
        const firstName = String(call.request.first_name ?? row.first_name).trim();
        const middleName = String(call.request.middle_name ?? row.middle_name ?? '').trim();
        const position = String(call.request.position ?? row.position ?? '').trim();
        if (!lastName || !firstName) {
          callback(grpcError(status.INVALID_ARGUMENT, 'executor_name_required'));
          return;
        }
        const fullName = [lastName, firstName, middleName].filter(Boolean).join(' ');
        const result = await db.query(
          `UPDATE access.executors
           SET last_name = $2, first_name = $3, middle_name = $4, full_name = $5,
               position = $6, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [executorId, lastName, firstName, middleName || null, fullName, position || null],
        );
        await queueUserEvent(db, {
          aggregateType: 'executor',
          aggregateId: executorId,
          eventType: 'executor.updated',
          actorUserId,
          entityType: 'executor',
          entityId: executorId,
          payload: { executorId },
        }).catch(() => {});
        callback(null, { executor: toExecutor(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async DeleteExecutor(call, callback) {
      const executorId = String(call.request.executor_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await canManageExecutors(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'executor_manage_forbidden'));
        return;
      }
      try {
        const result = await db.query(
          `UPDATE access.executors
           SET deleted_at = now(), is_active = false, linked_user_id = NULL, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
          [executorId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'executor_not_found'));
          return;
        }
        await queueUserEvent(db, {
          aggregateType: 'executor',
          aggregateId: executorId,
          eventType: 'executor.deleted',
          actorUserId,
          entityType: 'executor',
          entityId: executorId,
          payload: { executorId },
        }).catch(() => {});
        callback(null, { deleted: true });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async LinkExecutorUser(call, callback) {
      const executorId = String(call.request.executor_id ?? '');
      const userId = String(call.request.user_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await canManageExecutors(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'executor_manage_forbidden'));
        return;
      }
      try {
        const user = await db.query('SELECT id FROM access.users WHERE id = $1', [userId]);
        if (user.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'user_not_found'));
          return;
        }
        const result = await db.query(
          `UPDATE access.executors SET linked_user_id = $2, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
          [executorId, userId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'executor_not_found'));
          return;
        }
        await queueUserEvent(db, {
          aggregateType: 'executor',
          aggregateId: executorId,
          eventType: 'executor.linked',
          actorUserId,
          entityType: 'executor',
          entityId: executorId,
          payload: { executorId, userId },
        }).catch(() => {});
        callback(null, { executor: toExecutor(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async UnlinkExecutorUser(call, callback) {
      const executorId = String(call.request.executor_id ?? '');
      const actorUserId = String(call.request.actor_user_id ?? '');
      if (!(await canManageExecutors(db, actorUserId))) {
        callback(grpcError(status.PERMISSION_DENIED, 'executor_manage_forbidden'));
        return;
      }
      try {
        const result = await db.query(
          `UPDATE access.executors SET linked_user_id = NULL, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
          [executorId],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.NOT_FOUND, 'executor_not_found'));
          return;
        }
        await queueUserEvent(db, {
          aggregateType: 'executor',
          aggregateId: executorId,
          eventType: 'executor.unlinked',
          actorUserId,
          entityType: 'executor',
          entityId: executorId,
          payload: { executorId },
        }).catch(() => {});
        callback(null, { executor: toExecutor(result.rows[0]) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ListUsers(call, callback) {
      const query = String(call.request.query ?? '').trim();
      const limit = Math.min(Math.max(Number(call.request.page?.limit ?? 50), 1), 200);
      const offset = Math.max(Number(call.request.page?.offset ?? 0), 0);
      try {
        const result = await db.query(
          `SELECT u.*,
                  COALESCE(array_agg(r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS role_codes
           FROM access.users u
           LEFT JOIN access.user_roles r ON r.user_id = u.id
           WHERE ($1 = '' OR u.display_name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%')
           GROUP BY u.id
           ORDER BY u.display_name ASC
           LIMIT $2 OFFSET $3`,
          [query, limit, offset],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total FROM access.users
           WHERE ($1 = '' OR display_name ILIKE '%' || $1 || '%' OR email::text ILIKE '%' || $1 || '%')`,
          [query],
        );
        callback(null, {
          items: result.rows.map((row) => ({
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            position: row.position ?? '',
            status: row.status === 'blocked' ? 'USER_STATUS_BLOCKED' : 'USER_STATUS_ACTIVE',
            email_verified: Boolean(row.email_verified_at),
            global_roles: (row.role_codes ?? [])
              .filter((role) => role === 'app_admin')
              .map(() => 'GLOBAL_ROLE_APP_ADMIN'),
          })),
          page: { total: count.rows[0].total, limit, offset },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ListExecutors(call, callback) {
      const query = String(call.request.query ?? '').trim();
      const includeInactive = Boolean(call.request.include_inactive);
      const limit = Math.min(Math.max(Number(call.request.page?.limit ?? 50), 1), 200);
      const offset = Math.max(Number(call.request.page?.offset ?? 0), 0);
      try {
        const result = await db.query(
          `SELECT * FROM access.executors
           WHERE deleted_at IS NULL
             AND ($1 = '' OR full_name ILIKE '%' || $1 || '%')
             AND ($2 OR is_active)
           ORDER BY full_name ASC
           LIMIT $3 OFFSET $4`,
          [query, includeInactive, limit, offset],
        );
        const count = await db.query(
          `SELECT count(*)::int AS total FROM access.executors
           WHERE deleted_at IS NULL
             AND ($1 = '' OR full_name ILIKE '%' || $1 || '%')
             AND ($2 OR is_active)`,
          [query, includeInactive],
        );
        callback(null, {
          items: result.rows.map(toExecutor),
          page: { total: count.rows[0].total, limit, offset },
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetUsersByIds(call, callback) {
      const ids = call.request.user_ids ?? [];
      if (ids.length === 0) {
        callback(null, { items: [] });
        return;
      }
      try {
        const result = await db.query(
          `SELECT * FROM access.users
           WHERE id = ANY($1::uuid[])
           ORDER BY display_name ASC`,
          [ids],
        );
        callback(null, {
          items: result.rows.map((row) => ({
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            position: row.position ?? '',
            status: row.status === 'blocked' ? 'USER_STATUS_BLOCKED' : 'USER_STATUS_ACTIVE',
            email_verified: Boolean(row.email_verified_at),
            global_roles: [],
          })),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async GetExecutorsByIds(call, callback) {
      const ids = call.request.executor_ids ?? [];
      if (ids.length === 0) {
        callback(null, { items: [] });
        return;
      }
      try {
        const result = await db.query(
          `SELECT * FROM access.executors
           WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
           ORDER BY full_name ASC`,
          [ids],
        );
        callback(null, { items: result.rows.map(toExecutor) });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ValidateSession(call, callback) {
      const sessionToken = String(call.request.session_token ?? '');
      if (!sessionToken) {
        callback(grpcError(status.UNAUTHENTICATED, 'session_required'));
        return;
      }

      try {
        const result = await db.query(
          `SELECT s.*, u.status AS user_status
           FROM access.user_sessions s
           JOIN access.users u ON u.id = s.user_id
           WHERE s.session_token_hash = $1
             AND s.revoked_at IS NULL`,
          [hashToken(sessionToken)],
        );
        if (result.rowCount === 0) {
          callback(grpcError(status.UNAUTHENTICATED, 'session_invalid'));
          return;
        }

        const session = result.rows[0];
        const now = new Date();
        if (
          new Date(session.absolute_expires_at) <= now ||
          new Date(session.idle_expires_at) <= now
        ) {
          const hasActiveRememberToken =
            Boolean(session.remember_token_hash) &&
            new Date(session.remember_absolute_expires_at ?? 0) > now &&
            new Date(session.remember_idle_expires_at ?? 0) > now;
          if (!hasActiveRememberToken) {
            await db
              .query(
                `UPDATE access.user_sessions
                 SET revoked_at = now()
                 WHERE id = $1 AND revoked_at IS NULL`,
                [session.id],
              )
              .catch(() => {});
          }
          callback(grpcError(status.UNAUTHENTICATED, 'session_expired'));
          return;
        }
        if (session.user_status !== 'active') {
          callback(grpcError(status.PERMISSION_DENIED, 'account_blocked'));
          return;
        }

        let idleExpiresAt = new Date(session.idle_expires_at);
        if (call.request.extend_idle !== false) {
          const idleMs = session.remember_token_hash ? REMEMBER_IDLE_MS : SESSION_IDLE_MS;
          idleExpiresAt = new Date(
            Math.min(now.getTime() + idleMs, new Date(session.absolute_expires_at).getTime()),
          );
          const rememberAbsoluteExpiresAt = new Date(
            session.remember_absolute_expires_at ?? Number.NaN,
          ).getTime();
          const rememberIdleExpiresAt =
            session.remember_token_hash && Number.isFinite(rememberAbsoluteExpiresAt)
              ? new Date(Math.min(now.getTime() + REMEMBER_IDLE_MS, rememberAbsoluteExpiresAt))
              : null;
          await db.query(
            `UPDATE access.user_sessions
             SET idle_expires_at = $1,
                 remember_idle_expires_at = $2::timestamptz,
                 last_seen_at = now()
             WHERE id = $3`,
            [idleExpiresAt, rememberIdleExpiresAt, session.id],
          );
        }

        const roles = await getRoles(db, session.user_id);
        callback(null, {
          user_id: session.user_id,
          session_id: session.id,
          global_roles: roles
            .filter((role) => role === 'app_admin')
            .map(() => 'GLOBAL_ROLE_APP_ADMIN'),
          absolute_expires_at: toTimestamp(session.absolute_expires_at),
          idle_expires_at: toTimestamp(idleExpiresAt),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async ListMySessions(call, callback) {
      const userId = String(call.request.user_id ?? '');
      if (!userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'user_id_required'));
        return;
      }
      try {
        const result = await db.query(
          `SELECT * FROM access.user_sessions
           WHERE user_id = $1
             AND revoked_at IS NULL
             AND ${ACTIVE_SESSION_PREDICATE}
           ORDER BY last_seen_at DESC`,
          [userId],
        );
        callback(null, {
          items: result.rows.map((session) => ({
            id: session.id,
            absolute_expires_at: toTimestamp(session.absolute_expires_at),
            idle_expires_at: toTimestamp(session.idle_expires_at),
            remember_expires_at: toTimestamp(session.remember_absolute_expires_at),
            last_seen_at: toTimestamp(session.last_seen_at),
            user_agent: session.user_agent ?? '',
            ip: session.ip ?? '',
            remember: Boolean(session.remember_token_hash),
            created_at: toTimestamp(session.created_at),
          })),
        });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async RevokeMySession(call, callback) {
      const userId = String(call.request.user_id ?? '');
      const sessionId = String(call.request.session_id ?? '');
      if (!userId || !sessionId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'session_id_required'));
        return;
      }
      try {
        const result = await db.query(
          `UPDATE access.user_sessions
           SET revoked_at = now()
           WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [sessionId, userId],
        );
        callback(null, { revoked: result.rowCount > 0 });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async LogoutAll(call, callback) {
      const userId = String(call.request.user_id ?? '');
      if (!userId) {
        callback(grpcError(status.INVALID_ARGUMENT, 'user_id_required'));
        return;
      }
      try {
        await db.query(
          `UPDATE access.user_sessions
           SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        callback(null, { set_cookie: logoutCookies() });
      } catch (error) {
        callback(mapDbError(error));
      }
    },

    async Logout(call, callback) {
      const sessionToken = String(call.request.session_token ?? '');
      if (sessionToken) {
        await db
          .query(
            `UPDATE access.user_sessions
             SET revoked_at = now()
             WHERE session_token_hash = $1 AND revoked_at IS NULL`,
            [hashToken(sessionToken)],
          )
          .catch(() => {});
      }
      callback(null, { set_cookie: logoutCookies() });
    },
  };
}
