# P0: CI/CD и окружения
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28  
**Статус:** draft for approval  
**Область:** GitHub Actions, артефакты, Yandex Cloud Kubernetes, managed PostgreSQL/Kafka, Vault, миграции, rollback и smoke-проверки  
**Связанные документы:** `P0/13_Local_Development_Runbook.md`, `P0/17_Engineering_Handbook.md`, `P0/09_Эксплуатация_и_безопасность.md`

---

## 0. Принятые решения

| Решение | Значение |
|---|---|
| Cloud/K8s | Yandex Cloud, Managed Service for Kubernetes, `ru-central1-a` |
| Кластеры | Отдельные managed-кластеры для staging и production |
| PostgreSQL | Yandex Managed PostgreSQL |
| Kafka | Yandex Cloud Managed Kafka |
| Ingress | Yandex Application Load Balancer |
| Домены | Placeholder: `app.example.com`, `api.example.com`, `staging.app.example.com` |
| WAF | Не входит в MVP; rate limit на API Gateway, WAF — после пилота |
| Secrets | HashiCorp Vault на одной VM + External Secrets Operator |
| Registry | GHCR |
| Rollout | Kubernetes RollingUpdate + PDB/readiness |
| CI | GitHub Actions |
| Production approval | Архитектор + DevOps |

---

## 1. Окружения

| Окружение | Назначение | Платформа | БД | Брокер |
|---|---|---|---|---|
| local | Разработка | Docker Compose | PostgreSQL latest | Kafka KRaft |
| CI | Проверки PR | GitHub-hosted runner + Testcontainers | Pinned PostgreSQL | Testcontainers Kafka |
| staging | Приемка и пилот | Yandex Managed Kubernetes, `ru-central1-a` | Yandex Managed PostgreSQL | Yandex Managed Kafka |
| production | Промышленная эксплуатация | Yandex Managed Kubernetes, `ru-central1-a` | Yandex Managed PostgreSQL | Yandex Managed Kafka |

Правила:

- staging и production — отдельные namespaces, кластеры/БД и секреты.
- production deploy — только с ручным approval.
- staging обновляется автоматически после merge в `main`.
- Образы в production — immutable digest.
- Локальный `latest` не переносится в production.
- Managed PostgreSQL/Kafka не публикуются в интернет; доступ только из VPC/кластера.
- Vault — источник секретов; Helm values не содержат секретов.
- Rollout — RollingUpdate; canary/blue-green не используем в MVP.

---

## 2. GitHub repository settings

### 2.1. Branch protection `main`

- Require pull request before merge.
- Require approvals: 1; для `contracts/`, `proto/`, `db/`, auth — 2.
- Require status checks:
  - `ci-required`;
  - `contracts-required`;
  - `security-required`.
- Require branches up to date.
- Require conversation resolution.
- Require linear history.
- No force push.
- No direct pushes.

### 2.2. GitHub Environments

| Environment | Protection |
|---|---|
| `staging` | auto deploy from main |
| `production` | required reviewers: архитектор + DevOps; wait timer; deployment branch `main`/tag |
| `ghcr` | package write через `GITHUB_TOKEN` |

### 2.3. CODEOWNERS

- `contracts/`, `proto/`, `db/` — архитектор + backend lead.
- `.github/`, `infrastructure/` — DevOps.
- `apps/frontend/` — frontend lead.

### 2.4. Dependabot

- npm/pnpm — weekly.
- GitHub Actions — weekly.
- Docker base images — weekly.
- Security updates — immediately.
- Мажорные обновления — отдельный PR.

---

## 3. Workflows

Целевой набор файлов:

```text
.github/workflows/
  ci.yml
  contracts.yml
  security.yml
  images.yml
  deploy-staging.yml
  deploy-prod.yml
  release.yml
```

### 3.1. `ci.yml`

Триггеры:

- `pull_request`;
- `push` в `main`.

Jobs:

1. `install` — pnpm install с кэшем.
2. `lint` — ESLint + Prettier check.
3. `unit` — Vitest.
4. `contract` — OpenAPI/proto/event contract tests.
5. `integration` — Testcontainers PostgreSQL/Kafka/Redis.
6. `build` — сборка всех приложений.
7. `ci-required` — агрегирующий job для branch protection.

