# RP Gant

Планировщик RP Gant: API Gateway, User & Access, Project / Diagram, Notification, Audit, Sync и Nuxt web-интерфейс для локального запуска.

## Требования

Для локального запуска достаточно Docker Desktop/Engine + Compose v2.

Для разработки и тестов:

- Node.js 22 LTS;
- pnpm 10 через Corepack;
- Helm 3.16+ или Helm 4.x и kubectl — для Kubernetes. Chart проверен на Helm 4.3.1.

## Первый локальный запуск

```bash
cp infrastructure/local/.env.example infrastructure/local/.env.local
docker compose --env-file infrastructure/local/.env.local -f infrastructure/local/docker-compose.yml --profile infra --profile apps up -d --build
```

При первом запуске автоматически:

- создаются базы данных;
- применяются миграции и seed;
- создаётся development-администратор;
- Traefik отдаёт локальный самоподписанный сертификат.

Открыть приложение: **https://app.rp-gant.localhost**

Данные администратора по умолчанию:

```text
admin@rp-gant.local
ChangeMeDevOnly!
```

Проверка:

```bash
docker compose --env-file infrastructure/local/.env.local -f infrastructure/local/docker-compose.yml --profile infra --profile apps ps
curl -k https://app.rp-gant.localhost/health
curl -k https://app.rp-gant.localhost/api/v1/health
```

Повторный запуск после `down` не требует ручных миграций — `db-init` идемпотентен.

Остановка:

```bash
docker compose --env-file infrastructure/local/.env.local -f infrastructure/local/docker-compose.yml --profile infra --profile apps down
```

Удаление данных:

```bash
docker compose --env-file infrastructure/local/.env.local -f infrastructure/local/docker-compose.yml --profile infra --profile apps down -v
```

## Участники, приглашения и пароли

- Кнопка **Участники** в выбранном проекте: добавление существующего пользователя, приглашение по email, смена роли и удаление.
- Новые приглашения и письма для сброса пароля приходят в Mailpit: **https://mail.rp-gant.localhost**.
- Ссылка сброса открывает форму нового пароля; смена пароля доступна в верхнем меню.
- Gantt обновляется в реальном времени через `sync-service`; уведомления загружаются через REST API, WebSocket для них пока не реализован.

## Локальные команды

```bash
pnpm local:up       # запуск infra + apps
pnpm local:status   # состояние контейнеров
pnpm local:health   # проверка app, sync и Mailpit
pnpm local:demo     # демо-пользователи, проект, диаграмма и задачи (demo.owner@rp-gant.local / DemoPassword123!)
pnpm local:logs     # логи
pnpm local:down     # остановка
pnpm local:reset    # остановка с удалением volumes
pnpm local:backup   # дамп всех БД в backups/
pnpm local:restore -- backups/<file>.sql
pnpm local:verify-restore  # restore-drill в отдельном контейнере
```

## HTTPS

Traefik использует собственный самоподписанный сертификат. Браузер покажет предупреждение — для local его нужно принять один раз.

Доверенный сертификат можно подключить позже через `tls.certificates` в `infrastructure/local/traefik/dynamic.yml`.

## Адреса

- `app.rp-gant.localhost` — Nuxt web-интерфейс;
- `api.rp-gant.localhost` — API Gateway;
- `mail.rp-gant.localhost` — Mailpit UI;
- `kafka.rp-gant.localhost` — Kafka UI;
- `sync.rp-gant.localhost` — Sync Service WebSocket;
- `notify.rp-gant.localhost` — Notification Service HTTP; WebSocket запланирован, но не реализован.

## Команды разработки

```bash
pnpm lint
pnpm format:check
pnpm test
pnpm test:unit
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm start:api-gateway
pnpm start:user-service
pnpm start:project-service
```

`pnpm test:e2e` использует Playwright и Chrome, поэтому требует запущенный локальный стек.

## Структура

```text
apps/api-gateway/      # HTTP API Gateway, REST API, health/config/errors
apps/user-service/     # User & Access: auth, sessions, HTTP health + gRPC
apps/project-service/  # Project/Diagram: HTTP health + gRPC
apps/frontend/         # Nuxt SPA + same-origin proxy к API
apps/web/              # legacy static UI; Compose его не запускает
apps/notification-service/ # уведомления, Email/Telegram delivery, preferences
apps/audit-service/    # аудит и privileged events
apps/sync-service/     # WebSocket-синхронизация Gantt
packages/service-kit/  # общий каркас Fastify/gRPC-сервисов
packages/shared/       # общие утилиты
contracts/             # REST/gRPC mapping, import/export
proto/                 # protobuf-контракты
openapi/               # OpenAPI
events/                # события
notifications/         # шаблоны и схемы
db/                    # миграции и seed
infrastructure/local/  # Docker Compose, db-init
infrastructure/vps/    # production Compose для одного VPS за Jino-прокси
infrastructure/helm/   # Helm charts + staging/prod values
docs/                  # миграция и эксплуатационные заметки
tools/                 # проверки контрактов
```

## Документация

Актуальная техническая документация — README сервисов, `openapi/`, `proto/`, `events/` и каталог `docs/`.

