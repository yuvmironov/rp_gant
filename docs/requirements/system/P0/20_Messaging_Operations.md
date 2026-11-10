# P0: Messaging Operations
## SMART OATI

**Версия:** 1.0  
**Дата исходного документа:** 2026-10-28
**Статус:** проектный baseline; текущие настройки и расхождения см. `docs/IMPLEMENTATION-STATUS.md`.
**Область:** Kafka, topics, partitions, outbox/inbox, retry, DLQ, schema compatibility, replay и monitoring  
**Связанные документы:** `P0/02_Контракт_событий.md`, `P0/11_Полные_payload_событий.md`, `P0/15_ADR_Package.md` (ADR-001, ADR-006)

---

## 1. Решение

> В local Compose topic — `rp_gant.events`; приложения имеют fallback `rpgant.events`, если `KAFKA_TOPIC` не задан. Compose задаёт переменную. DLQ-топики ниже описаны как операционная цель и не создаются текущим local init автоматически.

- Целевой брокер по ADR-001: **Kafka** во всех окружениях.
- Local: Kafka KRaft (используется в Compose).
- Staging/prod: Yandex Managed Kafka — целевой вариант; развёртывание не подтверждено репозиторием.
- Local Compose: один topic `rp_gant.events`.
- Маршрутизация по фактическому envelope-полю `event_type`; consumers фильтруют свои типы.
- Разделение на domain topics — только после доказанной необходимости и ADR.

---

## 2. Topic

| Параметр | Local | Staging/prod |
|---|---|---|
| Topic | `rp_gant.events` | `rp_gant.events` |
| Partitions | 6 | ≥ 6, по нагрузке |
| Replication factor | 1 | ≥ 3 |
| Min in-sync replicas | 1 | 2 |
| Retention | 7 дней | 30 дней |
| Cleanup policy | delete | delete |
| Compression | lz4 | lz4 |
| Key | `projectId` или `userId` | то же |

DLQ/error topics:

```text
rp_gant.events.dlq.notification
rp_gant.events.dlq.audit
rp_gant.events.dlq.sync
```

---

## 3. EventEnvelope

Обязательные поля:

- `eventId` — UUID;
- `eventType`;
- `schemaVersion`;
- `occurredAt` — RFC 3339 UTC;
- `sourceService`;
- `payload`.

Дополнительные:

- `actorUserId`;
- `actorRoles`;
- `projectId`;
- `diagramId`;
- `entityType`;
- `entityId`;
- `requestId`;
- `correlationId`.

Partition key:

- проектные события — `projectId`;
- пользовательские/auth — `userId`;
- системные без агрегата — `eventId`.

---

## 4. Outbox

- Бизнес-изменение и outbox-запись — в одной транзакции.
- Outbox relay читает неопубликованные записи батчами.
- Публикация — с `acks=all`, идемпотентный producer.
- После успешной публикации — `published_at`.
- Ошибка — `retry_count`, backoff.
- После лимита — alert и DLQ/ручное вмешательство.
- Relay не блокирует HTTP/gRPC-запрос.

Минимальные поля outbox:

- `id`;
- `event_id`;
- `event_type`;
- `payload`;
- `partition_key`;
- `created_at`;
- `published_at`;
- `retry_count`;
- `last_error`.

---

## 5. Inbox и идемпотентность

- Consumer хранит `eventId` в inbox/processed table.
- Повторная доставка не меняет состояние.
- Обработка и запись результата — в одной транзакции.
- Для внешних эффектов (email/Telegram) — отдельный job/idempotency key.
- Порядок гарантируется только в пределах partition key.

---

## 6. Retry и DLQ

- Retry: 1, 2, 5, 10, 30 секунд; далее — DLQ.
- Retry не блокирует partition бесконечно.
- DLQ содержит envelope + error metadata.
- Replay из DLQ — только вручную и идемпотентно.
- Для poison message — alert и остановка consumer group при необходимости.
- Max delivery attempts: 5.

---

## 7. Schema compatibility

- JSON Schema в `events/` и `notifications/`.
- `schemaVersion` — целое.
- Совместимые изменения: добавление optional-поля.
- Несовместимые: удаление/переименование/смена типа — новый `eventType` или major version.
- Contract tests проверяют producer payload против схемы.
- Schema registry в MVP не обязателен; CI-проверка обязательна.
- `eventType` не меняет смысл; новый смысл — новый тип.

---

## 8. Consumer groups

| Consumer | Group | Что делает |
|---|---|---|
| Notification | `notification` | auth emails, in-app, email, Telegram |
| Audit | `audit` | общий и privileged journal |
| Sync | `sync` | realtime-события для WS |
| Project | `project` | реакции на user/membership (если нужны) |

Правила:

- один consumer group на сервис;
- offset commit — после успешной обработки;
- lag мониторится;
- consumer не читает чужие topic без ADR.

---

## 9. Replay

- Replay по offset/time для конкретной consumer group.
- Перед replay — остановить consumer или использовать отдельную group.
- Replay идемпотентен.
- Audit replay не должен создавать дубли.
- Notification replay не должен повторно отправлять письма без проверки job.
- Replay — только через runbook и с approval.

---

## 10. Security

- TLS/SASL для managed Kafka.
- ACL: producer пишет только свои event types; consumer читает только свой topic/group.
- Service credentials — Vault.
- Не логировать payload с PII.
- `actorRoles` обязательны для действий пользователя.
- Internal topics не публикуются.

---

## 11. Monitoring

Алерты:

- consumer lag > 5 минут;
- outbox backlog > 1000;
- DLQ > 0;
- publish errors > 0;
- retry_count > 3;
- schema validation errors;
- rebalance storm;
- broker under-replicated partitions.

Метрики:

- `kafka_consumer_lag`;
- `outbox_pending`;
- `outbox_publish_errors`;
- `events_processed_total`;
- `events_failed_total`;
- `dlq_size`;
- `event_processing_duration`.

---

## 12. Runbook

### DLQ

1. Проверить eventId, eventType, payload, error.
2. Определить причину: schema, права, БД, внешний сервис.
3. Исправить причину.
4. Replay вручную.
5. Проверить отсутствие дублей.
6. Записать инцидент.

### Outbox backlog

1. Проверить Kafka health.
2. Проверить relay.
3. Проверить `retry_count`.
4. Не удалять outbox-записи вручную.
5. После восстановления — дождаться публикации.

---

## 13. Критерии приемки

1. Один topic и стабильный envelope.
2. Все события из актуального `events/event-types.json` проходят schema validation; число типов не задаётся в тексте критерия.
3. Outbox/inbox реализованы.
4. Retry/DLQ работают.
5. Replay идемпотентен.
6. Lag/DLQ/outbox алерты есть.
7. ACL и TLS настроены.
8. Contract tests и integration tests проходят.
