# User & Access Service

Сервис пользователей, доступа и сессий RP Gant.

Сейчас реализованы:

- HTTP health `/health/live`, `/health/ready`;
- gRPC-сервер на `50051`;
- стандартный `grpc.health.v1.Health` со статусом `SERVING`;
- загрузка контракта `rpgant.user.v1.UserService`;
- auth: `Register`, `VerifyEmail`, `Login`, `ValidateSession`, `Logout`, `LogoutAll`;
- сессии: `RestoreSession`, `ListMySessions`, `RevokeMySession`;
- пароли: `ResendEmailVerification`, `RequestPasswordReset`, `ResetPassword`, `ChangePassword`;
- профиль и пользователи: `GetCurrentUser`, `GetUser`, `UpdateUserProfile`, `ListUsers`, `AdminCreateUser`, `DeleteUser`, `BlockUser`, `UnblockUser`, `GetUsersByIds`;
- `ListUsers` возвращает фактические `global_roles`, включая `GLOBAL_ROLE_APP_ADMIN`;
- роли, права и доступ: `GetRoles`, `GetPermissions`, `GetUserRoles`, `SetUserGlobalRoles`, `GetProjectAccess`, `CheckProjectPermission`, `ListAccessibleProjectIds`, `EnsureProjectOwner`;
- участники проекта: `ListProjectMembers`, `UpdateProjectMemberRole`, `RemoveProjectMember`, `SetProjectOwnerMembership`;
- приглашения: `CreateInvitation`, `ListProjectInvitations`, `ResendInvitation`, `RevokeInvitation`, `AcceptInvitation`;
- исполнители: `CreateExecutor`, `UpdateExecutor`, `DeleteExecutor`, `LinkExecutorUser`, `UnlinkExecutorUser`, `ListExecutors`, `GetExecutorsByIds`;
- настройки: `GetSystemSettings`, `UpdateSystemSettings`;
- контакты и Telegram: `GetNotificationContacts`, `CreateTelegramLinkCode`, `LinkTelegram`, `UnlinkTelegram`;
- PostgreSQL, Argon2id, cookie-сессии, lockout после неудачных попыток;
- `DEV_AUTO_VERIFY=true` для local автоматически подтверждает email при регистрации;
- graceful shutdown HTTP, gRPC и PostgreSQL pool;
- Dockerfile для non-root runtime.

## Сроки и учёт сессий

- Обычная сессия истекает после **10 минут бездействия** или **1 часа** с момента входа — в зависимости от того, что наступит раньше.
- API-клиент может запросить режим `rememberMe: true` при `POST /api/v1/auth/login`: для него срок бездействия — **7 дней**, абсолютный срок — **30 дней**. Активность, продлевающая idle-срок, также продлевает idle-срок remember-токена; восстановление доступно только пока не истекли оба срока.
- Nuxt-форма передаёт фактическое состояние чекбокса `rememberMe` (по умолчанию он включён). Если access-сессия истекла или браузер был перезапущен, страница входа вызывает `POST /api/v1/auth/restore`; при действующем remember-токене пользователь возвращается в проекты без повторного ввода пароля.
- Срок проверяется при следующем авторизованном запросе, а не отдельным периодическим заданием. Вкладка может оставаться открытой до следующего запроса; после истечения сервер отклоняет сессию, а API Gateway отвечает `401`.
- Лимит — **две одновременно действующие сессии**. Истёкшие записи не занимают слот; действующий remember-токен продолжает занимать слот, пока ещё может восстановить доступ.
- Истёкшие строки не удаляются физически: они исключаются из подсчёта лимита и списка сессий, а затем помечаются `revoked_at` при проверке сессии, следующем успешном входе или применении миграции. Миграция `db/migrations/user_access/0002_session_idle_expiration.sql` также отзывает уже истёкшие записи.
- Обычный выход отзывает текущую сессию; `LogoutAll` отзывает все сессии пользователя.

Проверка gRPC-контракта:

```powershell
pnpm test:unit
```

Запуск в Compose:

```powershell
docker compose --env-file infrastructure/local/.env.local `
  --profile infra --profile apps `
  -f infrastructure/local/docker-compose.yml up -d --build user-service
```

gRPC-порт: `localhost:50051`. HTTP health: `http://localhost:8080/health/live` внутри контейнера.
