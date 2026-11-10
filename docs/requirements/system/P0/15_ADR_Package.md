# P0: ADR Package
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28  
**Статус:** draft for approval  
**Область:** ключевые архитектурные решения и шаблон для новых ADR  
**Связанные документы:** `P0/14_MVP_Scope_and_Backlog.md`, `P0/16_Authorization_Matrix.md`, `../SMART_OATI_план_реализации_серверных_интеграций.md`

---

## 1. Как использовать ADR

- Один ADR — одно решение.
- ADR не переписывается после принятия; новое решение оформляется как `Supersedes ADR-00X`.
- Статусы: `Proposed`, `Accepted`, `Rejected`, `Superseded`, `Deprecated`.
- ADR хранится в репозитории рядом с кодом: `docs/adr/NNNN-title.md`.
- Для изменений контрактов, БД, брокера, auth и границ сервисов ADR обязателен.
- Если ADR еще `Proposed`, соответствующая реализация не начинается или идет за feature flag.

### Индекс

| ADR | Решение | Статус |
|---|---|---|
| ADR-001 | Единый брокер: Kafka | Accepted |
| ADR-002 | REST снаружи, gRPC внутри, Gateway без агрегации | Accepted |
| ADR-003 | Database per service, без cross-service SQL | Accepted |
| ADR-004 | Cookie-сессии и CSRF, без JWT/localStorage | Accepted |
| ADR-005 | Nuxt 3 SSR + Vue 3 JavaScript + Tailwind 4 | Accepted |
| ADR-006 | Outbox/Inbox и at-least-once события | Accepted |
| ADR-007 | Права проверяются сервисом, UI только скрывает | Accepted |
| ADR-008 | `app_admin` — глобальный административный доступ к проектам | Accepted |
| ADR-009 | OpenAPI и proto — источники истины, кодогенерация в CI | Accepted |
| ADR-010 | Auth-письма через ранний Notification Service | Accepted |

---

## ADR-001: Единый брокер Kafka

**Статус:** Accepted  
**Дата:** 2026-10-28  
**Контекст:**

- В системе 64 события, outbox, consumers, retries и DLQ.
- Local runbook уже использует Kafka KRaft.
- План реализации допускает NATS JetStream или RabbitMQ.
- Два разных брокера в local и production создадут лишний риск и дублирование кода.
- Решение подтверждено: Kafka используется во всех окружениях.

**Решение:**

Использовать **Kafka** во всех окружениях:

- local — Kafka KRaft в Docker Compose;
- staging/production — Yandex Managed Kafka;
- один брокер для всех сервисов;
- JSON-схемы событий из `events/` и `notifications/`;
- MVP: один topic `smartoati.events`, маршрутизация по `eventType`; разделение по domain topics — только при доказанной необходимости;
- partition key — `projectId` для проектных событий, `userId` для пользовательских;
- consumer groups — по сервису;
- DLQ/error topic для каждого consumer group;
- outbox relay публикует события из БД;
- consumers идемпотентны по `eventId`.

**Последствия:**

- Нужны `kafkajs`, provisioning topics, DLQ, monitoring lag.
- P0 13 и `.env.example` уже используют Kafka; план нужно синхронизировать с этим ADR.
- Появляется единый operational runbook.
- Schema registry в MVP не обязателен; совместимость проверяется contract-тестами.

**Альтернативы:**

- NATS JetStream — проще, но меньше экосистема и меньше опыта.
- RabbitMQ — удобные routing/очереди, но хуже replay и партиционирование.
- Kafka + отдельный broker для Notification — избыточно.

**Принято:** Kafka во всех окружениях; локальный KRaft и production-кластер используют один и тот же контракт событий.

---

## ADR-002: REST снаружи, gRPC внутри

**Статус:** Accepted  
**Контекст:** frontend не должен знать внутреннюю топологию; сервисы должны иметь строгие контракты.

**Решение:**

- Публичный API — только REST/JSON через API Gateway.
- Внутренние вызовы — gRPC/protobuf.
- Gateway — тонкий прокси: auth, CSRF, rate limits, mapping REST↔gRPC.
- Gateway не агрегирует данные и не содержит бизнес-логику.
- Frontend не вызывает gRPC и не ходит в БД напрямую.

**Последствия:**

- Нужны OpenAPI, proto, REST↔gRPC mapping и contract tests.
- Ошибки gRPC маппятся в RFC 7807.
- Появляется дополнительный сетевой хоп, но сохраняется изоляция.

