# P0: DDL, миграции и seed-данные
## SMART OATI

**Версия:** 1.0  
**Дата исходного документа:** 2026-10-28

> Этот DDL — проектный baseline, не точный дамп текущих миграций. Local Compose сейчас использует PostgreSQL 17 и базы `rp_gant_*`; production-версия PostgreSQL не подтверждена. Схема runtime определяется файлами `db/migrations/`.

---

## 1. Назначение

Документ фиксирует физическую схему БД, порядок миграций, seed-данные, триггеры и правила эксплуатации.

Основание:

- `Архитектура_базы_данных_SMART_OATI.md` v1.7;
- системные постановки сервисов;
- план реализации v1.6.

---

## 2. Кластер и базы

Проектный baseline описан для одного кластера PostgreSQL 16. В local Compose задан `postgres:17-alpine`; производственная версия должна быть зафиксирована отдельно.

| База | Назначение |
|------|------------|
| `rp_gant_user` | User & Access |
| `rp_gant_project` | Project / Diagram |
| `rp_gant_notification` | Notification |
| `rp_gant_audit` | Audit |
| `rp_gant_sync` | Sync processed-event deduplication ledger |

Внутри баз используются отдельные схемы:

- User: `access`, `jobs`, `settings`, `events`, `analytics`, `ext`;
- Project: `project`, `plan`, `jobs`, `events`, `analytics`, `ext`;
- Notification: `notify`, `delivery`, `scheduler`, `bots`, `events`, `analytics`, `ext`;
- Audit: `audit`, `events`, `analytics`, `ext`;
- Sync: `events`.

---

## 3. Файлы миграций

```text
db/migrations/user_access/0001_user_access.sql
db/migrations/project_diagram/0002_project_diagram.sql
db/migrations/notification/0003_notification.sql
db/migrations/audit/0004_audit.sql
db/migrations/sync/0001_sync.sql
```

Миграции содержат `-- Up Migration` и `-- Down Migration`.

Каждая миграция применяется к отдельной базе.

---

## 4. Применение

```text
node-pg-migrate up -m db/migrations/user_access -d DATABASE_URL_USER
node-pg-migrate up -m db/migrations/project_diagram -d DATABASE_URL_PROJECT
node-pg-migrate up -m db/migrations/notification -d DATABASE_URL_NOTIFICATION
node-pg-migrate up -m db/migrations/audit -d DATABASE_URL_AUDIT
node-pg-migrate up -m db/migrations/sync -d DATABASE_URL_SYNC  # только при включённой Sync DB
```

Миграция Sync DB запускается только при явном `SYNC_DB=rp_gant_sync` и заданном `DATABASE_URL_SYNC`; пустой `SYNC_DB` оставляет её выключенной вне local Compose.

Seed:

```text
psql $DATABASE_URL_USER -f db/seeds/user_access/001_roles_permissions.sql
psql $DATABASE_URL_USER -f db/seeds/user_access/002_system_settings.sql
psql $DATABASE_URL_AUDIT -f db/seeds/audit/003_audit_actions.sql
```

Порядок:

1. User DB → миграции;
2. User DB → роли, права, настройки;
3. Project DB → миграции;
4. Notification DB → миграции;
5. Audit DB → миграции и `audit_actions`;
6. Sync DB → миграция `events.processed_events`;
7. запуск воркеров outbox/import/auth-email/audit/sync consumers.

---

## 5. Ключевые ограничения

### 5.1. User

- уникальный `email` без учета регистра;
- `status ∈ active/blocked`;
- `lockout_level 0..3`;
- максимум 2 активных слота сессий — триггер;
- один активный remember-токен на слот;
- одно активное приглашение на `project_id + email`;
- один пользователь — не более одного исполнителя;
- системные настройки и auth-задания в отдельных схемах.

### 5.2. Project

Создание проекта доступно любому активному пользователю после аутентификации; участие владельца создается через `EnsureProjectOwner`.