- [`docs/MIGRATION-rp-gant.md`](docs/MIGRATION-rp-gant.md) — переход с `smart-oati` на `rp-gant`, перенос БД, volumes, Helm и CI.
- [`docs/SPEC-STATUS.md`](docs/SPEC-STATUS.md) — состояние REST/gRPC/events/WebSocket-спецификаций.
- [`docs/requirements/system/P0/22_Staging_Deployment_Runbook.md`](docs/requirements/system/P0/22_Staging_Deployment_Runbook.md) — gates, rollout, acceptance и rollback для staging.
- [`changelog.md`](changelog.md) — история изменений приложения и реализованных исправлений.
- [`docs/requirements/README.md`](docs/requirements/README.md) — исходные бизнес- и системные постановки и P0-пакет; changelog требований находится в `docs/requirements/changelog.md`.
- [`infrastructure/vps/README.md`](infrastructure/vps/README.md) — production-развёртывание и обновление одного VPS за Jino-прокси.

## Статус

- [x] Контракты OpenAPI/proto/events.
- [x] DDL, seed, diagram export.
- [x] Базовый CI и проверки контрактов.
- [x] Docker Compose для инфраструктуры и приложений.
- [x] Автоматические миграции, seed и development-admin.
- [x] Helm service template и API Gateway chart.
- [x] API Gateway REST auth proxy.
- [x] User & Access: auth, sessions, HTTP health + gRPC.
- [x] Project / Diagram: lifecycle + directions + tasks + assignments + dependencies + comments + holidays + JSON/CSV export/import. Разрешены direction→direction и task→direction; direction→task запрещён на API и в БД.
- [x] Web-интерфейс: вход, проекты, диаграммы, Gantt, модалки задачи/направления/связей/календаря/импорта, назначения, комментарии, перемещение, фильтры, сессии, экспорт, toast-уведомления.
- [x] Nuxt SPA — основной интерфейс; legacy static UI больше не обслуживается.
- [x] Компонентные страницы Nuxt: `/projects`, `/projects/:id`, `/gantt`, `/login`, `/admin`, `/profile`, `/notifications`, `/members`.
- [x] Vue Gantt: task/direction CRUD, назначения, прогресс, комментарии, зависимости с правилами типов и стилями, календарь, импорт/экспорт, realtime, drag-and-drop, создание проекта/диаграммы/направления, weekend shading, toast-уведомления, расчёт окончания задачи по часам (8 ч/день).
- [x] Notification, Audit и Sync services.
- [x] Helm charts для сервисов и umbrella values для staging/prod.
- [x] VPS Compose подключает отдельную Sync DB, миграцию ledger и Kafka DLQ/replay topics; CI проверяет шаблонную конфигурацию. Production VPS обновлён 2026-11-11 до `b75c853`.
- [x] Playwright E2E, 20 сценариев: auth, remember me, admin roles, Gantt, dependency rules/link mode, bar drag, task hours, import, members, notifications, profile и password reset.
- [x] Security headers, CSP, API rate limiting и auth audit events.
- [x] Project members, invitations, password reset/change и resend verification.
- [x] Global admin roles: создание администратора и повышение существующего пользователя.
- [x] Real-time синхронизация Gantt через `sync-service`.
- [x] Project-scoped sync tokens и authenticated WebSocket.
- [x] Email/Telegram delivery worker, notification preferences и Telegram linking.
- [x] Session restore, profile editing and local admin user creation.
- [x] Admin user roles, blocking and user lifecycle.
- [x] Load tests (k6 smoke: 10 VUs, 20s, p95 43 ms, 0 errors).
- [x] Prometheus metrics, local Grafana dashboards and alerts для HTTP, outbox, consumer retry/DLQ и Kafka lag.
- [x] System settings UI, audit filters and authenticated k6 scenario.
- [x] Outbox retry/DLQ и approval-gated replay для Audit/Notification/Sync; Sync хранит replay dedup markers в отдельной `rp_gant_sync` DB.
- [x] Restore drill пяти service DB, включая Sync ledger.
- [x] Staging-only Helm values, per-service Vault references, opt-in Sync migration и Managed Kafka TLS/SASL config; staging render проверяется CI с digest/bootstrap guard.
- [ ] Kubernetes staging rollout и runtime cluster acceptance; владельцем staging gate принят, но managed-cluster deployment и реальные Vault/Kafka integration tests в этой итерации не выполнялись.

Локальные проверки прошли; production VPS обновлён до `b75c853`. Внешние app/Sync health вернули 200, backup всех пяти БД восстановлен в изолированной проверке. Сводка и оставшиеся ограничения — в `docs/IMPLEMENTATION-STATUS.md`. Аутентифицированный WebSocket `101` отдельно не проверялся.

## Observability

Все Fastify-сервисы отдают Prometheus-метрики на `/metrics`: количество запросов, длительность, процессные метрики и статус цели. Outbox, consumer retries, DLQ и event processing дополнительно экспортируются; Kafka Exporter измеряет consumer lag в количестве сообщений. Helm-поды получают scrape-аннотации `prometheus.io/*`.

`sync-service` дополнительно отдаёт `sync_ws_connections_active`, `sync_ws_auth_failures_total` и `sync_events_sent_total`. Sync-токены подписаны `SYNC_TOKEN_SECRET`; local Compose использует development-значение и отдельную `rp_gant_sync` БД для durable replay dedup. Staging chart ожидает `rp-gant-sync` Secret с `token` и `DATABASE_URL_SYNC`; реальные staging credentials в репозитории отсутствуют.

Локальный мониторинг:

```bash
docker compose --env-file infrastructure/local/.env.local -f infrastructure/local/docker-compose.yml --profile monitoring up -d prometheus grafana
```

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (`admin` / `admin` locally)
- Alert rules: `infrastructure/local/monitoring/alerts.yml`
- Dashboard: `infrastructure/local/monitoring/grafana/dashboards/rp-gant.json`