Минимальные команды:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm build
```

Правила:

- Node.js 22.
- pnpm через Corepack.
- Один lock-файл.
- Тесты не ходят в реальные внешние сервисы.
- Секреты не доступны PR из fork.
- Пути фильтруются, но агрегирующий check всегда запускается.

### 3.2. `contracts.yml`

Триггеры:

- изменения в `openapi/`, `proto/`, `events/`, `sync/`, `notifications/`, `contracts/`.

Jobs:

- `buf lint`;
- `buf breaking` против `main`;
- OpenAPI lint;
- проверка `rest-grpc-map.yaml`;
- проверка event payload schemas;
- проверка, что generated-файлы соответствуют контрактам;
- `contracts-required`.

Правила:

- Breaking change — только с версией и ADR.
- Ручные DTO не заменяют generated.
- Contract test падает при рассинхроне.

### 3.3. `security.yml`

Триггеры:

- PR;
- push в `main`;
- schedule weekly.

Jobs:

- CodeQL для JavaScript;
- `pnpm audit --audit-level high`;
- Trivy для образов;
- secret scanning;
- dependency review для PR;
- SBOM генерация.

Правила:

- High/Critical блокируют merge.
- Исключения — только с expiry и owner.
- Не логировать результаты с секретами.

### 3.4. `images.yml`

Триггеры:

- push в `main`;
- tag `v*`.

Jobs:

- build matrix по приложениям;
- multi-stage Dockerfile;
- push в GHCR;
- tags: `sha-<short>`, `main`, `vX.Y.Z`;
- SBOM/provenance;
- Trivy scan;
- `images-required`.

Образы:

```text
ghcr.io/<org>/smart-oati/api-gateway
ghcr.io/<org>/smart-oati/user-service
ghcr.io/<org>/smart-oati/project-service
ghcr.io/<org>/smart-oati/notification-service
ghcr.io/<org>/smart-oati/audit-service
ghcr.io/<org>/smart-oati/sync-service
ghcr.io/<org>/smart-oati/frontend
```

### 3.5. `deploy-staging.yml`

Триггер:

- успешный `ci` на `main`.

Шаги:

1. Выбрать digest образа.
2. `helm upgrade --install` для инфраструктурных зависимостей, если нужно.
3. Запустить migration Job.
4. Дождаться успеха Job.
5. Задеплоить сервисы.
6. Дождаться rollout.
7. Smoke-тесты.
8. Уведомление.

### 3.6. `deploy-prod.yml`

Триггер:

- tag `v*` или manual dispatch.

Шаги:

1. Approval в GitHub Environment `production`.
2. Проверить, что staging digest проверен.
3. Backup БД.
4. Migration Job.
5. `helm upgrade --atomic`.
6. Smoke-тесты.
7. Rollback при ошибке.
8. Уведомление.

### 3.7. `release.yml`

- Формирует changelog.
- Проверяет версии контрактов.
- Создает GitHub Release.
- Не деплоит production автоматически.

---

## 4. CI-гейты

| Гейт | Блокирует merge/deploy |
|---|---|
| lint/format | merge |
| unit | merge |
| contract | merge |
| integration | merge |
| build | merge |
| CodeQL/Trivy high | merge |
| secret scanning | merge |
| migration dry-run | deploy |
| smoke staging | prod |
| manual approval | prod |

---

## 5. Docker

Требования:

- multi-stage build;
- non-root user;
- pinned base image digest;
- `NODE_ENV=production`;
- healthcheck;
- read-only root filesystem, где возможно;
- без секретов в слоях;
- `.dockerignore`;
- маленький runtime image.

Порты:

- API Gateway — 8080;
- сервисы — 8080 внутри;
- frontend — 3000.

Health:

- `/health/live`;
- `/health/ready`.

---

## 6. Kubernetes

### 6.1. Кластеры и namespaces

Используются отдельные managed-кластеры:

```text
smart-oati-staging  # отдельный кластер, ru-central1-a
smart-oati-prod     # отдельный кластер, ru-central1-a
```

В каждом кластере — namespace `smart-oati`.  
Отдельные кластеры дают изоляцию control plane, сети, Vault-доступа и blast radius.

### 6.2. Компоненты

- Deployments для 7 приложений.
- Services ClusterIP.
- Ingress для frontend/API/WS.
- ConfigMaps для non-secret config.
- Secrets через External Secrets Operator + HashiCorp Vault.
- HPA для API/сервисов.
- PDB для production.
- NetworkPolicy между сервисами.
- ServiceAccount с минимальными правами.
- Resource requests/limits.
- Liveness/readiness probes.
- Pod anti-affinity для production, если несколько реплик.
- Yandex Managed PostgreSQL и Managed Kafka — только внутри VPC, без публичного доступа.
- Security Groups разрешают только кластер и доверенные подсети.

### 6.3. Ingress

- Ingress controller: Yandex Application Load Balancer.
- TLS через Yandex Certificate Manager.
- HSTS.
- Placeholder-домены: `app.example.com`, `api.example.com`; staging — `staging.app.example.com`, `staging.api.example.com`.
- `app.*` → frontend.
- `api.*` → API Gateway.
- `api.*/ws` → Sync Service.
- `api.*/telegram/webhook` → Notification Service.
- Внутренние gRPC-порты не публикуются.
- Managed PostgreSQL/Kafka endpoints не попадают в Ingress.
- WAF не включается в MVP; rate limit — на API Gateway.

### 6.4. Helm

Структура:

```text
infrastructure/helm/
  smart-oati/          # umbrella
  api-gateway/
  user-service/
  project-service/
  notification-service/
  audit-service/
  sync-service/
  frontend/
