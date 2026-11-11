import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { createService, getSyncTokenSecret, loadConfig } from '@rp-gant/service-kit';
import { accessRoutes } from './access-routes.js';
import { adminRoutes } from './admin-routes.js';
import { extraRoutes } from './extra-routes.js';
import { auditRoutes } from './audit-routes.js';
import { createAuditClient } from './audit-client.js';
import { authRoutes } from './auth-routes.js';
import { createNotificationClient } from './notification-client.js';
import { notificationRoutes } from './notification-routes.js';
import { createProjectClient } from './project-client.js';
import { projectRoutes } from './projects-routes.js';
import { syncRoutes } from './sync-routes.js';
import { createUserClient } from './user-client.js';

const serviceName = 'api-gateway';
const serviceVersion = '0.1.0';

export function buildApp({
  env = process.env,
  logger = true,
  userClient,
  projectClient,
  notificationClient,
  auditClient,
} = {}) {
  const config = loadConfig(env, {
    logLevel: env.LOG_LEVEL ?? 'info',
    port: 8080,
  });
  const syncTokenSecret = getSyncTokenSecret(env);
  const users =
    userClient ??
    createUserClient({
      address: env.USER_SERVICE_GRPC ?? 'localhost:50051',
    });
  const audit =
    auditClient ??
    createAuditClient({
      baseUrl: env.AUDIT_SERVICE_URL ?? 'http://localhost:8080',
    });
  const notifications =
    notificationClient ??
    createNotificationClient({
      baseUrl: env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:8080',
    });
  const projects =
    projectClient ??
    createProjectClient({
      address: env.PROJECT_SERVICE_GRPC ?? 'localhost:50051',
    });

  const app = createService({
    name: serviceName,
    version: serviceVersion,
    config,
    logger,
    routes: async (instance) => {
      await instance.register(cookie);
      await instance.register(helmet);
      await instance.register(rateLimit, {
        global: true,
        max: Number(env.RATE_LIMIT_MAX ?? 300),
        timeWindow: '1 minute',
      });
      await instance.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
      await instance.register(authRoutes, { userClient: users });
      await instance.register(accessRoutes, { userClient: users });
      await instance.register(syncRoutes, { userClient: users, secret: syncTokenSecret });
      await instance.register(adminRoutes, { userClient: users });
      await instance.register(extraRoutes, { userClient: users });
      await instance.register(projectRoutes, {
        userClient: users,
        projectClient: projects,
      });
      await instance.register(notificationRoutes, {
        userClient: users,
        notificationClient: notifications,
      });
      await instance.register(auditRoutes, {
        userClient: users,
        auditClient: audit,
      });

      instance.get('/api/v1/health', async () => ({
        status: 'ok',
        service: serviceName,
        version: serviceVersion,
      }));
    },
  });

  app.addHook('onClose', async () => {
    users.close?.();
    projects.close?.();
  });

  return app;
}
