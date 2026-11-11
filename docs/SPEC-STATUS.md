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
- REST/gRPC mapping: `contracts/rest-grpc-map.yaml`.
- В mapping 97 записей. Gateway-managed операции `health` и `getSyncToken` явно исключены; `pnpm test:contract` проверяет все остальные operationId и отсутствие устаревших mapping-ключей.
- Contract checker проверяет полноту REST/gRPC mapping по operationId с двумя gateway-managed исключениями; он не доказывает семантическую корректность каждой связи.

## События Kafka

- Каталог: `events/event-types.json`.
- Всего событий: **68**.
- `status: implemented` — **30** событий, помеченных как реализованные в каталоге.
- `status: planned` — **38** событий, зарезервированных в каталоге.
- Реальная схема envelope и producers используют snake_case. Количество событий (68) не равно числу payload definitions (79 в `payloads.schema.json`).
- `events/asyncapi.yaml` описывает общий канал; статусы событий указаны в каталоге.

## WebSocket sync

- `sync-service` реализует `/ws?token=...`; токен выдаёт `GET /api/v1/sync/token`.
- Project scope берётся из claims токена; отдельные subscribe/unsubscribe сообщения не используются.
- `SYNC_TOKEN_SECRET` обязателен вне local/development/test; локальный Compose явно задаёт development-only секрет, а placeholder `CHANGE_ME_RANDOM_HEX` отклоняется вне local.
- Сервер отправляет `connected`, `diagram.changed`, `pong` и `error`.
- Спецификация: `sync/asyncapi.yaml`.

## Уведомления

- `notification-service` обрабатывает Kafka-события и предоставляет внутренний HTTP API; публичные маршруты проходят через API Gateway.
- WebSocket `/ws/notifications` **не реализован**; контракт `notifications/asyncapi.yaml` имеет статус planned.
- Фронтенд загружает уведомления через REST API.

## Проверки

`pnpm test:contract` проверяет заявленные счётчики OpenAPI/events/proto и наличие артефактов. Он не заменяет проверку REST/gRPC mapping, системных требований или runtime-поведения. См. [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md).

```bash
pnpm test:contract
pnpm lint
pnpm format:check
npx --yes @redocly/cli@latest lint openapi/openapi.yaml
```
