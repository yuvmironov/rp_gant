# Системная постановка: proto-контракты backend-сервисов
## «Диаграмма Ганта — проект SMART OATI»

**Версия документа:** 1.0  
**Дата:** 2026-10-28  
**Соответствует плану реализации:** версия 1.6  
**Соответствует бизнес-постановке:** версия 2.3  
**Соответствует архитектуре БД:** версия 1.7  
**Соответствует API Gateway:** версия 1.2  
**Соответствует User & Access Service:** версия 1.3  
**Соответствует Project / Diagram Service:** версия 1.2  
**Соответствует Sync / Realtime Service:** версия 1.0  
**Соответствует Notification Service:** версия 1.0  
**Соответствует Audit Service:** версия 1.0  
**Соответствует Telegram Bot:** версия 1.0

---

## 1. Назначение

Документ описывает правила и состав proto-контрактов для внутреннего gRPC-взаимодействия backend-сервисов.

Proto-файлы являются источником истины для:

- gRPC-серверов;
- gRPC-клиентов API Gateway;
- внутренних вызовов между сервисами;
- контрактных тестов;
- генерации кода и загрузки контрактов в Node.js.

Публичный REST/JSON и OpenAPI описываются отдельно.

---

## 2. Границы

### 2.1. Входит

- `UserService`;
- `ProjectService`;
- `NotificationService`;
- `AuditService`;
- общие типы и перечисления;
- события брокера в proto-представлении;
- правила именования, версионирования и совместимости;
- загрузка proto в Node.js;
- контрактные проверки.

### 2.2. Не входит

- REST/OpenAPI API Gateway;
- WebSocket-контракт Sync / Realtime;
- Telegram Bot API;
- SMTP;
- схема БД и DDL;
- бизнес-логика сервисов;
- UI.

### 2.3. Сервисы без собственного gRPC-сервера

- **API Gateway** — gRPC-клиент, использует контракты сервисов.
- **Sync / Realtime** — gRPC-клиент User и Project, публичный транспорт WebSocket.
- **Telegram Bot** — модуль Notification, gRPC-клиент User.

Для них отдельные proto-сервисы не создаются.

---

## 3. Структура файлов

Корень контрактов:

```text
D:\ОАТИ\Ганты\Исходные кодв\proto
```

Структура:

```text
proto/
  smartoati/
    common/v1/common.proto
    events/v1/events.proto
    user/v1/user_service.proto
    project/v1/project_service.proto
    notification/v1/notification_service.proto
    audit/v1/audit_service.proto
```

| Файл | Пакет | Назначение |
|------|-------|------------|
| `common/v1/common.proto` | `smartoati.common.v1` | Общие перечисления, пагинация, ссылки, проектное участие |
| `events/v1/events.proto` | `smartoati.events.v1` | Конверт события и payload для брокера |
| `user/v1/user_service.proto` | `smartoati.user.v1` | Пользователи, сессии, роли, участия, приглашения, исполнители, Telegram, настройки |
| `project/v1/project_service.proto` | `smartoati.project.v1` | Проекты, диаграммы, план, импорт и экспорт |
| `notification/v1/notification_service.proto` | `smartoati.notification.v1` | Уведомления, настройки, auth-письма, журнал доставки |
| `audit/v1/audit_service.proto` | `smartoati.audit.v1` | Общий и привилегированный аудит |

---

## 4. Общие правила

### 4.1. Синтаксис

- `proto3`.
- Строгий UTF-8.
- Один публичный сервис на файл.
- Пакет: `smartoati.<domain>.v1`.
- Имена сообщений — `UpperCamelCase`.
- Имена полей — `snake_case`.
- Имена методов — `UpperCamelCase`.
- Значения enum — `UPPER_SNAKE_CASE`, первый элемент `*_UNSPECIFIED = 0`.

### 4.2. Идентификаторы

- UUID передается строкой.
- Денежные значения не используются.
- Даты и время — `google.protobuf.Timestamp` в UTC.
- Даты без времени — `Timestamp` на 00:00:00 UTC.
- JSON-подобные настройки и payload — `google.protobuf.Struct`.
- Массивы — `repeated`.
- Опциональные скалярные поля — `optional`.

### 4.3. Пагинация

