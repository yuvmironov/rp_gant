# Состояние реализации RP Gant

**Проверено:** 2026-11-11
**Назначение:** описать наблюдаемое состояние кода, контрактов и локальной инфраструктуры. Это не подтверждение готовности production-развертывания.

## Как читать документацию

1. Для фактического поведения приложения ориентируйтесь на код и конфигурацию в `apps/`, `packages/`, `infrastructure/`.
2. Для форматов API и сообщений — на контрактные артефакты `openapi/`, `proto/`, `events/`, `sync/` и `notifications/`.
3. `docs/SPEC-STATUS.md` — сводка покрытия контрактов; этот документ — сводка реализации и известных расхождений.
4. Документы в `docs/requirements/` описывают бизнес-цели, проектные решения или планируемое поведение. Их наличие само по себе не означает, что функция реализована.
5. Если требования расходятся с текущим кодом, расхождение ниже считается открытым вопросом, а не автоматически принятым изменением требований.

## Сводка по компонентам

| Область | Состояние в репозитории | Основные источники |
|---|---|---|
| REST API | OpenAPI описывает 76 paths и 99 operations. Gateway имеет маршруты auth, users, projects/diagrams, audit, notifications, Telegram и admin. | `openapi/openapi.yaml`, `apps/api-gateway/src/`, `apps/api-gateway/README.md` |
| Auth и сессии | Лимит — две логически активные сессии: обычная действует 10 минут idle / 1 час absolute; remember-токен — 7 дней idle / 30 дней absolute. Истёкшие слоты не учитываются; Nuxt login передаёт состояние remember-чекбокса и восстанавливает сессию через `/auth/restore`. | `apps/user-service/src/auth.js`, `apps/frontend/pages/login.vue`, `db/migrations/user_access/0002_session_idle_expiration.sql` |
| REST/gRPC mapping | В `contracts/rest-grpc-map.yaml` 97 записей. `health` и `getSyncToken` не имеют gRPC mapping; mapping не должен считаться полным покрытием каждого OpenAPI operation. | `contracts/rest-grpc-map.yaml`, `tools/check-contracts.mjs` |
| gRPC | 6 proto-файлов: User, Project, Notification, Audit, common и events. User/Project доступны Gateway по gRPC; Gateway вызывает Notification и Audit через внутренний HTTP-клиент. | `proto/rpgant/`, `apps/api-gateway/src/*-client.js`, README сервисов |
| События | Каталог содержит 68 событий: 30 `implemented`, 38 `planned`. JSON Schema реального envelope использует snake_case; в `payloads.schema.json` проверка ожидает 79 определений payload. | `events/event-types.json`, `events/schemas/`, `tools/check-contracts.mjs` |
| Sync WebSocket | Реализован `/ws?token=...`. Project scope берётся из claims sync-токена; subscribe/unsubscribe нет. Сервер отправляет `connected`, `diagram.changed`, `pong`, `error`. | `apps/sync-service/src/app.js`, `sync/asyncapi.yaml` |
| Уведомления, auth-email и Telegram | Notification Service потребляет поддерживаемые Kafka-события, хранит уведомления и доставляет internal/email/Telegram по worker; `/ws/notifications` не реализован. User Service отправляет verification/reset письма напрямую через nodemailer, а не по gRPC через Notification Service. Telegram link-code и outbound delivery присутствуют; отдельный Bot webhook в приложениях не найден. | `apps/notification-service/src/events.js`, `apps/notification-service/src/delivery-worker.js`, `apps/user-service/src/mailer.js`, `apps/user-service/src/auth.js` |
| Хранилища | Локальный Compose использует `postgres:17-alpine`, Kafka KRaft и Redis-контейнер, который приложение пока не использует. Базы называются `rp_gant_user`, `rp_gant_project`, `rp_gant_notification`, `rp_gant_audit`. Версия production PostgreSQL в репозитории не подтверждена. | `infrastructure/local/docker-compose.yml`, `infrastructure/local/postgres/init/`, `infrastructure/local/.env.example` |
| Kafka | Compose и все publishers/consumers используют единый canonical topic `rp_gant.events`, в том числе при запуске без `KAFKA_TOPIC`. | `packages/service-kit/src/config.js`, `infrastructure/local/docker-compose.yml`, `apps/*/src/events*.js` |
| Проекты и диаграммы | Project Service реализует проекты, диаграммы, направления, задачи, назначения, зависимости, комментарии, календарь, ревизии, импорт и экспорт. Permission-check вызывается в сервисе. | `apps/project-service/README.md`, `apps/project-service/src/projects.js` |
| Импорт | Импорт адресуется существующим `diagramId`; обработчик в транзакции очищает текущие назначения, комментарии, зависимости, праздники, задачи и направления диаграммы, затем записывает импорт. Preview делает rollback. | `apps/project-service/src/projects.js` (`processDiagramImport`, `StartImport`) |
| Frontend | `apps/frontend` — Nuxt 3, но `ssr: false`: текущая сборка работает без SSR. Local Compose запускает этот Nuxt SPA; legacy `apps/web` Compose не запускает. Документы, описывающие SSR, относятся к целевой постановке, пока SSR не будет включён в конфигурации. | `apps/frontend/nuxt.config.ts`, `apps/frontend/package.json` |
| Локальная разработка и CI | Есть Dockerfile приложений, local Compose, GitHub Actions для CI, contract checks, E2E, images/security и Helm charts сервисов/umbrella. Наличие манифестов не является подтверждением проверенного production deployment. | `apps/*/Dockerfile`, `.github/workflows/`, `infrastructure/helm/`, `tools/` |

