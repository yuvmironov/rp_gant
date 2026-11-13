import { call } from './user-client.js';

const TITLES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

const GRPC_STATUS = {
  3: 400,
  5: 404,
  6: 409,
  7: 403,
  8: 429,
  9: 423,
  10: 409,
  13: 500,
  14: 503,
  16: 401,
};

function fromTimestamp(value) {
  if (!value) return undefined;
  const milliseconds =
    Number(value.seconds ?? 0) * 1000 + Math.floor(Number(value.nanos ?? 0) / 1_000_000);
  return new Date(milliseconds).toISOString();
}

export function mapUser(user) {
  if (!user) return undefined;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    lastName: user.last_name,
    firstName: user.first_name,
    middleName: user.middle_name,
    position: user.position,
    status: user.status === 'USER_STATUS_BLOCKED' ? 'blocked' : 'active',
    emailVerified: user.email_verified,
    emailVerifiedAt: fromTimestamp(user.email_verified_at),
    timezone: user.timezone,
    locale: user.locale,
    globalRoles: (user.global_roles ?? [])
      .filter((role) => role === 'GLOBAL_ROLE_APP_ADMIN')
      .map(() => 'app_admin'),
    lastLoginAt: fromTimestamp(user.last_login_at),
    createdAt: fromTimestamp(user.created_at),
    updatedAt: fromTimestamp(user.updated_at),
  };
}

export function mapSession(session) {
  return {
    id: session.id,
    absoluteExpiresAt: fromTimestamp(session.absolute_expires_at),
    idleExpiresAt: fromTimestamp(session.idle_expires_at),
    rememberExpiresAt: fromTimestamp(session.remember_expires_at),
    lastSeenAt: fromTimestamp(session.last_seen_at),
    userAgent: session.user_agent,
    ip: session.ip,
    remember: session.remember,
    createdAt: fromTimestamp(session.created_at),
  };
}

export function mapUserSummary(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    position: user.position,
    status: user.status === 'USER_STATUS_BLOCKED' ? 'blocked' : 'active',
    emailVerified: user.email_verified,
    globalRoles: (user.global_roles ?? [])
      .filter((role) => role === 'GLOBAL_ROLE_APP_ADMIN')
      .map(() => 'app_admin'),
  };
}

export function mapExecutor(executor) {
  return {
    id: executor.id,
    lastName: executor.last_name,
    firstName: executor.first_name,
    middleName: executor.middle_name,
    fullName: executor.full_name,
    position: executor.position,
    projectIds: executor.project_ids ?? [],
    isActive: executor.is_active,
  };
}

export function sendProblem(reply, request, error) {
  const grpcCode = error.code ?? 13;
  const status = GRPC_STATUS[grpcCode] ?? 500;
  const message = String(error.message ?? '').replace(/^\d+\s+[A-Z_]+:\s*/, '');
  const code = status >= 500 ? 'internal_error' : message || 'request_failed';
  const detail = status >= 500 ? 'Internal server error' : message || 'Request failed';

  request.log.warn({ grpcCode, code }, 'gateway request failed');
  return reply
    .code(status)
    .type('application/problem+json')
    .send({
      type: `https://rp-gant.local/problems/${code}`,
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      instance: request.url,
      code,
      traceId: request.id,
    });
}

function setCookies(reply, cookies = []) {
  if (cookies.length > 0) reply.raw.setHeader('set-cookie', cookies);
}

