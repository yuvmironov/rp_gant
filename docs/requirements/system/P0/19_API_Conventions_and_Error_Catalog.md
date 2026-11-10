# P0: API Conventions и Error Catalog
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28  
**Статус:** draft for approval  
**Область:** публичные REST-конвенции, ошибки RFC 7807, идемпотентность, конкурентность, пагинация, gRPC-маппинг  
**Связанные документы:** `openapi/openapi.yaml`, `P0/07_REST_gRPC_mapping.md`, `P0/15_ADR_Package.md`

---

## 1. Базовые правила REST

- Base path: `/api/v1`.
- Формат: JSON, `Content-Type: application/json`.
- Кодировка: UTF-8.
- Имена полей: `camelCase`.
- Даты/время: ISO 8601 UTC, например `2026-10-28T10:42:11Z`.
- Даты без времени: `YYYY-MM-DD`.
- Идентификаторы: UUID.
- Перечисления: lowercase snake_case, если не указано иное.
- `null` и отсутствие поля различаются; PATCH не очищает поле без явного `null`.
- Все ответы содержат `X-Request-ID`.
- Ошибки — RFC 7807 `application/problem+json`.
- Версия API — только в path `/v1`; breaking change → `/v2` + ADR.

---

## 2. Аутентификация и заголовки

| Заголовок | Когда |
|---|---|
| `Cookie: __Host-session` | Все protected-запросы |
| `X-CSRF-Token` | Mutating-запросы |
| `Idempotency-Key` | Создание/изменение/импорт по правилам |
| `X-Request-ID` | Клиент может передать; иначе генерируется |
| `X-Correlation-ID` | Межсервисная трассировка; генерируется Gateway |
| `If-Match` | Optimistic concurrency для изменяемых ресурсов |
| `Accept-Language` | `ru-RU` по умолчанию |

Правила:

- Gateway проверяет cookie, CSRF, rate limit.
- Сервис повторно проверяет права.
- `Set-Cookie` от User & Access проходит через Gateway без изменений.
- Заголовки `X-User-*` от клиента не доверяются.

---

## 3. Пагинация, фильтры, сортировка

Списочные ответы:

```json
{
  "items": [],
  "page": {
    "total": 0,
    "limit": 50,
    "offset": 0
  }
}
```

Правила:

- `limit` по умолчанию 50, максимум 200.
- `offset` ≥ 0.
- `total` — общее число записей.
- Фильтры — query parameters, повторяемые значения через запятую.
- Сортировка — `sort=field` / `sort=-field`.
- Неизвестный параметр — `400 validation_failed`.
- Для больших списков аудита/уведомлений — те же `limit/offset`; cursor — только по ADR.

---

## 4. Идемпотентность

`Idempotency-Key` обязателен для:

- POST создания проекта/диаграммы/задачи/комментария;
- POST импорта;
- PUT/PATCH membership/roles;
- POST приглашений;
- POST restore/archive/delete;
- любых retry-опасных mutation.

Правила:

- ключ — UUID или opaque string 16–128 символов;
- хранится минимум 24 часа;
- повтор с тем же ключом возвращает тот же результат;
- другой payload с тем же ключом — `409 idempotency_conflict`;
- ключ не логируется как секрет.

---

## 5. Конкурентность

- Изменяемые ресурсы содержат `revision` или `etag`.
- Обновление требует `If-Match`/`revision`.
- Несовпадение — `409 revision_conflict` с текущей ревизией.
- Для диаграмм — `snapshot_required`, если backfill невозможен.
- Молчаливая перезапись запрещена.
- Конфликт фиксируется в аудите.

---

## 6. Ошибки RFC 7807

Формат:

```json
{
  "type": "https://smart-oati.local/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "Поле email имеет неверный формат",
  "instance": "/api/v1/auth/register",
  "code": "validation_failed",
  "traceId": "req_01J...",
  "errors": [
    { "field": "email", "code": "invalid_format" }
  ]
}
```

Обязательные поля: `type`, `title`, `status`, `code`.  
`detail`, `instance`, `traceId`, `errors` — по необходимости.

Правила:

- Не раскрывать stack trace, SQL, имена таблиц, секреты.
- Не раскрывать существование чужих объектов.
- Для 401 — не указывать, что именно неверно.
- `errors` — массив FieldError.

---

## 7. Error Catalog