## Проверенные расхождения и ограничения

1. **Sync-контракт P0 устарел относительно реализации.** `docs/requirements/system/P0/03_WebSocket_контракт.md` описывает cookie-аутентификацию, `subscribe`/`unsubscribe`, backfill и notification WebSocket. Фактический Sync принимает token query-параметром, scope берёт из токена и не поддерживает подписки. Для интеграции используйте `sync/asyncapi.yaml` и код. `SYNC_TOKEN_SECRET` обязателен вне local/development/test; local Compose задаёт только development secret, а production placeholder отвергается при старте.
2. **Kafka topic default выровнен.** Compose, service-kit и все publishers/consumers используют `rp_gant.events`; `KAFKA_TOPIC` позволяет переопределить его явно.
3. **REST mapping исключает gateway-managed операции.** OpenAPI содержит 99 операций; mapping содержит 97 записей. `health` и `getSyncToken` намеренно не маппятся на gRPC. `tools/check-contracts.mjs` теперь проверяет operationId покрытие и фиксированный список этих двух исключений, но не доказывает семантическую корректность каждой связи.
4. **Документы событий имеют разные редакции.** P0/ADR используют camelCase и названия полей `version`/`producer`; фактическая schema использует snake_case и `schema_version`/`source_service`. Каталог событий содержит 68 типов, payload schema — 79 `$defs`; эти числа описывают разные сущности.
5. **Роли в событиях не передаются фактически.** JSON Schema требует `actor_roles`, но publishers User и Project пока записывают пустой массив; Audit consumer сохраняет его без запроса ролей. Это не соответствует требованию к привилегированному аудиту.
6. **Версия PostgreSQL зависит от окружения.** DB и service specs сохраняют PG16 как проектный baseline; local Compose использует PG17, production-версия не зафиксирована. Документы теперь явно различают эти значения.
7. **Delivery-инструменты частично реализованы.** В репозитории есть Dockerfile приложений, CI/workflows, генератор proto и Helm charts. Готовый mock server и отдельный OpenAPI client generator не обнаружены; contract checker проверяет полноту REST/gRPC mapping по operationId, но не семантическую корректность каждой связи. Наличие манифестов не подтверждает проверенный production deployment.
8. **Auth-email расходится с ADR-010.** User Service отправляет verification/reset письма напрямую через SMTP mailer; вызов Notification Service по gRPC и `auth_email_jobs` не обнаружены. При этом Notification Service также отправляет email для notification deliveries.
9. **Telegram webhook не реализован.** Есть API привязки Telegram и отправка сообщений из delivery worker, но отдельный входящий Bot/webhook route не обнаружен; локальный webhook в P0 runbook является плановым.
10. **Импорт заменяет содержимое выбранной диаграммы.** Это уже поведение кода, хотя ADR-011 не оформлен как принятое решение. В P0-матрице и ADR следует различать реализованное поведение и формально согласованное продуктовое решение.
11. **Однофайловая постановка Ганта — legacy.** `docs/requirements/system/SMART_OATI_диаграмма_Ганта_системная_постановка.md` описывает HTML/localStorage приложение без сервера; текущий серверный проект находится в `apps/`.

## Автоматические проверки контрактов

`pnpm test:contract` запускает `tools/check-contracts.mjs`. Скрипт фиксирует счётчики OpenAPI (76/99), событий (68), payload definitions (79), proto (6) и шаблонов; проверяет соответствие REST operationId и mapping с двумя явными gateway-исключениями. Он не доказывает семантическую корректность каждой mapping-связи, соответствие всех требований или готовность production.

Другие доступные команды: `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm format:check`, `pnpm local:health`.