**Альтернативы:** BFF с агрегацией, GraphQL, прямые gRPC-вызовы с frontend — отклонены.

---

## ADR-003: Database per service

**Статус:** Accepted  
**Контекст:** микросервисы должны иметь независимые данные и деплой.

**Решение:**

- У каждого сервиса своя логическая БД/схема.
- Нет cross-service SQL и foreign keys между сервисами.
- Связи — только по UUID.
- Данные пользователей — только в User & Access.
- Проектные данные — только в Project / Diagram.
- Аудит — только в Audit.
- Уведомления — только в Notification.

**Последствия:**

- Нужны batch-обогащение и кэширование имен.
- Нельзя делать JOIN между сервисами.
- Удаление пользователя требует orchestration и передачи владения.
- Появляется eventual consistency.

**Альтернативы:** одна общая БД, shared schema — отклонены.

---

## ADR-004: Cookie-сессии и CSRF

**Статус:** Accepted  
**Контекст:** SSR, безопасность, запрет токенов в localStorage.

**Решение:**

- Сессии в PostgreSQL User & Access.
- Cookie `__Host-session`: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, без `Domain`.
- Remember-cookie `__Host-remember`.
- CSRF double-submit token для mutating-запросов.
- Обычная сессия: 1 час absolute, 10 минут idle.
- Remember: 30 дней absolute, 7 дней idle.
- Максимум 2 активные сессии.
- JWT access/refresh и localStorage не используются.
- `ValidateSession` вызывается Gateway и Sync; Sync — с `extendIdle=false`.
- Источник истины — User Service: сессии в PostgreSQL. Упоминание Redis для сессий в плане 3.6 считается устаревшим; Redis используется для rate limit, presence и кэша.

**Последствия:**

- Нужны session store, cleanup, session limit, CSRF на Gateway.
- SSR должен пробрасывать cookie.
- Logout и revoke должны очищать cookie.

**Альтернативы:** JWT в localStorage, access/refresh tokens — отклонены.

---

## ADR-005: Nuxt 3 SSR + Vue 3 JavaScript + Tailwind 4

**Статус:** Accepted  
**Контекст:** нужен SSR для auth/projects/audit/admin, Gantt — client-only; команда работает на JavaScript.

**Решение:**

- Nuxt 3, Vue 3, JavaScript без TypeScript.
- Tailwind CSS 4 + собственные компоненты.
- SSR для публичных и списочных экранов; Gantt — client-only.
- API-клиент генерируется из OpenAPI.
- Состояние — Pinia/composables; без хранения токенов.
- Дизайн-токены — CSS variables + Tailwind theme.

**Последствия:**

- Нет TS-типов; нужен строгий ESLint/JSDoc и contract tests.
- SSR требует аккуратной работы с cookie и 401.
- Gantt нужно тестировать отдельно.

**Альтернативы:** SPA без SSR, React, TypeScript — отклонены по текущим ограничениям.

---

## ADR-006: Outbox/Inbox и at-least-once

**Статус:** Accepted  
**Контекст:** события должны переживать сбой БД/брокера, consumers должны быть идемпотентны.

**Решение:**

- Сервис пишет бизнес-изменение и outbox-запись в одной транзакции.
- Outbox relay публикует событие в брокер.
- Consumer сохраняет `eventId` и обрабатывает идемпотентно.
- Доставка at-least-once; порядок гарантируется в пределах partition key.
- Retry с backoff; после лимита — DLQ/error topic.
- Event envelope: `eventId`, `eventType`, `version`, `occurredAt`, `producer`, `correlationId`, `payload`.

**Последствия:**

- Нужны outbox-таблицы, relay, дедупликация, DLQ.
- Нельзя полагаться на exactly-once.
- Нужны contract-тесты и monitoring lag.

---

## ADR-007: Права проверяются сервисом

**Статус:** Accepted  
**Контекст:** UI может скрыть кнопку, но не является защитой.

**Решение:**

- Gateway проверяет только аутентификацию, CSRF и rate limit.
- Каждый сервис проверяет права на свою операцию.
- Project / Diagram вызывает `CheckProjectPermission` на каждую операцию.
- UI скрывает недоступные действия, но сервер возвращает 403 при обходе.
- Права не кэшируются надолго.
- Для object-level прав (назначенная задача, автор комментария) проверка выполняется после role-check.

**Последствия:**

- Нужна единая Authorization Matrix и тесты.
- Нельзя доверять роли из клиента.
- Ошибки 403/404 не должны раскрывать существование объекта.

---

## ADR-008: `app_admin` — глобальный административный доступ к проектам