export function csrfValid(request) {
  const cookieToken = request.cookies['__Host-csrf'];
  const headerToken = request.headers['x-csrf-token'];
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

export async function authRoutes(app, { userClient }) {
  app.post('/api/v1/auth/register', async (request, reply) => {
    try {
      const response = await call(userClient, 'Register', {
        email: request.body?.email,
        password: request.body?.password,
        last_name: request.body?.lastName,
        first_name: request.body?.firstName,
        middle_name: request.body?.middleName,
        display_name: request.body?.displayName,
        timezone: request.body?.timezone,
        locale: request.body?.locale,
      });
      return reply.code(201).send({
        userId: response.user_id,
        requiresEmailVerification: response.requires_email_verification,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/email/verify', async (request, reply) => {
    try {
      const response = await call(userClient, 'VerifyEmail', {
        token: request.body?.token,
      });
      return reply.send({ userId: response.user_id, verified: response.verified });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/restore', async (request, reply) => {
    const rememberToken = request.cookies['__Host-remember'];
    if (!rememberToken) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/remember_token_required',
        title: TITLES[401],
        status: 401,
        detail: 'Remember token is required',
        instance: request.url,
        code: 'remember_token_required',
        traceId: request.id,
      });
    }
    try {
      const response = await call(userClient, 'RestoreSession', {
        remember_token: rememberToken,
        user_agent: request.headers['user-agent'] ?? '',
        client_ip: request.ip,
      });
      setCookies(reply, response.set_cookie);
      return reply.send({ user: mapUser(response.user), sessionId: response.session_id });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/users/me', async (request, reply) => {
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: token,
        extend_idle: true,
      });
      const response = await call(userClient, 'GetCurrentUser', {
        user_id: session.user_id,
      });
      return reply.send(mapUser(response.user));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/users/me', async (request, reply) => {
    if (!csrfValid(request)) {
      return reply.code(403).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/csrf_invalid',
        title: TITLES[403],
        status: 403,
        detail: 'Invalid CSRF token',
        instance: request.url,
        code: 'csrf_invalid',
        traceId: request.id,
      });
    }
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: token,
        extend_idle: false,
      });
      const response = await call(userClient, 'UpdateUserProfile', {
        user_id: session.user_id,
        display_name: request.body?.displayName,
        last_name: request.body?.lastName,
        first_name: request.body?.firstName,
        middle_name: request.body?.middleName,
        position: request.body?.position,
        timezone: request.body?.timezone,
        locale: request.body?.locale,
        actor_user_id: session.user_id,
      });
      return reply.send(mapUser(response.user));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/users/:userId', async (request, reply) => {
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      await call(userClient, 'ValidateSession', { session_token: token, extend_idle: false });
      const response = await call(userClient, 'GetUser', { user_id: request.params.userId });
      return reply.send(mapUser(response.user));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/email/resend', async (request, reply) => {
    try {
      const response = await call(userClient, 'ResendEmailVerification', {
        email: request.body?.email,
      });
      return reply.code(202).send({ accepted: response.accepted });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/password/forgot', async (request, reply) => {
    try {
      const response = await call(userClient, 'RequestPasswordReset', {
        email: request.body?.email,
      });
      return reply.code(202).send({ accepted: response.accepted });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/password/reset/validate', async (request, reply) => {
    try {
      const response = await call(userClient, 'ValidatePasswordResetToken', {
        token: request.body?.token,
      });
      return reply.send({ email: response.email });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/password/reset', async (request, reply) => {
    try {
      const response = await call(userClient, 'ResetPassword', {
        token: request.body?.token,
        new_password: request.body?.newPassword,
      });
      setCookies(reply, response.set_cookie);
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/password/change', async (request, reply) => {
    if (!csrfValid(request)) {
      return reply.code(403).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/csrf_invalid',
        title: TITLES[403],
        status: 403,
        detail: 'Invalid CSRF token',
        instance: request.url,
        code: 'csrf_invalid',
        traceId: request.id,
      });
    }
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: token,
        extend_idle: false,
      });
      await call(userClient, 'ChangePassword', {
        user_id: session.user_id,
        current_password: request.body?.currentPassword,
        new_password: request.body?.newPassword,
      });
      reply.raw.setHeader('set-cookie', [
        '__Host-session=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0',
        '__Host-remember=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0',
        '__Host-csrf=; Path=/; Secure; SameSite=Lax; Max-Age=0',
      ]);
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    try {
      const response = await call(userClient, 'Login', {
        email: request.body?.email,
        password: request.body?.password,
        remember_me: Boolean(request.body?.rememberMe),
        user_agent: request.headers['user-agent'] ?? '',
        client_ip: request.ip,
      });
      setCookies(reply, response.set_cookie);
      return reply.send({
        user: mapUser(response.user),
        sessionId: response.session_id,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/auth/session', async (request, reply) => {
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }

    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: token,
        extend_idle: true,
      });
      const response = await call(userClient, 'GetCurrentUser', {
        user_id: session.user_id,
      });
      return reply.send(mapUser(response.user));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/auth/sessions', async (request, reply) => {
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: token,
        extend_idle: true,
      });
      const response = await call(userClient, 'ListMySessions', {
        user_id: session.user_id,
      });
      return reply.send({ items: response.items.map(mapSession) });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/auth/sessions/:sessionId', async (request, reply) => {
    if (!csrfValid(request)) {
      return reply.code(403).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/csrf_invalid',
        title: TITLES[403],
        status: 403,
        detail: 'Invalid CSRF token',
        instance: request.url,
        code: 'csrf_invalid',
        traceId: request.id,
      });
    }
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: token,
        extend_idle: false,
      });
      const response = await call(userClient, 'RevokeMySession', {
        user_id: session.user_id,
        session_id: request.params.sessionId,
      });
      if (!response.revoked) {
        return reply.code(404).type('application/problem+json').send({
          type: 'https://rp-gant.local/problems/not_found',
          title: TITLES[404],
          status: 404,
          detail: 'Session not found',
          instance: request.url,
          code: 'session_not_found',
          traceId: request.id,
        });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/logout-all', async (request, reply) => {
    if (!csrfValid(request)) {
      return reply.code(403).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/csrf_invalid',
        title: TITLES[403],
        status: 403,
        detail: 'Invalid CSRF token',
        instance: request.url,
        code: 'csrf_invalid',
        traceId: request.id,
      });
    }
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: token,
        extend_idle: false,
      });
      const response = await call(userClient, 'LogoutAll', {
        user_id: session.user_id,
      });
      setCookies(reply, response.set_cookie);
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/users', async (request, reply) => {
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      await call(userClient, 'ValidateSession', { session_token: token, extend_idle: false });
      const limit = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 200);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);
      const response = await call(userClient, 'ListUsers', {
        query: String(request.query.query ?? ''),
        page: { limit, offset },
      });
      return reply.send({
        items: response.items.map(mapUserSummary),
        page: response.page,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/executors', async (request, reply) => {
    const token = request.cookies['__Host-session'];
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/unauthenticated',
        title: TITLES[401],
        status: 401,
        detail: 'Session is required',
        instance: request.url,
        code: 'unauthenticated',
        traceId: request.id,
      });
    }
    try {
      await call(userClient, 'ValidateSession', { session_token: token, extend_idle: false });
      const limit = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 200);
      const offset = Math.max(Number(request.query.offset ?? 0), 0);
      const response = await call(userClient, 'ListExecutors', {
        query: String(request.query.query ?? ''),
        project_id: String(request.query.projectId ?? ''),
        include_inactive: request.query.includeInactive === 'true',
        page: { limit, offset },
      });
      return reply.send({
        items: response.items.map(mapExecutor),
        page: response.page,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (!csrfValid(request)) {
      return reply.code(403).type('application/problem+json').send({
        type: 'https://rp-gant.local/problems/csrf_invalid',
        title: TITLES[403],
        status: 403,
        detail: 'Invalid CSRF token',
        instance: request.url,
        code: 'csrf_invalid',
        traceId: request.id,
      });
    }

    try {
      const response = await call(userClient, 'Logout', {
        session_token: request.cookies['__Host-session'],
      });
      setCookies(reply, response.set_cookie);
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
