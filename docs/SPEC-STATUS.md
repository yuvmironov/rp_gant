# Состояние спецификаций

Документ фиксирует состояние контрактов, а не полную готовность продукта. **Проверено:** 2026-11-11. Сводка кода и инфраструктуры: [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md). Проверенные расхождения между требованиями и реализацией перечислены там отдельно.

## REST API

- Источник: `apps/api-gateway/src/*.js`.
- Спецификации: `openapi/openapi.json` и `openapi/openapi.yaml`.
- Проверено: **76 paths, 99 operations**.
- Покрыты все фактические маршруты API Gateway, включая `/health`, `/settings`, `/sync/token`, контакты и Telegram, а также административные маршруты `/admin/users/*`.
- Параметры путей используют формат `{id}`.

## gRPC

- Контракты: `proto/rpgant/**`.
- 6 proto-файлов: UserService, ProjectService, NotificationService, AuditService, common и events.
- `ListAccessibleProjectIdsResponse.is_admin` явно передаёт глобальный `app_admin` flag; Project Service использует его для чтения всех проектов из собственной БД без cross-service SQL (ADR-008).
- REST/gRPC mapping: `contracts/rest-grpc-map.yaml`.
- В mapping 97 записей. Gateway-managed операции `health` и `getSyncToken` явно исключены; `pnpm test:contract` проверяет все остальные operationId и отсутствие устаревших mapping-ключей.
- Contract checker проверяет полноту REST/gRPC mapping по operationId с двумя gateway-managed исключениями; он не доказывает семантическую корректность каждой связи.

## События Kafka

- Каталог: `events/event-types.json`.
- Всего событий: **68**.
- `status: implemented` — **30** событий, помеченных как реализованные в каталоге.
- `status: planned` — **38** событий, зарезервированных в каталоге.
- Реальная схема envelope и producers используют snake_case; User/Project outbox producers передают role snapshot в `actor_roles`. Количество событий (68) не равно числу payload definitions (79 в `payloads.schema.json`).
- `events/asyncapi.yaml` описывает общий канал; статусы событий указаны в каталоге.
- Runtime retry/DLQ и manual replay — operational behavior из `docs/requirements/system/P0/20_Messaging_Operations.md`; они не меняют envelope/AsyncAPI контракт. Managed Kafka TLS/SASL конфигурируется вне контракта, staging acceptance ещё не выполнена.

## WebSocket sync

- `sync-service` реализует `/ws?token=...`; токен выдаёт `GET /api/v1/sync/token`.
- Project scope берётся из claims токена; отдельные subscribe/unsubscribe сообщения не используются.
- `SYNC_TOKEN_SECRET` обязателен вне local/development/test; локальный Compose явно задаёт development-only секрет, а placeholder `CHANGE_ME_RANDOM_HEX` отклоняется вне local.
- Сервер отправляет `connected`, `diagram.changed`, `pong` и `error`.
- Sync consumer записывает `event_id` в `rp_gant_sync.events.processed_events` в одной транзакции с broadcast; replay получает отдельный `.replay.sync` topic и пропускает уже обработанные IDs.
- Спецификация протокола: `sync/asyncapi.yaml`; replay/deduplication — runtime operations, а не новые WebSocket-сообщения.
- Helm staging values подготовлены для `DATABASE_URL_SYNC` и Sync migration; реальный staging rollout/acceptance не проводились.

## Уведомления

- `notification-service` обрабатывает Kafka-события и предоставляет внутренний HTTP API; публичные маршруты проходят через API Gateway.
- WebSocket `/ws/notifications` **не реализован**; контракт `notifications/asyncapi.yaml` имеет статус planned.
- Фронтенд загружает уведомления через REST API.
- Auth-письма передаются User Service в Notification Service через gRPC `SendAuthEmail`; `job_id` обеспечивает идемпотентную постановку в delivery queue. Доставка/статус доступны через `GetAuthEmailStatus`; staging acceptance не выполнена.

## Проверки

`pnpm test:contract` проверяет заявленные счётчики OpenAPI/events/proto и наличие артефактов. Он не заменяет проверку REST/gRPC mapping, системных требований или runtime-поведения. См. [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md).

```bash
pnpm test:contract
pnpm lint
pnpm format:check
npx --yes @redocly/cli@latest lint openapi/openapi.yaml
```