- `PageRequest { limit, offset }`.
- `PageResponse { total, limit, offset }`.
- Максимум `limit` — 200.
- По умолчанию — 50.

### 4.4. Ошибки

- Используются стандартные gRPC-коды.
- Доменный код передается в trailing metadata `error-code`.
- Детали — JSON в trailing metadata `error-details`.
- Сообщение — `error-message`.
- Стеки и внутренние детали не передаются.
- `UNAUTHENTICATED` — 401, `PERMISSION_DENIED` — 403, `NOT_FOUND` — 404, `ABORTED` — 409, `FAILED_PRECONDITION` — 412, `RESOURCE_EXHAUSTED` — 429, `UNAVAILABLE` — 503, `DEADLINE_EXCEEDED` — 504.

### 4.5. Метаданные

Входящие gRPC-metadata:

- `x-request-id`;
- `x-correlation-id`;
- `x-actor-user-id`;
- `x-actor-roles`;
- `x-session-id`;
- `x-client-ip`;
- `x-user-agent`;
- `x-service-token`;
- `idempotency-key`.

Правила:

- сервисные вызовы защищены mTLS и/или service-токеном;
- публичный клиент не вызывает gRPC напрямую;
- `x-actor-user-id` заполняется Gateway после проверки сессии;
- внутренние сервисы не доверяют пользовательским metadata без проверки.

### 4.6. Идемпотентность

- Для команд используется `idempotency-key`.
- Ключ UUID.
- Хранится 24 часа.
- Повтор с тем же ключом и телом возвращает тот же результат.
- Повтор с другим телом — `ALREADY_EXISTS` или `ABORTED`.

### 4.7. Версионирование

- Версия только в пакете: `v1`.
- Ломающие изменения — новый пакет `v2`.
- Нельзя менять номера полей и типы.
- Удаленные поля помечаются `reserved`.
- Новые поля добавляются с новыми номерами.
- Enum-значения не переиспользуются.

---

## 5. Состав контрактов

### 5.1. Common

Содержит:

- `UserStatus`;
- `GlobalRole`;
- `ProjectRole`;
- `ProjectStatus`;
- `TaskStatus`;
- `Priority`;
- `DayMode`;
- `AssignmentRole`;
- `AssigneeType`;
- `DependencyLinkType`;
- `DependencyLineStyle`;
- `DependencyArrowShape`;
- `ImportStatus`, `ImportFormat`, `ExportFormat`;
- `NotificationChannel`, `DeliveryStatus`, `DigestFrequency`, `ReminderKind`;
- `AuditSeverity`, `AuditActorType`;
- `PageRequest`, `PageResponse`;
- `ErrorDetail`;
- `ActorContext`;
- `UserRef`, `ExecutorRef`;
- `ProjectAccess`;
- `TimeRange`.

### 5.2. Events

Содержит:

- `EventEnvelope`;
- `DiagramChangedPayload`;
- `AuthEmailRequestedPayload`;
- `NotificationEventPayload`.

`EventEnvelope` используется брокером, не gRPC-сервисом.

### 5.3. UserService

Группы методов:

- регистрация, подтверждение email, вход, restore, validate, logout;
- сессии пользователя;
- сброс и смена пароля;
- профиль и пользователи;
- роли и права;
- доступ к проектам;
- владелец проекта и передача владения;
- участники проектов;
- приглашения;
- исполнители;
- контакты;
- Telegram;
- системные настройки.

Ключевые особенности:

- `ValidateSession` содержит `optional bool extend_idle`;
- Sync передает `extend_idle=false`;
- login/restore возвращают `set_cookie`;
- `GetUsersByIds` и `GetExecutorsByIds` используются для обогащения;
- `GetUserRoles` используется Audit;
- `ListAccessibleProjectIds` используется Project;
- `EnsureProjectOwner` и `SetProjectOwnerMembership` используются Project.

### 5.4. ProjectService

Группы методов:

- проекты, архивирование, восстановление, очистка, владение;
- диаграммы и изменения;
- направления;
- задачи;
- назначения;
- зависимости;
- комментарии и упоминания;
- праздники;
- импорт;
- экспорт.

Ключевые особенности:

