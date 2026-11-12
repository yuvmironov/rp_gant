# API Gateway

Тонкий входной слой RP Gant.

Сейчас реализованы:

- Fastify 5, `@fastify/helmet`, глобальный rate limit и multipart до 50 MB;
- `/health/live`, `/health/ready`;
- `/api/v1/health`;
- CSRF-проверка для изменяющих запросов;
- request id, RFC 7807 errors, graceful shutdown;
- gRPC-клиенты к User Service и Project Service;
- HTTP-клиенты к Notification Service и Audit Service.

## REST API

### Auth, профиль и сессии

- `POST /api/v1/auth/register`;
- `POST /api/v1/auth/email/verify`, `POST /api/v1/auth/email/resend`;
- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-all`;
- `POST /api/v1/auth/restore`;
- `POST /api/v1/auth/password/forgot`, `POST /api/v1/auth/password/reset`, `POST /api/v1/auth/password/change`;
- `GET /api/v1/auth/session`, `GET /api/v1/auth/sessions`;
- `DELETE /api/v1/auth/sessions/{sessionId}`;
- `GET /api/v1/users/me`, `PATCH /api/v1/users/me`;
- `GET /api/v1/users`, `GET /api/v1/users/{userId}`;
- `GET /api/v1/roles`, `GET /api/v1/permissions`;
- `GET /api/v1/settings`, `PUT /api/v1/settings`.

`POST /api/v1/auth/login` принимает `rememberMe: boolean`. Nuxt-форма передаёт состояние чекбокса; при отсутствии обычной сессии она пробует `POST /api/v1/auth/restore` и продолжает вход, если remember-токен ещё действителен. `GET /api/v1/auth/session` возвращает `401`, если cookie отсутствует или сессия отозвана/истекла; срок проверяется при запросе. Idle- и абсолютные TTL и лимит активных сессий описаны в [README User & Access Service](../user-service/README.md).

### Участники и приглашения

- `GET /api/v1/projects/{projectId}/members`;
- `PATCH /api/v1/projects/{projectId}/members/{userId}`;
- `DELETE /api/v1/projects/{projectId}/members/{userId}`;
- `GET /api/v1/projects/{projectId}/invitations`;
- `POST /api/v1/projects/{projectId}/invitations`;
- `POST /api/v1/invitations/{invitationId}/resend`;
- `DELETE /api/v1/invitations/{invitationId}`;
- `POST /api/v1/invitations/accept`.

### Проекты и диаграммы

- `GET /api/v1/projects` (`status=active|archived|deleted`), `POST /api/v1/projects`;
- `GET /api/v1/projects/{projectId}`, `PATCH /api/v1/projects/{projectId}`;
- `POST /api/v1/projects/{projectId}/archive`, `POST /api/v1/projects/{projectId}/unarchive`;
- `DELETE /api/v1/projects/{projectId}`, `POST /api/v1/projects/{projectId}/restore`;
- `GET /api/v1/projects/{projectId}/diagrams`, `POST /api/v1/projects/{projectId}/diagrams`;
- `GET /api/v1/diagrams/{diagramId}`, `PATCH /api/v1/diagrams/{diagramId}`, `DELETE /api/v1/diagrams/{diagramId}`;
- `GET /api/v1/diagrams/{diagramId}/snapshot`.

### Направления, задачи и назначения

- `POST /api/v1/diagrams/{diagramId}/directions`;
- `PATCH /api/v1/directions/{directionId}`, `DELETE /api/v1/directions/{directionId}`;
- `POST /api/v1/diagrams/{diagramId}/directions/reorder`;
- `PUT /api/v1/directions/{directionId}/responsible`;
- `POST /api/v1/diagrams/{diagramId}/tasks`;
- `GET /api/v1/tasks/{taskId}`, `PATCH /api/v1/tasks/{taskId}`, `DELETE /api/v1/tasks/{taskId}`;
- `POST /api/v1/tasks/{taskId}/move`;
- `PATCH /api/v1/tasks/{taskId}/progress`;
- `PUT /api/v1/tasks/{taskId}/assignments`;
- `estimatedHours > 0`: окончание задачи рассчитывается автоматически по 8 часов в день с учётом рабочего/календарного режима.

### Связи, комментарии и календарь

- `GET /api/v1/diagrams/{diagramId}/dependencies`, `POST /api/v1/diagrams/{diagramId}/dependencies`;
- `PATCH /api/v1/dependencies/{dependencyId}`, `DELETE /api/v1/dependencies/{dependencyId}`;
- разрешены `direction → direction` и `task → direction`; `direction → task` отклоняется с `400 direction_to_task_dependency_forbidden`;
- циклические зависимости отклоняются с `dependency_cycle`;
- `GET /api/v1/comments`, `POST /api/v1/comments`;
- `PATCH /api/v1/comments/{commentId}`, `DELETE /api/v1/comments/{commentId}`;
- `GET /api/v1/diagrams/{diagramId}/holidays`, `PUT /api/v1/diagrams/{diagramId}/holidays`.

### Импорт и экспорт

- `POST /api/v1/diagrams/{diagramId}/import`;
- `GET /api/v1/import-jobs/{jobId}`;
- `POST /api/v1/import-jobs/{jobId}/cancel`;
- `GET /api/v1/diagrams/{diagramId}/export` (`json`, `csv`, `compat=standalone`).

### Уведомления, аудит и синхронизация

- `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`;
- `POST /api/v1/notifications/{notificationId}/read`, `POST /api/v1/notifications/read-all`;
- `GET /api/v1/notifications/preferences`, `PUT /api/v1/notifications/preferences`;
- `GET /api/v1/notifications/delivery-log`, `GET /api/v1/notifications/delivery-stats`;
- `GET /api/v1/audit/events`, `GET /api/v1/audit/privileged-events`;
- `GET /api/v1/audit/actions`, `GET /api/v1/audit/stats`;
- `GET /api/v1/sync/token`.

### Администрирование, исполнители и Telegram

- `POST /api/v1/admin/users`, `DELETE /api/v1/admin/users/{userId}`;
- `PATCH /api/v1/admin/users/{userId}/profile`, `PATCH /api/v1/admin/users/{userId}/roles`;
- `PATCH /api/v1/admin/users/{userId}/block`, `PATCH /api/v1/admin/users/{userId}/unblock`;
- `GET /api/v1/executors` accepts `projectId` to return only catalog entries available in that project;
- `POST /api/v1/executors` and `PATCH /api/v1/executors/{executorId}` require a non-empty `projectIds` array of active projects;
- `DELETE /api/v1/executors/{executorId}` deactivates an executor and removes its project associations;
- `GET /api/v1/users/me/contacts`;
- `POST /api/v1/users/me/telegram/link-code`, `POST /api/v1/users/me/telegram`, `DELETE /api/v1/users/me/telegram`.

## Запуск

```powershell
pnpm start:api-gateway
```

Проверка:

```powershell
curl http://localhost:8080/health/live
curl http://localhost:8080/api/v1/health
```

Docker:

```powershell
docker build -f apps/api-gateway/Dockerfile -t rp-gant/api-gateway:dev .
docker run --rm -p 8080:8080 rp-gant/api-gateway:dev
```