- `active → archived → deleted`;
- удаление только из `archived`;
- `purge_after` для удаленных проектов;
- 3 уровня плана;
- WBS уникален в пределах диаграммы и типа;
- у направления только ответственный;
- у задачи — один ответственный, один исполнитель, до двух соисполнителей;
- триггеры проверяют иерархию задач и лимит соисполнителей;
- один активный импорт на диаграмму;
- payload импорта до 50 МБ.

### 5.3. Notification

- настройки уникальны по `user_id + event_type + channel`;
- одна доставка на `notification_id + channel`;
- `auth_email_deliveries.job_id` уникален;
- `telegram_updates.update_id` уникален;
- напоминания дедуплицируются по `dedupe_key`.

### 5.4. Audit

- `audit_events` и `privileged_audit_events` партиционированы по месяцу;
- `PRIMARY KEY (id, occurred_at)`;
- `source_event_id` уникален в пределах партиции;
- default partition создана;
- месячные партиции создаются фоновой задачей;
- общий журнал — 2 месяца;
- привилегированный — 2 года.

---

## 6. Триггеры

| Триггер | Назначение |
|---------|------------|
| `access.trg_user_sessions_max` | Не более 2 активных сессий |
| `plan.trg_tasks_hierarchy` | Проверка уровня, родителя и диаграммы |
| `plan.trg_assignments_limit` | Не более 2 соисполнителей |

Проверки, которые остаются на уровне приложения:

- WBS-перенумерация;
- циклы зависимостей;
- проверка ID пользователей/исполнителей через gRPC;
- права и роли;
- проверка project_id у внешних ссылок;
- удаление/восстановление проекта.

---

## 7. Индексы

Критичные индексы включены в миграции:

- пользователи по email/status/display_name;
- сессии по user/absolute/idle/revoked/remember;
- участия по project/user/status/revoked_reason;
- проекты по owner/status/purge_after;
- задачи по diagram/status/direction/parent/dates;
- назначения по entity/assignee;
- зависимости по diagram/predecessor/successor;
- импорт по diagram/status/initiator;
- уведомления по recipient/created/unread/project;
- доставки по status/next_attempt;
- напоминания по remind_at pending;
- аудит по actor/action/project/entity/correlation.

---

## 8. Retention и фоновые задачи

| Данные | Действие |
|--------|----------|
| `diagram_changes` | Удаление старше 2 месяцев |
| `audit_events` | Удаление партиций старше 2 месяцев |
| `privileged_audit_events` | Удаление партиций старше 2 лет |
| `notifications` | Удаление старше 2 месяцев |
| `notification_deliveries` | Удаление старше 2 месяцев |
| `auth_email_deliveries` | Удаление старше 2 месяцев |
| `telegram_updates` | Удаление старше 2 месяцев |
| `import_jobs` | Метаданные 7 дней, payload после обработки |
| `projects` | Очистка после `purge_after` (1 год) |
| `auth_email_jobs` | 30 дней |

Отдельные процессы:

- outbox relay;
- audit partition manager;
- import worker;
- auth-email worker;
- notification delivery worker;
- project purge worker;
- sessions cleanup.

---

## 9. Резервное копирование

- ежедневный полный backup;
- WAL/PITR;
- отдельная проверка восстановления;
- RPO ≤ 24 ч;
- RTO ≤ 4 ч;
- backup перед миграциями;
- миграции выполняются отдельной учетной записью.

---

## 10. Критерии приемки

1. Bootstrap создаёт все пять service DB и применяет их миграции на пустом PostgreSQL; Sync создаёт `events.processed_events`.
2. Down-миграции работают.
3. Seed ролей и прав идемпотентен.
4. Seed настроек идемпотентен.
5. Seed `audit_actions` идемпотентен.
6. Триггер сессий не допускает третий слот.
7. Триггер назначений не допускает третьего соисполнителя.
8. Триггер задач не допускает неверную иерархию.
9. Индексы созданы.
10. Партиции аудита создаются и удаляются по retention.
11. Внешние ID не имеют FK между БД.
12. Проверки внешних ссылок выполняются через gRPC.


