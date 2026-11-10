# P0: Engineering Handbook
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28  
**Статус:** draft for approval  
**Область:** инженерные стандарты, структура репозитория, качество кода, тесты, review, релизы и безопасность разработки  
**Связанные документы:** `P0/14_MVP_Scope_and_Backlog.md`, `P0/15_ADR_Package.md`, `P0/18_CI_CD_and_Environments.md`

---

## 1. Базовый стек

| Слой | Технология |
|---|---|
| Runtime | Node.js 22 LTS |
| Package manager | pnpm 10.x через Corepack |
| Backend HTTP | Fastify 5 |
| Внутренний RPC | gRPC + `@grpc/grpc-js` + protobuf |
| Frontend | Vue 3 + Nuxt 3 SSR |
| Язык | JavaScript, без TypeScript |
| CSS | Tailwind CSS 4 + CSS variables |
| БД | PostgreSQL |
| Кэш/лимиты/presence | Redis |
| Брокер | Kafka (ADR-001) |
| Тесты | Vitest, Playwright, Testcontainers |
| Контейнеры | Docker, Docker Compose local |
| Оркестрация | Yandex Managed Kubernetes staging/prod, `ru-central1-a` |
| Managed-сервисы | Yandex Managed PostgreSQL, Yandex Managed Kafka |
| Ingress | Yandex Application Load Balancer |
| Секреты | HashiCorp Vault на одной VM + External Secrets Operator |
| CI/CD | GitHub Actions |
| Реестр образов | GHCR |

Ограничения:

- не добавлять TypeScript без отдельного ADR;
- не добавлять второй брокер;
- не вводить BFF/GraphQL без ADR;
- не хранить JWT в localStorage;
- не делать cross-service SQL;
- не коммитить секреты, сертификаты и сгенерированные файлы.

---

## 2. Структура репозитория

```text
smart-oati/
  apps/
    api-gateway/
    user-service/
    project-service/
    notification-service/
    audit-service/
    sync-service/
    frontend/
  packages/
    shared/
    proto/
    api-client/
    eslint-config/
    test-utils/
  contracts/
    openapi/
    rest-grpc-map.yaml
    import-export/
  proto/
    buf.yaml
    smartoati/
  db/
    migrations/
    seeds/
  events/
  notifications/
  infrastructure/
    local/
      docker-compose.yml
      traefik/
      postgres/init/
      telegram-mock/
    helm/
      smart-oati/
      api-gateway/
      user-service/
      project-service/
      notification-service/
      audit-service/
      sync-service/
      frontend/
    k8s/
  docs/
    adr/
    runbooks/
  tools/
  .github/
    workflows/
    CODEOWNERS
    dependabot.yml
```

Правила:

- `apps/*` — только исполняемые приложения.
- `packages/*` — переиспользуемые библиотеки.
- `contracts/*` — публичные и межсервисные контракты.
- `db/*` — миграции и seed.
- `infrastructure/*` — окружения, не бизнес-код.
- `docs/adr` — ADR.
- `generated/`, `node_modules/`, `certs/`, `.env.local` не коммитятся.

### 2.1. Имена пакетов

```text
@smart-oati/api-gateway
@smart-oati/user-service
@smart-oati/project-service
@smart-oati/notification-service
@smart-oati/audit-service
@smart-oati/sync-service
@smart-oati/frontend
@smart-oati/shared
@smart-oati/api-client
```

---

## 3. Версии и lock-файлы

- `packageManager` фиксирует pnpm.
- `engines.node` — `>=22 <23`.
- Один `pnpm-lock.yaml` в корне.
- Версии Node и pnpm фиксируются в CI.
- PostgreSQL в local — `latest`; в CI — pinned digest; в staging/prod — Yandex Managed PostgreSQL.
- Kafka в local — KRaft; в staging/prod — Yandex Managed Kafka.
- Docker images — pinned major/minor, не `latest` в production.
- Обновления зависимостей — через Dependabot/Renovate, маленькими PR.
- Мажорные обновления — отдельный PR + проверка contract/E2E.

---

## 4. Git и review

### 4.1. Ветки

- `main` — защищенная ветка, всегда деплоится в staging.
- Рабочие ветки — короткоживущие: `feat/...`, `fix/...`, `chore/...`, `docs/...`.
- Trunk-based development; долгие ветки запрещены.
- Release — тег `vYYYY.MM.PATCH` или сервисный тег, если появится независимый релиз.

### 4.2. Коммиты

Рекомендуется Conventional Commits:

```text
feat(auth): add session limit
fix(project): reject dependency cycle
docs(adr): accept Kafka broker
chore(ci): cache pnpm store
```

### 4.3. Pull request

PR должен содержать:

- что изменено и зачем;
- ссылку на story/ADR;
- как проверено;
- риски и rollback;
- скриншоты для UI;
- обновленные OpenAPI/proto/события, если затронуты.

Требования:

- минимум 1 approve; для контрактов, БД, auth — 2;
- зеленый CI;
- нет конфликтов;
- нет секретов и отладочных логов;
- squash merge.

### 4.4. CODEOWNERS

- `contracts/`, `proto/`, `db/` — архитектор + backend lead.
- `apps/frontend/` — frontend lead.
- `.github/`, `infrastructure/` — DevOps.
- `docs/adr/` — архитектор.

---

## 5. Код-стиль

### 5.1. JavaScript

- ESLint flat config + Prettier.
- `no-console` в production-коде; использовать logger.
- `const` по умолчанию; `let` только при переприсваивании.
- Явные импорты; без wildcard.
- JSDoc для публичных функций, сложных DTO и контрактов.
- Не использовать `any`-подобные неявные структуры без описания.
- Ошибки — через typed error classes/коды, не строки.
- Async/await; без floating promises.
- Таймауты и AbortSignal для внешних вызовов.

