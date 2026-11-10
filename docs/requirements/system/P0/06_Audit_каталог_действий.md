# P0: каталог действий аудита
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28

---

## 1. Артефакт

Seed:

```text
Исходные кодв/db/seeds/audit/003_audit_actions.sql
```

Таблицы:

- `audit.audit_actions`;
- `audit.audit_events`;
- `audit.privileged_audit_events`.

---

## 2. Action codes

### 2.1. Auth

- `auth.login.succeeded`
- `auth.login.failed`
- `auth.logout`
- `auth.session.restored`
- `auth.password.reset`
- `auth.password.changed`
- `auth.email.verified`

### 2.2. Users

- `user.created`
- `user.updated`
- `user.blocked`
- `user.unblocked`
- `user.deleted`
- `user.roles.updated`

### 2.3. Projects

- `project.created`
- `project.updated`
- `project.archived`
- `project.unarchived`
- `project.deleted`
- `project.restored`
- `project.purged`
- `project.owner.transferred`

### 2.4. Access

- `project.member.added`
- `project.member.role_changed`
- `project.member.removed`
- `invitation.created`
- `invitation.resent`
- `invitation.accepted`
- `invitation.revoked`
- `executor.created`
- `executor.updated`
- `executor.deleted`
- `executor.linked`
- `executor.unlinked`

### 2.5. Plan

- `diagram.created`
- `diagram.updated`
- `diagram.deleted`
- `direction.created`
- `direction.updated`
- `direction.deleted`
- `task.created`
- `task.updated`
- `task.deleted`
- `task.assignments.changed`
- `dependency.created`
- `dependency.updated`
- `dependency.deleted`
- `dependency.violated`
- `diagram.critical_path.changed`
- `comment.created`
- `comment.updated`
- `comment.deleted`
- `holidays.updated`
- `diagram.import.started`
- `diagram.import.completed`
- `diagram.import.failed`

### 2.6. Notifications

- `notification.created`
- `notification.delivery.sent`
- `notification.delivery.failed`
- `notification.preferences.updated`
- `auth_email.sent`
- `auth_email.failed`
- `telegram.linked`
- `telegram.unlinked`

### 2.7. App

- `settings.updated`

---

## 3. Маппинг событий

| Событие | Action code |
|---------|-------------|
| `auth.login.succeeded` | `auth.login.succeeded` |
| `auth.login.failed` | `auth.login.failed` |
| `auth.logout` | `auth.logout` |
| `user.created` | `user.created` |
| `user.updated` | `user.updated` |
| `user.blocked` | `user.blocked` |
| `user.unblocked` | `user.unblocked` |
| `user.deleted` | `user.deleted` |
| `user.roles.updated` | `user.roles.updated` |
| `user.email_verified` | `auth.email.verified` |
| `user.password_changed` | `auth.password.changed` |
| `auth.session.restored` | `auth.session.restored` |
| `project.created` | `project.created` |
| `project.updated` | `project.updated` |
| `project.archived` | `project.archived` |
| `project.unarchived` | `project.unarchived` |
| `project.deleted` | `project.deleted` |
| `project.restored` | `project.restored` |
| `project.purged` | `project.purged` |
| `project.owner.transferred` | `project.owner.transferred` |
| `project.member.added` | `project.member.added` |
| `project.member.role_changed` | `project.member.role_changed` |
| `project.member.removed` | `project.member.removed` |
| `invitation.*` | соответствующее `invitation.*` |
| `executor.*` | соответствующее `executor.*` |
| `diagram.created` | `diagram.created` |
| `diagram.updated` | `diagram.updated` |
| `diagram.deleted` | `diagram.deleted` |
| `direction.*` | соответствующее `direction.*` |
| `task.*` | соответствующее `task.*` |
| `dependency.*` | соответствующее `dependency.*` |
| `comment.*` | соответствующее `comment.*` |
| `holidays.updated` | `holidays.updated` |
| `diagram.import.*` | соответствующее `diagram.import.*` |
| `notification.*` | соответствующее `notification.*` |
| `auth_email.*` | соответствующее `auth_email.*` |
| `telegram.*` | соответствующее `telegram.*` |
| `settings.updated` | `settings.updated` |

---

## 4. Before/after

### 4.1. Полные снимки

- пользователи;
- глобальные роли;
- участия проекта;
- приглашения;
- настройки системы;
- жизненный цикл проекта;
- передача владения;
- импорт;
- роли и права.

### 4.2. Только измененные поля

- задача;
- направление;
- зависимость;
- комментарий;
- праздники.

### 4.3. Без снимков

- вход, выход;
- неудачный вход;
- доставка уведомлений;
- auth-письма;
- Telegram-привязка.

### 4.4. Запрещено хранить

- пароли;
- токены;
- cookie;
- email;
- Telegram;
- ФИО;
- полный текст комментариев;
- тела запросов.

---

## 5. Привилегированный журнал

- все действия актора с ролью `app_admin`;
- отдельная таблица;
- срок 2 года;
- доступ только администратору;
- дублируется в общий журнал;
- actor roles берутся из события;
- если ролей нет — Audit запрашивает User & Access;
- при недоступности User событие остается в retry.

---

## 6. Партиции

- `audit_events` — месячные партиции;
- `privileged_audit_events` — месячные партиции;
- default partition;
- менеджер партиций создает следующие месяцы;
- старые партиции удаляются по retention.

---

## 7. Критерии приемки

1. Seed содержит все action codes.
2. Seed идемпотентен.
3. Каждому событию соответствует action code.
4. Полные снимки только для критических действий.
5. Частые изменения — только измененные поля.
6. PII не хранится.
7. Все действия `app_admin` попадают в privileged journal.
8. Privileged journal доступен только администратору.
9. Партиции создаются и удаляются.
10. Before/after не содержат запрещенных полей.

