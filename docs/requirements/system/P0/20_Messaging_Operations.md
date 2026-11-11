# P0: Messaging Operations
## SMART OATI

**Версия:** 1.0  
**Дата исходного документа:** 2026-10-28
**Статус:** проектный baseline; текущие настройки и расхождения см. `docs/IMPLEMENTATION-STATUS.md`.
**Область:** Kafka, topics, partitions, outbox/inbox, retry, DLQ, schema compatibility, replay и monitoring  
**Связанные документы:** `P0/02_Контракт_событий.md`, `P0/11_Полные_payload_событий.md`, `P0/15_ADR_Package.md` (ADR-001, ADR-006)

---

## 1. Решение

> Local Compose и service-kit fallback используют canonical topic `rp_gant.events`; Helm staging values также явно задают его всем Kafka-клиентам. `kafka-init` создаёт DLQ и consumer-specific replay topics. Legacy non-staging Helm values сохраняют прежний topic до отдельной приёмки.

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

- Retry: паузы 1, 2, 5, 10 секунд перед повторными доставками; максимум 5 доставок всего (первая попытка + 4 retry), затем — DLQ.
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

- DLQ record выбирается вручную по topic/partition/offset для конкретной consumer group.
- Replay публикуется только в изолированный `.replay.<service>` topic; прямой replay в общий source topic запрещён.
- Прямой offset/time replay требует остановить consumer group или использовать отдельную group.
- Replay идемпотентен.
- Audit replay не должен создавать дубли.
- Notification replay не должен повторно отправлять письма без проверки job.
- Replay — только через runbook и с approval.
- Replay должен быть изолирован по consumer group: повторная публикация в исходный общий topic снова запустит все группы.

Локальная реализация:

- `pnpm dlq:replay -- --service audit|notification|sync --file <dlq-value.json>` выполняет dry-run и не подключается к Kafka.
- Применение требует `--apply --confirm <точный event_id>` после отдельного approval; сообщение идёт в consumer-specific `.replay.<service>` topic.
- Sync replay разрешён через отдельную БД `rp_gant_sync`: processed-event insert и broadcast выполняются в одной транзакции.
- Файл DLQ value содержит исходный envelope; обращайтесь с ним как с данными приложения и не прикладывайте к общедоступным тикетам.

---

## 10. Security

- TLS/SASL для managed Kafka. Все publishers, consumers и DLQ replay используют общий `getKafkaConnectionOptions` из service-kit.
- `KAFKA_SSL=true` включает проверку сертификата; доверенный CA можно передать как `KAFKA_SSL_CA` или через `KAFKA_SSL_CA_FILE`.
- `KAFKA_SASL_MECHANISM` поддерживает `plain`, `scram-sha-256` и `scram-sha-512`; наличие SASL credentials без TLS приводит к ошибке конфигурации.
- Helm включает Kafka security только через `kafkaSecurity.enabled`; staging создаёт отдельный Vault-backed Kubernetes Secret для каждого service principal.
- ACL: producer пишет только свои event types; consumer читает только свой topic/group.
- Service credentials — Vault; значения credentials никогда не передаются в Helm values и не логируются.
- Local defaults остаются без TLS/SASL для локального Kafka KRaft.
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
- `outbox_events_retry_count_gt_3` — число unpublished событий с `retry_count > 3`;
- `events_processed_total`;
- `events_failed_total`;
- `dlq_size`;
- `event_processing_duration`;
- `event_processing_lag_seconds` — наблюдаемый возраст event по `occurred_at` в момент завершения обработки.

Локальный alert на возраст старше 5 минут срабатывает по обработанным событиям; timestamp самого старого неподтверждённого Kafka offset Exporter не предоставляет, для остановившегося consumer остаётся alert по ненулевому message-count lag.

---

## 12. Runbook

### DLQ

1. Проверить eventId, eventType, payload, error.
2. Определить причину: schema, права, БД, внешний сервис.
3. Исправить причину.
4. Replay вручную.
5. Проверить отсутствие дублей.
6. Записать инцидент.
7. Для Audit/Notification/Sync экспортировать value одной DLQ-записи в защищённый временный файл; не публиковать envelope в тикетах.
8. Запустить dry-run `pnpm dlq:replay -- --service audit|notification|sync --file <file>` и сверить event_id, consumer и source offset.
9. После отдельного approval повторить с `--apply --confirm <event_id>`; инструмент публикует только в соответствующий replay topic.
10. Проверить результат и alert/DLQ size, затем удалить временный файл согласно локальной политике хранения.
11. Для Sync сверить `event_id` в `rp_gant_sync.events.processed_events`; marker записывается транзакционно с broadcast.

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
