# P0: Staging deployment и приёмка

**Статус:** подготовительный runbook; staging rollout не выполнен.  
**Связанные документы:** [`18_CI_CD_and_Environments.md`](18_CI_CD_and_Environments.md), [`20_Messaging_Operations.md`](20_Messaging_Operations.md), [`IMPLEMENTATION-STATUS.md`](../../../IMPLEMENTATION-STATUS.md).

Этот runbook задаёт последовательность первого staging rollout после утверждения конфигурации окружения, появления Vault secrets и отдельного разрешения на rollout. Не копировать production credentials в staging и не хранить DSN/secret values в Git, Helm values, выводе CI или логах.

## 1. Gate перед rollout

Rollout запрещён, пока не подтверждены все пункты:

- [ ] Приняты staging cluster/namespace, VPC, Managed PostgreSQL, Managed Kafka, DNS/TLS и image digest для каждого сервиса. Подставлены реальные домены и сертификаты вместо placeholder в `values-staging.yaml`.
- [ ] Доступны staging-only Vault records и healthy External Secrets Store; remote key для Sync зафиксирован в staging values. На первом install Kubernetes Secrets могут появиться только после создания ExternalSecret этим Helm release.
- [ ] Vault record `rp-gant/staging/sync-service` содержит property `token` и DSN property `database_url` для отдельной БД `rp_gant_sync` с TLS-параметрами, требуемыми Managed PostgreSQL, а также properties для Sync Kafka principal.
- [ ] Версия staging Managed PostgreSQL утверждена и совместима с migration image (`postgres:17-alpine` client); Secret `platform-database` даёт migration job минимально необходимые права для создания/обновления пяти БД. Секреты не выводились в CI.
- [ ] Для каждого Kafka client в staging values задан приватный Managed Kafka bootstrap endpoint (не `kafka:9092`); canonical topic — `rp_gant.events`, плюс service DLQ/replay topics, включая `rp_gant.events.dlq.sync` и `rp_gant.events.replay.sync`.
- [ ] Для каждого Kafka principal подготовлен отдельный staging credential Secret с ACL по роли сервиса; секреты не разделяются между service accounts. Staging values ожидают Vault records `rp-gant/staging/<service>` с `kafka_sasl_username`, `kafka_sasl_password` и, если нужен провайдеру, `kafka_ca_pem`.
- [ ] Провайдер подтверждает `scram-sha-512` (сейчас staging overlay default) либо оператор меняет `kafkaSecurity.saslMechanism` на согласованный механизм до render. Все Kafka clients используют TLS с certificate verification; render без bootstrap endpoint запрещён.
- [ ] Сделан проверенный backup staging DB перед миграциями; назначен оператор, ответственный за rollback/forward-fix.
- [ ] `helm lint` и `helm template` проверены на тех же staging values и immutable digest для всех 7 приложений плюс `db-migrate`, которые будут использованы при rollout. `imagePolicy.requireDigests` запрещает render без sha256 digest.

После ESO sync проверка наличия ключей Secret не должна печатать значения:

```bash
kubectl -n smart-oati get secret rp-gant-sync -o json \
  | jq -e '.data | has("token") and has("DATABASE_URL_SYNC") and has("username") and has("password")' >/dev/null
```

## 2. Порядок rollout

1. Сверить Kubernetes context и namespace `smart-oati`; сверить digest образов с успешным CI build.
2. Проверить, что ExternalSecret resources Sync Ready, затем проверить ключи целевых Secrets без вывода значений. На первом install `helm upgrade --wait` ждёт ESO reconciliation и старта pod; не передавать значения через `--set`.
3. Сделать/проверить backup staging БД.
4. Запустить umbrella Helm upgrade с принятыми staging values и immutable image digests, используя `--atomic --wait --timeout`. Не включать `--reuse-values`, если нельзя показать итоговые values без секретов.
5. Дождаться успешного pre-upgrade Job `rp-gant-db-migrate`. Job должен получить `SYNC_DB=rp_gant_sync`, создать базу при необходимости и применить `db/migrations/sync/0001_sync.sql`.
6. Дождаться rollout всех Deployments и Ready status Sync pod.
7. При ошибке миграции или readiness остановить приёмку: не повторять rollout вручную до анализа логов Job и состояния схемы.

Команды upgrade намеренно не приведены с фиктивными release values или credentials: конкретные release name, chart dependencies, image digests и Vault path берутся из утверждённой конфигурации окружения.

## 3. Staging acceptance

### База и secret wiring

- [ ] Sync Deployment получает `DATABASE_URL_SYNC` из `rp-gant-sync`, а не из ConfigMap или plaintext values.
- [ ] User, Project, Audit, Notification и Sync Kafka clients используют только свои staging principals; producer/consumer ACL ограничены нужными topics/groups, TLS certificate verification включён.
- [ ] `rp_gant_sync.events.processed_events` существует; доступ приложения ограничен необходимыми правами.
- [ ] Migration Job успешно завершился для всех пяти БД.

### Runtime и replay

- [ ] `/health/live` и `/health/ready` Sync отвечают 200 изнутри кластера; API Gateway `/api/v1/health` отвечает 200 через staging ingress.
- [ ] `wss://api.staging.<approved-domain>/ws` маршрутизируется на Sync, а `https://api.staging.<approved-domain>/` — на API Gateway; TLS и WebSocket upgrade handshake проверены с внешней staging сети.
- [ ] Через staging test account создать/изменить тестовую диаграмму; получить связанный `event_id` и проверить единственную запись `(consumer='sync', event_id)` в `rp_gant_sync.events.processed_events`.
- [ ] Проверить доставку `diagram.changed` тестовому WebSocket client и отсутствие секретов/token в логах.
- [ ] На синтетическом staging event проверить bounded retry и попадание в Sync DLQ; не создавать отказ реальной пользовательской операции.
- [ ] Выполнить DLQ replay сначала в dry-run, затем только после сверки `event_id` и подтверждения оператора. Убедиться, что marker не дублируется и побочный эффект не повторяется.
- [ ] Проверить consumer lag, `events_processed_total`, `events_failed_total`, `dlq_messages_total`, метрики outbox и отсутствие роста 5xx в течение минимум 5 минут.
- [ ] Подтвердить в брокере отсутствие SASL/TLS authentication errors и проверить, что replay CLI использует тот же staging credential/TLS config.
- [ ] Проверить auth-email end-to-end через staging SMTP с контролируемым тестовым адресом, включая статус/повторную доставку.

Для Sync в одной транзакции фиксируются processed-event marker и результат broadcast. При повторной доставке/replay того же `event_id` marker не вставляется повторно, и broadcast повторно не отправляется.

### Backup и rollback

- [ ] Проверить читаемость backup и пройти согласованный staging restore drill (в изолированном целевом экземпляре).
- [ ] Проверить процедуру Helm rollback приложения на предыдущие immutable digests.
- [ ] Не выполнять down migration при rollback приложения: миграция БД откатывается forward-fix по одобренному плану.
- [ ] После rollback повторить health, Sync marker и метрики smoke checks.

## 4. Stop conditions

Немедленно остановить rollout/приёмку, если отсутствует secret/ExternalSecret, миграционный Job завершился ошибкой, Sync readiness не наступила, replay нарушает идемпотентность, 5xx/DLQ/consumer lag растут либо тестовая почта отправилась не на контролируемый адрес. Сохранить логи без secret values и перейти к согласованному forward-fix/rollback.

Локальные E2E, restore drill и Helm render проверки являются предварительными и не заменяют staging acceptance. Production rollout в рамках этого runbook не разрешается.
