# Helm service template

Универсальный Helm-чарт для сервисов RP Gant. Используется как основа для `api-gateway`, `user-service`, `project-service`, `notification-service`, `audit-service`, `sync-service` и `frontend`.

## Что внутри

- Deployment со стратегией RollingUpdate.
- Service.
- ServiceAccount.
- HPA (опционально).
- PDB.
- Ingress (опционально, `yandex-alb`).
- NetworkPolicy (опционально).
- Probes `/health/live` и `/health/ready`.
- Security context non-root.
- Resource requests/limits.

## Как использовать

1. Скопировать `service-template` в отдельный чарт сервиса.
2. Заменить `Chart.yaml` и `values.yaml`.
3. Указать image digest из GHCR.
4. Настроить env/envFrom и Vault/External Secrets.
5. Включить ingress только для frontend/API/Sync/Notification.
6. Проверить `helm template`.

## Пример

```bash
helm template api-gateway ./service-template \
  --namespace rp-gant \
  --set image.repository=ghcr.io/org/rp-gant/api-gateway \
  --set image.digest=sha256:... \
  --set replicaCount=2
```

## API Gateway

Чарт `infrastructure/helm/api-gateway` собран из `service-template` и содержит:

- image `ghcr.io/yuvmironov/rp-gant/api-gateway`;
- 2 реплики;
- HPA 2–6;
- PDB;
- probes `/health/live` и `/health/ready`;
- Yandex ALB ingress для `api.rp-gant.example.com`;
- non-root UID 10001.

Проверка:

```bash
helm lint infrastructure/helm/api-gateway
helm template api-gateway infrastructure/helm/api-gateway
```

## Проверено

- Helm `v4.3.1`.
- Kubernetes `v1.36.1` (Docker Desktop).
- `helm lint` — 0 ошибок.
- `helm template` — успешно.
- `helm install --dry-run=server` — успешно.
- Runtime install с тестовым образом `nginxinc/nginx-unprivileged:1.27-alpine`: 2/2 pod Running, HTTP 200, PDB и Service созданы.
- Тестовый release и namespace удалены.

## Staging values и Sync

`infrastructure/helm/rp-gant/values-staging.yaml` содержит только secret references, не значения секретов. Vault records задаются отдельно для каждого сервиса (`rp-gant/staging/<service>`), Sync connection string — property `database_url` в `rp-gant/staging/sync-service`; External Secrets создаёт target Secret `rp-gant-sync` с `token`, `DATABASE_URL_SYNC` и Sync Kafka credentials.

Staging overlay включает Sync DB/migration, canonical topic `rp_gant.events`, TLS/SASL с per-service principals и ingress `/ws` на Sync. Он намеренно оставляет bootstrap endpoint пустым: перед render нужно задать приватные Managed Kafka endpoints, подтвердить SASL mechanism и заменить placeholder DNS/TLS. `imagePolicy.requireDigests` блокирует render без sha256 digest для семи приложений и `db-migrate`.

CI job `helm-templates` собирает umbrella dependencies, lint-ит charts и проверяет staging/production render. Production Sync DB и Kafka SASL остаются opt-out до отдельной приёмки. Наличие values и успешный render не означают, что staging развёрнут: реальные Vault records, ACL, broker, DNS/certificate и runtime acceptance ещё нужны.

## Правила

- В values нет секретов.
- В production — только digest, не tag.
- Не включать `latest`.
- NetworkPolicy включается после настройки правил.
- PDB обязателен для production.
- Ingress для внутренних gRPC не создается.