| Code | HTTP | gRPC | Когда |
|---|---:|---|---|
| `validation_failed` | 400 | `INVALID_ARGUMENT` | Неверные поля/формат |
| `unsupported_media_type` | 415 | `INVALID_ARGUMENT` | Неверный Content-Type |
| `payload_too_large` | 413 | `RESOURCE_EXHAUSTED` | Превышен размер |
| `unauthenticated` | 401 | `UNAUTHENTICATED` | Нет/истекла сессия |
| `invalid_credentials` | 401 | `UNAUTHENTICATED` | Неверный email/пароль |
| `email_not_verified` | 403 | `PERMISSION_DENIED` | Email не подтвержден |
| `account_blocked` | 403 | `PERMISSION_DENIED` | Пользователь заблокирован |
| `session_expired` | 401 | `UNAUTHENTICATED` | Истекла сессия |
| `session_limit_reached` | 409 | `ABORTED` | Больше двух сессий |
| `csrf_invalid` | 403 | `PERMISSION_DENIED` | Нет/неверный CSRF |
| `permission_denied` | 403 | `PERMISSION_DENIED` | Нет прав |
| `not_found` | 404 | `NOT_FOUND` | Объект не найден/скрыт |
| `conflict` | 409 | `ABORTED` | Общий конфликт |
| `revision_conflict` | 409 | `ABORTED` | Устаревшая ревизия |
| `idempotency_conflict` | 409 | `ABORTED` | Тот же ключ, другой payload |
| `snapshot_required` | 409 | `FAILED_PRECONDITION` | Нужен snapshot |
| `ownership_transfer_required` | 409 | `FAILED_PRECONDITION` | Нельзя удалить владельца |
| `last_admin` | 409 | `FAILED_PRECONDITION` | Нельзя снять последнего админа |
| `dependency_cycle` | 422 | `FAILED_PRECONDITION` | Цикл зависимостей |
| `project_archived` | 409 | `FAILED_PRECONDITION` | Проект в архиве |
| `project_not_archived` | 409 | `FAILED_PRECONDITION` | Удаление не из архива |
| `invitation_expired` | 410 | `FAILED_PRECONDITION` | Приглашение истекло |
| `import_invalid` | 422 | `INVALID_ARGUMENT` | Файл не прошел валидацию |
| `import_too_large` | 413 | `RESOURCE_EXHAUSTED` | Импорт > 50 МБ |
| `import_failed` | 500 | `INTERNAL` | Импорт упал |
| `rate_limited` | 429 | `RESOURCE_EXHAUSTED` | Лимит |
| `service_unavailable` | 503 | `UNAVAILABLE` | Зависимость недоступна |
| `internal_error` | 500 | `INTERNAL` | Непредвиденная ошибка |

Коды — стабильный контракт. Новый код требует обновления OpenAPI и frontend-обработки.

---

## 8. gRPC-маппинг

| gRPC | HTTP |
|---|---|
| `INVALID_ARGUMENT` | 400 |
| `UNAUTHENTICATED` | 401 |
| `PERMISSION_DENIED` | 403 |
| `NOT_FOUND` | 404 |
| `ALREADY_EXISTS` / `ABORTED` | 409 |
| `FAILED_PRECONDITION` | 409/422 по коду |
| `RESOURCE_EXHAUSTED` | 413/429/503 |
| `UNAVAILABLE` | 503 |
| `DEADLINE_EXCEEDED` | 504 |
| `INTERNAL` | 500 |

Правила:

- gRPC status не пробрасывается клиенту напрямую.
- Gateway/SDK преобразует в RFC 7807.
- `details` не содержат внутренних путей/секретов.
- `traceId` сохраняется.

---

## 9. Rate limits

- 300/мин на пользователя.
- 60/мин на IP.
- 10/мин на auth-маршруты.
- 50 МБ — импорт.
- 10 МБ — обычное тело.
- `429` содержит `Retry-After`.
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## 10. Валидация

- Валидация на Gateway — только формат/размер/CSRF.
- Бизнес-валидация — в сервисе.
- Ошибки полей — массив `errors`.
- Сообщения — на русском для UI; коды — стабильные.
- Не логировать значения паролей, токенов, cookie.
- Не принимать неизвестные поля в strict DTO (или игнорировать по контракту — единообразно).

---

## 11. Форматы домена

- `progress` — 0–100.
- `status` — `planned`, `in_progress`, `done`, `blocked`.
- `priority` — `low`, `medium`, `high`, `critical`.
- `role` — фиксированные коды.
- `timezone` — IANA, например `Europe/Moscow`.
- `locale` — `ru-RU`.
- `jiraIssueKey` — строка, без интеграции.
- `revision` — целое, монотонно растет.

---

## 12. Критерии приемки

1. Все ошибки соответствуют RFC 7807.
2. Все коды из каталога есть в OpenAPI/frontend.
3. `Idempotency-Key` работает и покрыт тестами.
4. `If-Match`/revision защищает от потери данных.
5. gRPC-ошибки не утекают наружу.
6. Нет PII/секретов в ошибках и логах.
7. Пагинация и сортировка единообразны.
8. Контрактные тесты проверяют error mapping.