### 5.2. Backend

- Валидация входа на границе сервиса.
- Бизнес-логика — в use-case/service слое, не в route handler.
- Репозитории — только доступ к своей БД.
- Никаких gRPC/DB вызовов из frontend.
- Единый формат ошибок RFC 7807 на REST.
- gRPC errors маппятся в коды домена.
- Логи структурированные: `requestId`, `correlationId`, `userId`, `projectId`, `service`.
- Секреты и PII не логируются.

### 5.3. Frontend

- Nuxt 3, Composition API, `<script setup>`.
- Без TypeScript; JSDoc для props/composables.
- Состояние — Pinia/composables; без глобального хаоса.
- API-клиент — generated из OpenAPI.
- Все запросы — через единый `apiClient`, не `fetch` по компонентам.
- Ошибки 401/403/404/409/500 — централизованно.
- Tailwind-классы + токены; без произвольных hex в компонентах.
- Доступность: label, focus, aria, keyboard.

---

## 6. Контракты

- OpenAPI — источник REST.
- Proto — источник gRPC.
- `contracts/rest-grpc-map.yaml` — mapping.
- Любое изменение контракта — PR с regeneration.
- Breaking change требует версии и ADR.
- Contract tests обязательны в CI.
- Mock server генерируется из OpenAPI.
- Сгенерированные файлы не редактируются вручную.

---

## 7. База данных и миграции

- Каждый сервис — только своя БД/схема.
- Миграции — `node-pg-migrate` (по P0/01).
- Миграции идемпотентны и проверены на down.
- Production-миграции — отдельный job.
- Expand/contract для несовместимых изменений.
- Destructive migrations — только с backup и планом.
- Seed идемпотентен.
- Индексы добавляются вместе с запросами; проверять `EXPLAIN`.
- Время — `timestamptz`; даты — по правилам домена.
- UUID — для внешних идентификаторов.

---

## 8. Тесты

### 8.1. Уровни

| Уровень | Инструмент | Что проверяет |
|---|---|---|
| Unit | Vitest | Доменная логика, permissions, validation |
| Contract | Vitest + схемы | OpenAPI↔gRPC, события, payloads |
| Integration | Vitest + Testcontainers | БД, Kafka, Redis, gRPC |
| E2E | Playwright | Auth, проекты, Гант, права, конфликты |
| Load | k6/Artillery | SLO baseline, WS, импорт |
| Security | Trivy/CodeQL/audit | Уязвимости и секреты |

### 8.2. Обязательные тесты для каждой story

- happy path;
- 401/403/404;
- validation error;
- audit event;
- идемпотентность/повтор;
- граничные значения;
- для UI — loading/empty/error.

### 8.3. Test data

- Seed-пользователи с ролями.
- Демо-проект и диаграмма.
- Импорт-примеры v2 и legacy.
- Отдельный набор для E2E.
- Данные не содержат реальных ПДн.

---

## 9. Безопасность разработки

- Секреты — только через HashiCorp Vault/External Secrets; local — `.env.local`.
- `.env.local` в `.gitignore`.
- GitHub secret scanning + push protection.
- Dependabot alerts.
- `pnpm audit` в CI.
- Trivy для образов.
- CodeQL для JS.
- Запрещены реальные токены в тестах и документации.
- Логи не содержат паролей, cookie, email/Telegram.
- Для auth — Argon2id/bcrypt, CSRF, rate limit.
- Внутренние сервисы не публикуются.
- Service-to-service auth: mTLS или service tokens.

---

## 10. Документация

- ADR — для архитектурных решений.
- OpenAPI/proto/AsyncAPI — для контрактов.
- Runbook — для эксплуатации.
- README сервиса: назначение, запуск, env, health, owner.
- Definition of Done включает обновление docs.
- Схемы — Mermaid в Markdown.

---

## 11. Definition of Ready / Done

Использовать `P0/14_MVP_Scope_and_Backlog.md` §8–9. Дополнительно:

- DoR: есть owner, contract, audit events, test data.
- DoD: CI, tests, observability, security, docs, rollback.

---

## 12. Локальная разработка

- Все приложения — в Docker Compose.
- Инфраструктура: PostgreSQL, Redis, Kafka, Mailpit, mock Telegram, Traefik.
- HTTPS через mkcert.
- `pnpm dev:up` — полный стек.
- `pnpm dev:reset` — чистый старт.
- Подробнее: `P0/13_Local_Development_Runbook.md`.

---

## 13. Чек-лист PR

- [ ] Story/ADR указаны.
- [ ] Нет секретов и PII в логах.
- [ ] Валидация входа.
- [ ] Права проверены на сервере.
- [ ] Audit event добавлен.
- [ ] Ошибки RFC 7807.
- [ ] Contract обновлен.
- [ ] Unit/contract/integration tests.
- [ ] UI состояния и accessibility.
- [ ] Нет `console.log` и debug-кода.
- [ ] Rollback понятен.
- [ ] Docs обновлены.

---

## 14. Первые инженерные задачи

1. Создать monorepo и pnpm workspace.
2. Добавить ESLint/Prettier/editorconfig/.gitattributes.
3. Добавить GitHub Actions CI и branch protection.
4. Поднять Compose и шаблон сервиса.
5. Настроить codegen, mock server, contract tests.
6. Выровнять seed с Authorization Matrix (PLAT-08).
7. Добавить базовые health/metrics/logs.
