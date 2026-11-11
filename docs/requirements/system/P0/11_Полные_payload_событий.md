# P0: полные payload-контракты событий
## SMART OATI

**Версия:** 1.0  
**Дата исходного документа:** 2026-10-28

> Этот документ — проектный перечень, не актуальный полный каталог. Текущие event types и payload-схемы находятся в `events/event-types.json` и `events/schemas/payloads.schema.json`; сейчас каталог содержит 68 event types, а payload schema — 79 definitions. См. [`docs/IMPLEMENTATION-STATUS.md`](../../../IMPLEMENTATION-STATUS.md).

---

## 1. Артефакты

- `events/asyncapi.yaml`;
- `events/event-types.json`;
- `events/schemas/event-envelope.schema.json`;
- `events/schemas/payloads.schema.json`;
- `events/schemas/diagram-changed.schema.json`;
- `events/schemas/auth-email-requested.schema.json`.

---

## 2. Правила

- Конверт — `EventEnvelope`; фактические имена полей — snake_case по `events/schemas/event-envelope.schema.json`.
- `payloadSchema` события указывает на `payloads.schema.json#/$defs/<Name>`.
- Выбор payload — по `eventType`.
- Все payload — strict, `additionalProperties: false`.
- Новое поле — новая `schemaVersion` или новая версия события.
- Нет email, Telegram, телефонов и полных ФИО.
- Для пользователей — только ID и `displayName`.
- Для комментариев — `bodyPreview` до 200 символов.
- Для удаления — ID и контекст.
- `diagram.changed` передает полный измененный объект.
- `project.owner.transferred` публикует Project / Diagram.
- `telegram.linked/unlinked` публикует User & Access.

---

## 3. Каталог payload

| Событие | Producer | Consumers | Payload schema |
|---------|----------|-----------|----------------|
| `user.created` | user | audit, notification | `UserCreatedPayload` |
| `user.updated` | user | audit | `UserUpdatedPayload` |
| `user.email_verified` | user | audit | `UserEmailVerifiedPayload` |
| `user.password_changed` | user | audit | `UserPasswordChangedPayload` |
| `user.blocked` | user | audit, notification, sync | `UserBlockedPayload` |
| `user.unblocked` | user | audit | `UserUnblockedPayload` |
| `user.deleted` | user | project, notification, audit, sync | `UserDeletedPayload` |
| `auth.login.succeeded` | user | audit | `AuthLoginSucceededPayload` |
| `auth.login.failed` | user | audit | `AuthLoginFailedPayload` |
| `auth.logout` | user | audit | `AuthLogoutPayload` |
| `project.created` | project | audit | `ProjectCreatedPayload` |
| `project.updated` | project | audit | `ProjectUpdatedPayload` |
| `project.archived` | project | user, notification, audit, sync | `ProjectArchivedPayload` |
| `project.unarchived` | project | audit | `ProjectUnarchivedPayload` |
| `project.deleted` | project | user, notification, audit, sync | `ProjectDeletedPayload` |
| `project.restored` | project | user, notification, audit | `ProjectRestoredPayload` |
| `project.purged` | project | user, notification, audit | `ProjectPurgedPayload` |
| `project.owner.transferred` | project | audit | `ProjectOwnerTransferredPayload` |
| `project.member.added` | user | notification, audit | `ProjectMemberAddedPayload` |
| `project.member.role_changed` | user | notification, audit, sync | `ProjectMemberRoleChangedPayload` |
| `project.member.removed` | user | notification, audit, sync | `ProjectMemberRemovedPayload` |
| `invitation.created` | user | audit | `InvitationCreatedPayload` |
| `invitation.resent` | user | audit | `InvitationResentPayload` |
| `invitation.accepted` | user | audit | `InvitationAcceptedPayload` |
| `invitation.revoked` | user | audit | `InvitationRevokedPayload` |
| `executor.created` | user | audit | `ExecutorCreatedPayload` |
| `executor.updated` | user | notification, audit | `ExecutorUpdatedPayload` |
| `executor.deleted` | user | audit | `ExecutorDeletedPayload` |
| `executor.linked` | user | audit | `ExecutorLinkedPayload` |
| `executor.unlinked` | user | audit | `ExecutorUnlinkedPayload` |
| `diagram.created` | project | audit | `DiagramCreatedPayload` |
| `diagram.updated` | project | audit | `DiagramUpdatedPayload` |
| `diagram.deleted` | project | audit | `DiagramDeletedPayload` |
| `diagram.changed` | project | sync, audit | `DiagramChangedPayload` |
| `direction.created` | project | audit | `DirectionCreatedPayload` |
| `direction.updated` | project | audit | `DirectionUpdatedPayload` |
| `direction.deleted` | project | audit | `DirectionDeletedPayload` |
| `task.created` | project | notification, audit | `TaskCreatedPayload` |
| `task.updated` | project | notification, audit | `TaskUpdatedPayload` |
| `task.deleted` | project | notification, audit | `TaskDeletedPayload` |
| `task.assignments.changed` | project | notification, audit | `TaskAssignmentsChangedPayload` |
| `dependency.created` | project | notification, audit | `DependencyCreatedPayload` |
| `dependency.updated` | project | audit | `DependencyUpdatedPayload` |
| `dependency.deleted` | project | audit | `DependencyDeletedPayload` |
| `dependency.violated` | project | notification, audit | `DependencyViolatedPayload` |
| `diagram.critical_path.changed` | project | notification, audit | `DiagramCriticalPathChangedPayload` |
| `comment.created` | project | notification, audit | `CommentCreatedPayload` |
| `comment.updated` | project | audit | `CommentUpdatedPayload` |
| `comment.deleted` | project | audit | `CommentDeletedPayload` |
| `holidays.updated` | project | audit | `HolidaysUpdatedPayload` |
| `diagram.import.started` | project | audit | `DiagramImportStartedPayload` |
| `diagram.import.completed` | project | notification, audit | `DiagramImportCompletedPayload` |
| `diagram.import.failed` | project | notification, audit | `DiagramImportFailedPayload` |
| `notification.created` | notification | audit | `NotificationCreatedPayload` |
| `notification.delivery.sent` | notification | audit | `NotificationDeliverySentPayload` |
| `notification.delivery.failed` | notification | audit | `NotificationDeliveryFailedPayload` |
| `notification.preferences.updated` | notification | audit | `NotificationPreferencesUpdatedPayload` |
| `auth_email.sent` | notification | audit | `AuthEmailSentPayload` |
| `auth_email.failed` | notification | audit | `AuthEmailFailedPayload` |
| `telegram.linked` | user | audit | `TelegramLinkedPayload` |
| `telegram.unlinked` | user | audit | `TelegramUnlinkedPayload` |
| `settings.updated` | user | audit | `SettingsUpdatedPayload` |
| `user.roles.updated` | user | audit | `UserRolesUpdatedPayload` |
| `auth.session.restored` | user | audit | `AuthSessionRestoredPayload` |


---

## 4. Критерии приемки

1. Для каждого события из актуального `events/event-types.json` определена подходящая payload schema; число типов не дублируется константой.
2. Нет ссылок на отсутствующие `$defs`.
3. Все схемы strict.
4. `actor_roles` обязателен по текущей JSON Schema; User и Project producers сохраняют роли на момент действия в outbox snapshot (см. `docs/IMPLEMENTATION-STATUS.md`).
5. PII не передается.
6. `bodyPreview` не превышает 200 символов.
7. `diagram.changed` содержит полный объект.
8. Producer/consumers совпадают с каталогом.
