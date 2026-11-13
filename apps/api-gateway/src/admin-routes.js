import { call } from './user-client.js';
import { mapUser, sendProblem } from './auth-routes.js';

export function unauthorized(reply, request) {
  return reply.code(401).type('application/problem+json').send({
    type: 'https://rp-gant.local/problems/unauthenticated',
    title: 'Unauthorized',
    status: 401,
    detail: 'Session is required',
    instance: request.url,
    code: 'unauthenticated',
    traceId: request.id,
  });
}

export function forbidden(reply, request) {
  return reply.code(403).type('application/problem+json').send({
    type: 'https://rp-gant.local/problems/admin_forbidden',
    title: 'Forbidden',
    status: 403,
    detail: 'Administrator access required',
    instance: request.url,
    code: 'admin_forbidden',
    traceId: request.id,
  });
}

export function csrfValid(request) {
  const cookieToken = request.cookies['__Host-csrf'];
  const headerToken = request.headers['x-csrf-token'];
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

export async function sessionFor(userClient, request) {
  const token = request.cookies['__Host-session'];
  if (!token) return null;
  return call(userClient, 'ValidateSession', { session_token: token, extend_idle: false });
}

export async function requireAdmin(userClient, request, reply) {
  const session = await sessionFor(userClient, request);
  if (!session) return { denied: unauthorized(reply, request) };
  const roles = await call(userClient, 'GetUserRoles', { user_id: session.user_id });
  if (!(roles.global_roles ?? []).includes('GLOBAL_ROLE_APP_ADMIN')) {
    return { denied: forbidden(reply, request) };
  }
  return { session };
}

export async function adminRoutes(app, { userClient }) {
  app.patch('/api/v1/admin/users/:userId/roles', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const response = await call(userClient, 'SetUserGlobalRoles', {
        user_id: request.params.userId,
        roles: request.body?.appAdmin ? ['GLOBAL_ROLE_APP_ADMIN'] : [],
        actor_user_id: access.session.user_id,
      });
      return reply.send(mapUser(response.user));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/admin/users/:userId/block', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      await call(userClient, 'BlockUser', {
        user_id: request.params.userId,
        actor_user_id: access.session.user_id,
        reason: request.body?.reason,
      });
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/admin/users/:userId/unblock', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      await call(userClient, 'UnblockUser', {
        user_id: request.params.userId,
        actor_user_id: access.session.user_id,
      });
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
