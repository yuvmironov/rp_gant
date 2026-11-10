# Системная постановка: OpenAPI-контракт
## «Диаграмма Ганта — проект SMART OATI»

**Версия документа:** 1.2  
**Дата:** 2026-10-28  
**Соответствует плану реализации:** версия 1.6  
**Соответствует бизнес-постановке:** версия 2.3  
**Соответствует архитектуре БД:** версия 1.7  
**Соответствует API Gateway:** версия 1.2  
**Соответствует proto-контрактам:** версия 1.0  
**Соответствует User & Access Service:** версия 1.3  
**Соответствует Project / Diagram Service:** версия 1.2  
**Соответствует Notification Service:** версия 1.0  
**Соответствует Audit Service:** версия 1.0

---

## 1. Назначение

Документ описывает публичный REST/JSON-контракт API Gateway и правила его сопровождения.

Контракт является источником истины для:

- frontend;
- API Gateway;
- интеграционных тестов;
- генерации клиентов;
- проверки REST ↔ gRPC-маршрутизации.

Внутренние gRPC-контракты описаны отдельно в proto-постановке.

---

## 2. Файлы контракта

| Файл | Назначение |
|------|------------|
| `Исходные кодв\openapi\openapi.json` | Канонический OpenAPI 3.1 JSON |
| `Исходные кодв\openapi\openapi.yaml` | YAML-представление, сгенерированное из JSON |

Правило:

- источник истины — JSON;
- YAML обновляется из JSON;
- расхождение JSON и YAML не допускается.

---

## 3. Общие параметры

- OpenAPI 3.1.0.
- Base path: `/api/v1`.
- Формат: JSON UTF-8.
- Имена полей — `camelCase`.
- Идентификаторы — UUID.
- Дата и время — `date-time` RFC 3339.
- Даты — `date`.
- Ошибки — `application/problem+json`.
- Импорт — `multipart/form-data`.
- Экспорт — JSON/CSV binary.
- Пагинация — `limit`/`offset`.
- Максимум `limit` — 200.
- Идентификаторы запросов — `X-Request-ID`.
- Идемпотентность — `Idempotency-Key`.

---

## 4. Безопасность

### 4.1. Аутентификация

- `cookieAuth` — `__Host-session`.
- `rememberCookie` — `__Host-remember`, только для `/auth/restore`.
- Публичные маршруты:
  - `/auth/register`;
  - `/auth/login`;
  - `/auth/email/verify`;
  - `/auth/email/resend`;
  - `/auth/password/forgot`;
  - `/auth/password/reset`.

### 4.2. CSRF

Для unsafe-методов защищенных маршрутов обязателен `X-CSRF-Token`.

Для публичных auth-маршрутов и `/auth/restore` CSRF не требуется.

### 4.3. Идемпотентность

`Idempotency-Key` обязателен для изменяющих запросов, кроме:

- публичных auth-маршрутов;
- `/auth/restore`;
- `/auth/logout`;
- `/auth/logout-all`;
- завершения своей сессии.

---

## 5. Ошибки

Формат RFC 7807:

```json
{
  "type": "https://smart-oati.local/problems/validation",
  "title": "Ошибка валидации",
  "status": 400,
  "detail": "Поле name обязательно",
  "instance": "/api/v1/projects",
  "code": "validation_error",
  "traceId": "8f3c2f0e-...",
  "errors": [
    { "field": "name", "code": "required", "message": "Обязательное поле" }
  ]
}
```

Коды:

- `validation_error`;
- `csrf_invalid`;
- `auth.invalid_credentials`;
- `auth.email_not_verified`;
- `auth.account_locked`;
- `auth.account_blocked`;
- `auth.session_limit_reached`;
- `permission.denied`;
- `project.archived`;
- `project.delete_requires_archive`;
- `diagram.revision_conflict`;
- `import.too_large`;
- `rate_limited`;
- `internal_error`.

HTTP-коды:

- `400`, `401`, `403`, `404`, `405`, `409`, `410`, `412`, `413`, `415`, `423`, `429`, `500`, `503`, `504`.

---

## 6. Состав контракта

### 6.1. Объем

В контракте:

- **73 пути**;
- **11 тегов**;
- **73 схемы**;
- компоненты безопасности, параметров, ответов и заголовков.

### 6.2. Группы

| Группа | Назначение |
|--------|------------|
| Auth | Регистрация, вход, restore, сессии, пароли |
| Users | Пользователи и профили |
| Access | Роли, права, участники, приглашения |
| Executors | Каталог исполнителей и привязка |
| Projects | Проекты, архив, восстановление, владение |
| Diagrams | Диаграммы, snapshot, изменения |
| Plan | Направления, задачи, зависимости, праздники |
| Comments | Комментарии и упоминания |
| ImportExport | Асинхронный импорт и синхронный экспорт |
| Notifications | Уведомления, настройки, журнал доставки |
| Audit | Общий и привилегированный аудит |

