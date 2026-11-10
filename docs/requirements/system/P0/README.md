# P0: пакет документов и артефактов
## «Диаграмма Ганта — проект SMART OATI»

**Версия пакета:** 1.3  
**Дата исходного пакета:** 2026-10-28<br>
**Статус:** пакет проектных требований; не является отчётом о фактической реализации.

Фактическое состояние кода и инфраструктуры ведётся отдельно в [`docs/IMPLEMENTATION-STATUS.md`](../../../IMPLEMENTATION-STATUS.md), актуальность контрактов — в [`docs/SPEC-STATUS.md`](../../../SPEC-STATUS.md). Описания ниже сохраняют целевые требования; проверяйте их статус перед использованием как инструкции.

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
| `11_Полные_payload_событий.md` | Проектный снимок payload-контрактов; актуальный каталог и число схем см. в `events/` и `docs/SPEC-STATUS.md` |
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

## Статус реализации и открытые вопросы

Пункты ниже — результат сверки с репозиторием на 2026-11-10; источники и подробности приведены в [`docs/IMPLEMENTATION-STATUS.md`](../../../IMPLEMENTATION-STATUS.md).

- **PLAT-08 / Authorization:** проверки `CheckProjectPermission` в User Service/Project Service и active-user validation владельца в `EnsureProjectOwner` присутствуют в коде (`apps/user-service/src/auth.js`, `apps/project-service/src/projects.js`). Пункт из исходного списка блокеров закрыт по наличию реализации; прогоните unit/integration tests перед release.
- **ADR-011 / import:** текущая реализация импортирует в переданную диаграмму и заменяет её содержимое в транзакции; preview откатывает транзакцию. Поведение кода зафиксировано, но формальное продуктовое решение ADR-011 не оформлено.
- **Sync:** требования этого пакета про cookie, subscribe/backfill и notification WebSocket не совпадают с реализованным контрактом. Для текущей интеграции используйте `sync/asyncapi.yaml`; `/ws/notifications` не реализован.
- **Local/CI/packaging:** Dockerfile приложений, local Compose, CI workflows и Helm charts в репозитории присутствуют. Их наличие не подтверждает успешный production deployment.
- **PLAT-04/07:** генератор proto `tools/generate-proto.ps1` и contract structure check есть; отдельный OpenAPI client generator, готовый mock server и проверка полноты REST/gRPC mapping не обнаружены. Mapping содержит 97 записей для 99 OpenAPI operations; gateway-managed `health` и `getSyncToken` не маппятся на gRPC.
- **Kafka:** Compose задаёт `rp_gant.events`, но fallback publishers/consumers — `rpgant.events`; Compose передаёт `KAFKA_TOPIC`, прямые запуски без переменной могут использовать другой topic.
- **ADR-010 / auth-email:** User Service отправляет verification/reset письма напрямую через свой SMTP mailer; предусмотренный ADR вызов Notification Service по gRPC и `auth_email_jobs` не обнаружены.

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

- P0 описывает проектные требования и критерии, а не автоматически подтверждённую реализацию.
- Полные бизнес-сценарии frontend, UI и production-эксплуатация требуют проверки отдельно.
- Секреты и реальные домены не входят в репозиторий.