**Статус:** Accepted  
**Контекст:** бизнес-матрицы и seed дают `app_admin` все проектные permissions; при этом обычный пользователь видит только проекты, где участвует.

**Решение:**

- `app_admin` — глобальный администратор: видит все проекты и может выполнять все проектные действия.
- Это единственное исключение из правила «пользователь видит только свои проекты».
- `app_admin` не становится владельцем или участником автоматически.
- При создании проекта на другого владельца владельцем становится выбранный пользователь.
- Все административные изменения в проектах фиксируются в аудите.
- Если нужен более ограниченный режим поддержки, он оформляется отдельным ADR и feature flag.

**Последствия:**

- `CheckProjectPermission` и `ListAccessibleProjectIds` должны учитывать глобальную роль.
- UI показывает администратору все проекты.
- Нужны тесты: admin без membership видит и редактирует проект; обычный пользователь — нет.
- Требуется явная пометка в интерфейсе, что администратор работает в режиме расширенного доступа.

**Альтернативы:** доступ только через membership; read-only support mode — отклонены для MVP.

---

## ADR-009: OpenAPI и proto — источники истины

**Статус:** Accepted  
**Контекст:** REST и gRPC должны быть синхронны, клиенты не должны писаться вручную.

**Решение:**

- OpenAPI 1.2 — источник публичного REST.
- Proto 1.0 — источник внутреннего gRPC.
- Генерация клиентов и серверных стабов — в CI.
- `contracts/rest-grpc-map.yaml` — mapping.
- Contract tests обязательны.
- Ручные DTO не дублируют сгенерированные без причины.

**Последствия:**

- Изменение контракта — отдельный PR с regeneration.
- CI падает при рассинхроне.
- Нужны mock server и codegen.

---

## ADR-010: Auth-письма через ранний Notification Service

**Статус:** Accepted  
**Контекст:**

- Регистрация, подтверждение email и сброс пароля обязательны в MVP.
- Полный Notification Service с in-app, email по задачам и Telegram — R2/R3.
- Дублировать SMTP-логику в User & Access и Notification Service нежелательно.

**Решение:**

- Notification Service поднимается в MVP в минимальном объеме.
- В MVP реализуются только `SendAuthEmail` и шаблоны:
  - `email_verification`;
  - `password_reset`;
  - `account_activation` — при необходимости.
- User & Access создает `auth_email_jobs` и вызывает Notification Service по gRPC.
- Notification Service отправляет письма через SMTP; local — Mailpit.
- Retry/backoff и журнал доставки обязательны.
- In-app уведомления, email по задачам, напоминания и Telegram остаются R2/R3.
- Полная матрица уведомлений P0/05 включается позже, но контракт `SendAuthEmail` стабилен с MVP.

**Последствия:**

- Notification Service входит в MVP-инфраструктуру и CI/CD.
- Нужны миграция `0003_notification.sql`, SMTP-конфиг и шаблоны.
- Auth-сценарии зависят от доступности Notification Service; ошибки доставки не должны ломать регистрацию, но письмо должно быть повторено.
- Локально используется Mailpit, реальный SMTP не требуется.

**Альтернативы:**

- SMTP-модуль внутри User & Access — быстрее, но создает дублирование и долг.
- Отключить verification/reset в MVP — отклонено.
- Поднять полный Notification Service сразу — избыточно для MVP.

---

## 2. Шаблон нового ADR

```markdown
# ADR-NNN: Краткое название

**Статус:** Proposed | Accepted | Rejected | Superseded | Deprecated  
**Дата:** YYYY-MM-DD  
**Владелец:** роль/команда  
**Связанные документы:** ...

## Контекст

Какая проблема, ограничения, силы и факты.

## Решение

Что именно решено. Достаточно конкретно для реализации.

## Последствия

Что станет проще, что сложнее, какие новые обязанности.

## Альтернативы

Какие варианты рассмотрены и почему отклонены.

## Совместимость и миграция

Что нужно изменить в коде, БД, контрактах, окружениях.

## Тесты и приемка

Как проверить, что решение реализовано.

## Открытые вопросы

Что осталось не решенным.
```

---

## 3. Ближайшие ADR, которые нужно создать

1. **ADR-011: Импорт — замена или создание новой диаграммы.**
2. **ADR-012: Формат optimistic concurrency** — revision/ETag/If-Match.
3. **ADR-013: Аудит чтения данных администратором** — писать ли read-access в privileged journal.
4. **ADR-014: Timezone и рабочий календарь** — хранение дат, DST, границы суток.
