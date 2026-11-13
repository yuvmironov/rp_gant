import { fromProtoStruct, toProtoStruct } from '@rp-gant/service-kit';
import { call } from './user-client.js';
import { mapUser, sendProblem } from './auth-routes.js';
import { csrfValid, forbidden, requireAdmin, sessionFor, unauthorized } from './admin-routes.js';

async function requireUser(userClient, request, reply) {
  const session = await sessionFor(userClient, request);
  if (!session) return { denied: unauthorized(reply, request) };
  return { session };
}

export async function extraRoutes(app, { userClient }) {
  app.post('/api/v1/admin/users', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const response = await call(userClient, 'AdminCreateUser', {
        email: request.body?.email,
        last_name: request.body?.lastName,
        first_name: request.body?.firstName,
        middle_name: request.body?.middleName,
        display_name: request.body?.displayName,
        position: request.body?.position,
        timezone: request.body?.timezone,
        locale: request.body?.locale,
        global_roles: request.body?.appAdmin ? ['GLOBAL_ROLE_APP_ADMIN'] : [],
        actor_user_id: access.session.user_id,
      });
      return reply.code(201).send(mapUser(response.user));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/admin/users/:userId', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      await call(userClient, 'DeleteUser', {
        user_id: request.params.userId,
        actor_user_id: access.session.user_id,
        reason: request.body?.reason,
      });
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.patch('/api/v1/admin/users/:userId/profile', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const response = await call(userClient, 'UpdateUserProfile', {
        user_id: request.params.userId,
        display_name: request.body?.displayName,
        last_name: request.body?.lastName,
        first_name: request.body?.firstName,
        middle_name: request.body?.middleName,
        position: request.body?.position,
        timezone: request.body?.timezone,
        locale: request.body?.locale,
        actor_user_id: access.session.user_id,
      });
      return reply.send(mapUser(response.user));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/roles', async (request, reply) => {
    const access = await requireUser(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      return reply.send(await call(userClient, 'GetRoles', {}));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/permissions', async (request, reply) => {
    const access = await requireUser(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      return reply.send(await call(userClient, 'GetPermissions', {}));
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/settings', async (request, reply) => {
    const access = await requireUser(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const response = await call(userClient, 'GetSystemSettings', {});
      return reply.send({
        ...response,
        items: (response.items ?? []).map((item) => ({
          ...item,
          value: fromProtoStruct(item.value),
        })),
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.put('/api/v1/settings', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireAdmin(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const response = await call(userClient, 'UpdateSystemSettings', {
        items: (request.body?.items ?? []).map((item) => ({
          ...item,
          value: toProtoStruct(item.value),
        })),
        actor_user_id: access.session.user_id,
      });
      return reply.send({
        ...response,
        items: (response.items ?? []).map((item) => ({
          ...item,
          value: fromProtoStruct(item.value),
        })),
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/users/me/contacts', async (request, reply) => {
    const access = await requireUser(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      const response = await call(userClient, 'GetNotificationContacts', {
        user_ids: [access.session.user_id],
      });
      const item = response.items[0];
      if (!item) return reply.send({});
      return reply.send({
        userId: item.user_id,
        email: item.email,
        emailVerified: item.email_verified,
        telegramUserId: Number(item.telegram_user_id ?? 0),
        telegramUsername: item.telegram_username,
        telegramLinked: item.telegram_linked,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/users/me/telegram/link-code', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireUser(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      return reply.send(
        await call(userClient, 'CreateTelegramLinkCode', { user_id: access.session.user_id }),
      );
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.post('/api/v1/users/me/telegram', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireUser(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      return reply.send(
        await call(userClient, 'LinkTelegram', {
          code: request.body?.code,
          telegram_user_id: Number(request.body?.telegramUserId ?? 0),
          telegram_username: request.body?.telegramUsername,
        }),
      );
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.delete('/api/v1/users/me/telegram', async (request, reply) => {
    if (!csrfValid(request)) return forbidden(reply, request);
    const access = await requireUser(userClient, request, reply);
    if (access.denied) return access.denied;
    try {
      await call(userClient, 'UnlinkTelegram', { user_id: access.session.user_id });
      return reply.code(204).send();
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
