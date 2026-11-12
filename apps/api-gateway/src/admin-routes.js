import { call } from './user-client.js';
import { call as callProject } from './project-client.js';
import { mapExecutor, mapUser, sendProblem } from './auth-routes.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function validateExecutorProjectIds(projectClient, actorUserId, values) {
  const projectIds = Array.isArray(values)
    ? [
        ...new Set(
          values.map((value) =>
            String(value ?? '')
              .trim()
              .toLowerCase(),
          ),
        ),
      ]
    : [];
  if (!projectIds.length || projectIds.some((id) => !UUID_PATTERN.test(id))) {
    const error = new Error('executor_projects_required');
    error.code = 3;
    throw error;
  }
  const activeIds = new Set();
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const response = await callProject(projectClient, 'ListProjects', {
      user_id: actorUserId,
      status: 'PROJECT_STATUS_ACTIVE',
      page: { limit: 200, offset },
    });
    for (const project of response.items ?? []) activeIds.add(project.id);
    total = Number(response.page?.total ?? activeIds.size);
    offset += (response.items ?? []).length;
    if ((response.items ?? []).length === 0) break;
  }
  if (projectIds.some((id) => !activeIds.has(id))) {
    const error = new Error('executor_project_not_active');
    error.code = 3;
    throw error;
  }
  return projectIds;
}

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

export async function adminRoutes(app, { userClient, projectClient }) {
  app.post('/api/v1/executors', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const projectIds = await validateExecutorProjectIds(
        projectClient,
        access.session.user_id,
        request.body?.projectIds,
      );
      const response = await call(userClient, 'CreateExecutor', {
        last_name: request.body?.lastName,
        first_name: request.body?.firstName,
        middle_name: request.body?.middleName,
        position: request.body?.position,
        project_ids: projectIds,
        actor_user_id: access.session.user_id,
      });
      return reply.code(201).send(mapExecutor(response.executor));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/executors/:executorId', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const projectIds = await validateExecutorProjectIds(
        projectClient,
        access.session.user_id,
        request.body?.projectIds,
      );
      const response = await call(userClient, 'UpdateExecutor', {
        executor_id: request.params.executorId,
        last_name: request.body?.lastName,
        first_name: request.body?.firstName,
        middle_name: request.body?.middleName,
        position: request.body?.position,
        project_ids: projectIds,
        update_project_ids: true,
        actor_user_id: access.session.user_id,
      });
      return reply.send(mapExecutor(response.executor));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/executors/:executorId', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      await call(userClient, 'DeleteExecutor', {
        executor_id: request.params.executorId,
        actor_user_id: access.session.user_id,
      });
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

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