---

## 7. REST ↔ gRPC

- Один REST-запрос → один gRPC-вызов.
- Gateway не агрегирует данные.
- CSRF, CORS, rate limit, session validation выполняет Gateway.
- gRPC-соединение защищено service-токеном/mTLS.
- `Set-Cookie` от User & Access передается клиенту.
- `Idempotency-Key` передается в gRPC metadata.
- `X-Request-ID` и `X-Correlation-ID` передаются в metadata.
- Ошибки gRPC транслируются в RFC 7807.

### 7.1. Ключевые маршруты

| REST | gRPC |
|------|------|
| `POST /auth/login` | `UserService.Login` |
| `POST /auth/restore` | `UserService.RestoreSession` |
| `GET /auth/session` | `UserService.GetCurrentUser` после проверки сессии Gateway |
| `GET /projects` | `ProjectService.ListProjects` |
| `POST /projects` | `ProjectService.CreateProject` |
| `GET /diagrams/{id}/snapshot` | `ProjectService.GetDiagramSnapshot` |
| `GET /diagrams/{id}/changes` | `ProjectService.ListDiagramChanges` |
| `POST /diagrams/{id}/import` | `ProjectService.StartImport` |
| `GET /import-jobs/{id}` | `ProjectService.GetImportStatus` |
| `GET /notifications` | `NotificationService.ListNotifications` |
| `GET /audit/events` | `AuditService.ListAuditEvents` |

---

## 8. Импорт и экспорт

### 8.1. Импорт

- `POST /diagrams/{diagramId}/import`.
- `multipart/form-data`.
- Поля: `format`, `file`.
- Форматы: JSON, CSV.
- Размер до 50 МБ.
- Ответ: `202` + `ImportJob`.
- Статус: `GET /import-jobs/{jobId}`.
- Отмена: `POST /import-jobs/{jobId}/cancel`.
- Неизвестные исполнители не создаются.
- Задачи без назначений попадают в `report`.
- Payload удаляется после обработки.

### 8.2. Экспорт

- `GET /diagrams/{diagramId}/export?format=json|csv`.
- Синхронный.
- Имена получаются из User & Access.
- Лимит 50 МБ.
- При превышении — `413`.

---

## 9. Аудит

- `GET /audit/events` — общий журнал.
- `GET /audit/privileged-events` — только администратор.
- `GET /audit/actions`.
- `GET /audit/stats`.
- Выгрузка отсутствует.
- Имена не обогащаются; frontend получает их через User & Access.
- `occurredAt` используется для точного поиска события в партиции.

---

## 10. Уведомления

- Пользователь видит только свои уведомления.
- Администратор видит журнал доставки.
- Выгрузка отсутствует.
- Настройки — по событию и каналу.
- Поддерживаются тихие часы и дайджест.
- Auth-письма не являются публичным REST-ресурсом.

---

## 11. Вне контракта

В OpenAPI не входят:

- `GET /health`, `GET /ready` — внутренние;
- Telegram webhook — прямой endpoint Notification;
- WebSocket/SSE — Sync;
- аналитика — отдельный read-only контур;
- внутренние gRPC-методы;
- события брокера;
- auth-письма как публичный API.

---

## 12. Проверка

Контракт проверен:

- JSON парсится;
- YAML парсится;
- все `$ref` разрешаются;
- Redocly lint: **valid, без предупреждений**;
- количество путей — 73;
- количество схем — 73.

Команды:

```text
redocly lint openapi.yaml
```

---

## 13. Версионирование

- Версия API — `/api/v1`.
- Ломающие изменения — `/api/v2`.
- Добавление полей — обратно совместимо.
- Удаление полей — только в новой версии.
- Устаревшие поля помечаются `deprecated`.
- Контракт и реализация версионируются вместе.

---

## 14. Критерии приемки

1. OpenAPI 3.1 JSON существует.
2. YAML соответствует JSON.
3. Все 73 пути описаны.
4. Все 73 схемы существуют.
5. Все `$ref` разрешаются.
6. Redocly lint проходит без ошибок и предупреждений.
7. Публичные auth-маршруты не требуют сессии.
8. `restore` использует remember-cookie.
9. CSRF описан для unsafe-маршрутов.
10. `Idempotency-Key` описан.
11. Ошибки — RFC 7807.
12. Пагинация единообразна.
13. Импорт — multipart + 202.
14. Экспорт — JSON/CSV.
15. Audit не содержит выгрузки.
16. Уведомления не содержат выгрузки.
17. Аналитика не входит в контракт.
18. Telegram webhook не входит в контракт.
19. WebSocket не входит в контракт.
20. Контракт пригоден для генерации клиента.

---

## 15. Открытые вопросы

Открытых вопросов по OpenAPI нет.







