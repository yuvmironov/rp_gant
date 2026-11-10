# P0: пакет документов и артефактов
## «Диаграмма Ганта — проект SMART OATI»

**Версия пакета:** 1.3  
**Дата:** 2026-10-28

Пакет закрывает контрактные блокеры и фиксирует минимальный delivery-контур для старта разработки.

| Документ | Содержание |
|----------|------------|
| `01_DDL_и_миграции.md` | Схемы БД, миграции, seed, триггеры, retention |
| `02_Контракт_событий.md` | EventEnvelope, каталог событий, producers/consumers |
| `03_WebSocket_контракт.md` | AsyncAPI, сообщения, reconnect, close-Коды |
| `04_Глобальные_роли.md` | `SetUserGlobalRoles`, защита последнего администратора |
| `05_Notification_шаблоны_и_матрица.md` | Шаблоны и матрица уведомлений |
| `06_Audit_каталог_действий.md` | Action codes, маппинг, privileged journal |
| `07_REST_gRPC_mapping.md` | OpenAPI → gRPC, тесты |
| `08_Proto_сборка_и_кодогенерация.md` | Buf, валидация, JS-клиенты |
| `09_Эксплуатация_и_безопасность.md` | Домены, CORS, secrets, Kubernetes, SLO |
| `10_План_тестирования.md` | Contract, integration, load, failure |
| `11_Полные_payload_событий.md` | Все 64 payload-схемы событий |
| `12_Формат_импорта_экспорта.md` | JSON/CSV v2 и legacy v9/v1 |
| `13_Local_Development_Runbook.md` | Локальный запуск, Docker Compose, HTTPS, Kafka, dev-admin |
| `14_MVP_Scope_and_Backlog.md` | Границы MVP, epics, user stories, acceptance criteria, DoR/DoD |
| `15_ADR_Package.md` | ADR по брокеру, REST/gRPC, БД, сессиям, SSR, outbox и правам |
| `16_Authorization_Matrix.md` | Единая матрица глобальных/проектных прав, UI-маршруты, enforcement |
| `17_Engineering_Handbook.md` | Структура repo, стиль, review, тесты, безопасность разработки |
| `18_CI_CD_and_Environments.md` | GitHub Actions, GHCR, Yandex Managed Kubernetes, миграции, rollback, Vault |
| `19_API_Conventions_and_Error_Catalog.md` | REST-конвенции, RFC 7807, idempotency, concurrency, error codes |
| `20_Messaging_Operations.md` | Kafka topic, partitions, outbox/inbox, retry, DLQ, replay |
| `21_Test_Data_and_Contract_Mocks.md` | Seed, fixtures, mock server, contract/E2E/load данные |

## Открытые блокеры

- **PLAT-08:** `owner.transfer` и `diagram.*` добавлены в seed; осталось реализовать active-user проверку `project.create` и permission-check в сервисах.
- **ADR-011:** не решено, импорт заменяет диаграмму или создает новую.
- **Sync docs:** план 1.6 еще упоминает NATS/RabbitMQ и Redis-сессии; привести к ADR-001/004/008/010.
- **PLAT-02/03:** Compose, CI, security и images workflows, Helm service template созданы; не хватает Dockerfile приложений, deploy workflows и конкретных Helm-чартов.
- **PLAT-04/07:** нет codegen и mock server; contract structure check уже есть.

## Реализационные артефакты

```text
D:\ОАТИ\Ганты\Исходные кодв
  db/
    migrations/
      user_access/
      project_diagram/
      notification/
      audit/
    seeds/
      user_access/
      audit/
  events/
    asyncapi.yaml
    event-types.json
    schemas/
  sync/
    asyncapi.yaml
    schemas/
  notifications/
    asyncapi.yaml
    schemas/
    templates/
  contracts/
    rest-grpc-map.yaml
    import-export/
  proto/
    buf.yaml
  infrastructure/
    local/
  openapi/
    openapi.json
    openapi.yaml
```

## Границы

- P0 закрывает блокеры для старта разработки.
- Полные бизнес-сценарии frontend, UI и production-эксплуатация остаются отдельными этапами.
- Секреты и реальные домены не входят в репозиторий.





