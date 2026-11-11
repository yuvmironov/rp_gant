import { signSyncToken } from '@rp-gant/shared';
import { call } from './user-client.js';
import { sendProblem } from './auth-routes.js';

function unauthorized(reply, request) {
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

export async function syncRoutes(app, { userClient, secret }) {
  app.get('/api/v1/sync/token', async (request, reply) => {
    const sessionToken = request.cookies['__Host-session'];
    if (!sessionToken) return unauthorized(reply, request);
    try {
      const session = await call(userClient, 'ValidateSession', {
        session_token: sessionToken,
        extend_idle: false,
      });
      const isAdmin = (session.global_roles ?? []).includes('GLOBAL_ROLE_APP_ADMIN');
      const access = isAdmin
        ? null
        : await call(userClient, 'ListAccessibleProjectIds', { user_id: session.user_id });
      const projectIds = isAdmin ? ['*'] : (access?.items ?? []).map((item) => item.project_id);
      const signed = signSyncToken({
        userId: session.user_id,
        projectIds,
        secret,
      });
      return reply.send({
        token: signed.token,
        expiresAt: new Date(signed.expiresAt * 1000).toISOString(),
        expiresIn: 300,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