```

Правила:

- values на окружение;
- image digest, не tag;
- `helm upgrade --atomic`;
- миграции — отдельный Job;
- rollback через Helm;
- не хранить секреты в values.

---

## 7. Миграции и rollback

### 7.1. Порядок

1. Backup.
2. Migration Job.
3. Проверка схемы.
4. Deploy приложений.
5. Smoke.

### 7.2. Правила

- Expand/contract.
- Не удалять колонки в том же релизе.
- Destructive migration — только с backup и планом.
- Down-миграции проверены, но production rollback — forward-fix.
- Migration Job идемпотентен.
- Отдельный job на каждую БД.
- При ошибке — остановить deploy.

### 7.3. Rollback

- Helm rollback приложения.
- БД — forward-fix, если миграция уже применена.
- Feature flag для отключения новой функциональности.
- Smoke после rollback.

---

## 8. Секреты

- HashiCorp Vault на одной отдельной VM в Yandex Cloud — источник runtime-секретов.
- Одна VM используется и для staging, и для production; это принятый риск MVP.
- Обязательны snapshot/backup Vault, шифрование диска и проверка restore.
- External Secrets Operator синхронизирует Vault → Kubernetes Secret в каждом кластере.
- GitHub Environment secrets — только bootstrap-значения для deploy (например, доступ к Vault/кластеру), не бизнес-секреты.
- Отдельные credentials и Vault paths на staging/prod.
- Ротация.
- Запрет логов секретов.
- Запрет секретов в Docker image, Helm values, git.
- OIDC federation к Yandex Cloud/кластеру, если доступна; иначе короткоживущий IAM-токен.
- Доступ к production — least privilege.
- Vault audit log включен.

---

## 9. Smoke-тесты

После деплоя:

- `GET /health/live` — 200.
- `GET /health/ready` — 200.
- `GET /api/v1/health` — 200.
- Auth login page — 200.
- WebSocket handshake — 101/200 по контракту.
- Проверка версии образа.
- Проверка, что миграции применены.
- Проверка, что outbox relay работает.
- Проверка, что нет роста 5xx за 5 минут.

---

## 10. Наблюдаемость

- OpenTelemetry Collector.
- Prometheus + Grafana.
- Loki/централизованные логи.
- Алерты:
  - 5xx;
  - gRPC UNAVAILABLE;
  - Kafka lag;
  - outbox backlog;
  - WS disconnects;
  - session validation errors;
  - import failures;
  - notification delivery failures.
- Дашборды по сервисам.
- Deploy annotation в Grafana.

---

## 11. Локальный паритет

- Имена env совпадают с staging/prod.
- Compose использует те же образы, что CI.
- PostgreSQL local — latest; CI — pinned; staging/prod — Yandex Managed PostgreSQL.
- Kafka local — KRaft; staging/prod — Yandex Managed Kafka.
- Mailpit вместо SMTP.
- Mock Telegram.
- `.env.example` — единственный шаблон.
- Секреты local — только dev.
- Vault в local не обязателен; используется `.env.local`.

---

## 12. Первый implementation checklist

- [x] Создать `.github/workflows/ci.yml`.
- [x] Создать `contracts.yml`.
- [x] Создать `security.yml`.
- [x] Создать `images.yml`.
- [ ] Создать `deploy-staging.yml`.
- [ ] Создать `deploy-prod.yml`.
- [ ] Настроить branch protection и environments.
- [ ] Создать Dockerfile для каждого приложения.
- [x] Создать Helm service template.
- [x] Создать Helm-чарты конкретных сервисов и umbrella.
- [x] Создать Helm migration Job для пяти service DB, включая `SYNC_DB=rp_gant_sync`.
- [x] Подготовить staging-only Sync DB/Vault и Kafka TLS/SASL values; см. [`22_Staging_Deployment_Runbook.md`](22_Staging_Deployment_Runbook.md).
- [ ] Создать/включить deploy-staging workflow после утверждения cluster credentials, GitHub Environment и release digests.
- [x] Создать local E2E smoke-тесты; staging runtime acceptance остаётся отдельной задачей.
- [ ] Настроить GHCR.
- [ ] Настроить Vault и External Secrets Operator.
- [ ] Настроить Yandex Managed PostgreSQL и Managed Kafka.
- [ ] Настроить Yandex ALB и Certificate Manager.
- [ ] Проверить RollingUpdate и PDB на staging.
- [ ] Проверить rollback на staging.

---

## 13. Открытые вопросы

1. Финальные домены, DNS и сертификаты вместо placeholder.
2. Vault backup/restore: расписание, retention и ответственный.
3. WAF на Yandex ALB — после пилота.
4. Нужен ли отдельный Yandex Managed Kafka для staging и production? По умолчанию — да.
5. Нужен ли отдельный Yandex Managed PostgreSQL для staging и production? По умолчанию — да.