- `GetDiagram` проверяет доступ и возвращает `current_revision`;
- `GetDiagramSnapshot` используется клиентом через REST;
- `ListDiagramChanges` используется Sync;
- `StartImport` асинхронный;
- `ExportDiagram` синхронный;
- ответы содержат ID и имена, имена получаются из User;
- `CheckUserOwnsProjects` используется User при удалении.

### 5.5. NotificationService

Группы методов:

- уведомления пользователя;
- непрочитанные;
- отметка прочтения;
- настройки;
- auth-письма;
- журнал доставки;
- статистика доставки.

Ключевые особенности:

- `SendAuthEmail` идемпотентен по `job_id`;
- auth-письма хранятся отдельно;
- журнал доставки доступен администратору;
- выгрузка отсутствует;
- Telegram Bot вызывает User напрямую, не через Notification API.

### 5.6. AuditService

Группы методов:

- общий журнал;
- событие общего журнала;
- привилегированный журнал;
- событие привилегированного журнала;
- каталог действий;
- статистика.

Ключевые особенности:

- `AuditEvent` содержит `actor_roles`, `before/after`, `source_event_id`;
- привилегированный журнал только для администратора;
- выгрузка отсутствует;
- имена не обогащаются, возвращаются ID.

---

## 6. Node.js и gRPC

### 6.1. Загрузка контрактов

Рекомендуется:

- Node.js 22 LTS;
- JavaScript без TypeScript;
- `@grpc/grpc-js`;
- `@grpc/proto-loader`.

Параметры загрузки:

- `keepCase: false`;
- `longs: String`;
- `enums: String`;
- `defaults: true`;
- `oneofs: true`;
- `includeDirs` — корень `proto`.

### 6.2. Ограничения канала

- `max_receive_message_length` — 64 МБ;
- `max_send_message_length` — 64 МБ;
- keepalive — 30 секунд;
- дедлайн обычного вызова — 5 секунд;
- импорт/экспорт — 30 секунд;
- `ValidateSession` — 2 секунды.

### 6.3. Генерация кода

Допускаются два варианта:

1. Динамическая загрузка через `@grpc/proto-loader` — основной вариант.
2. Генерация статического JavaScript через `grpc_tools_node_protoc`/`pbjs` — по необходимости.

Сгенерированный код не является источником истины. Источник истины — `.proto`.

### 6.4. Совместимость

- `buf lint` или эквивалент;
- `buf breaking` против предыдущей версии;
- контрактные тесты;
- проверка загрузки всех proto в CI;
- проверка отсутствия конфликтов пакетов и полей.

---

## 7. Проверка контрактов

Обязательные проверки:

1. Все proto загружаются без ошибок.
2. Все сервисы и методы доступны в дескрипторе.
3. Нет дубликатов полей.
4. Нет повторного использования номеров.
5. Enum содержит `UNSPECIFIED`.
6. Все импорты разрешаются из корня `proto`.
7. Контрактные тесты клиентов и серверов проходят.
8. API Gateway получает все необходимые клиентские стабы.
9. Sync получает User и Project клиентов.
10. Telegram Bot получает User клиента.
11. Notification получает User клиента.
12. Audit не вызывает бизнес-сервисы для записи.

---

## 8. Критерии приемки

1. Все proto-файлы лежат в `Исходные кодв\proto`.
2. Пакеты соответствуют `smartoati.<domain>.v1`.
3. `UserService` содержит все методы из постановки.
4. `ProjectService` содержит все методы из постановки.
5. `NotificationService` содержит все методы из постановки.
6. `AuditService` содержит все методы из постановки.
7. Общие типы вынесены в `common`.
8. События вынесены в `events`.
9. Все proto загружаются в Node.js.
10. Контракты проходят lint и breaking-check.
11. Все ID — строки UUID.
12. Все время — `Timestamp`.
13. Пагинация единообразна.
14. Ошибки описаны через gRPC status + metadata.
15. Нет PII в сообщениях, кроме явно необходимых полей User.
16. API Gateway использует сгенерированные/загруженные клиенты.
17. Sync использует контракты User и Project.
18. Telegram Bot использует контракт User.
19. Notification использует контракт User.
20. Audit не зависит от бизнес-логики сервисов.

---

## 9. Открытые вопросы

Открытых вопросов по proto-контрактам нет.

OpenAPI, DDL и WebSocket-схема остаются отдельными артефактами.


