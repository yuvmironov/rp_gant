# P0: REST ↔ gRPC mapping
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28

---

## 1. Артефакт

```text
Исходные кодв/contracts/rest-grpc-map.yaml
```

Контракт:

- `Исходные кодв/openapi/openapi.json`;
- `Исходные кодв/openapi/openapi.yaml`.

---

## 2. Правило

- один REST-запрос → один gRPC-вызов;
- Gateway не агрегирует данные;
- Gateway выполняет CORS, CSRF, rate limit, session validation;
- `Set-Cookie` от User & Access передается клиенту;
- `Idempotency-Key` передается в metadata;
- `X-Request-ID` и `X-Correlation-ID` передаются в metadata;
- gRPC-ошибки преобразуются в RFC 7807.

---

## 3. Группы

| REST | gRPC-сервис |
|------|-------------|
| `/auth/*` | UserService |
| `/users/*` | UserService |
| `/roles`, `/permissions` | UserService |
| `/executors/*` | UserService |
| `/projects/*` | ProjectService / UserService по подпути |
| `/diagrams/*` | ProjectService |
| `/directions/*` | ProjectService |
| `/tasks/*` | ProjectService |
| `/dependencies/*` | ProjectService |
| `/comments/*` | ProjectService |
| `/invitations/*` | UserService |
| `/notifications/*` | NotificationService |
| `/audit/*` | AuditService |

---

## 4. Особые маршруты

| REST | gRPC |
|------|------|
| `GET /auth/session` | `UserService.GetCurrentUser` после проверки сессии Gateway |
| `POST /auth/restore` | `UserService.RestoreSession` |
| `GET /projects/{id}/members` | `UserService.ListProjectMembers` |
| `POST /projects/{id}/invitations` | `UserService.CreateInvitation` |
| `POST /diagrams/{id}/import` | `ProjectService.StartImport` |
| `GET /import-jobs/{id}` | `ProjectService.GetImportStatus` |
| `GET /diagrams/{id}/export` | `ProjectService.ExportDiagram` |
| `GET /audit/events` | `AuditService.ListAuditEvents` |
| `GET /audit/privileged-events` | `AuditService.ListPrivilegedAuditEvents` |

---

## 5. Исправление маршрутов

Фактические пути OpenAPI:

- импорт — `POST /diagrams/{diagramId}/import`;
- статус импорта — `GET /import-jobs/{jobId}`;
- отмена — `POST /import-jobs/{jobId}/cancel`;
- экспорт — `GET /diagrams/{diagramId}/export`;
- праздники — `GET|PUT /diagrams/{diagramId}/holidays`.

Старые групповые записи `/api/v1/import/*`, `/api/v1/export/*`, `/api/v1/holidays/*` считаются устаревшими.

---

## 6. Контрактные тесты

Для каждого `operationId`:

1. проверить наличие в OpenAPI;
2. проверить наличие в mapping;
3. проверить существование gRPC-метода;
4. проверить обязательные параметры;
5. проверить обязательные headers;
6. проверить error mapping;
7. проверить отсутствие лишней агрегации.

Минимальные проверки:

- в текущем `contracts/rest-grpc-map.yaml` 97 записей; `health` и `getSyncToken` — gateway-managed операции без gRPC mapping. Точный статус — `docs/SPEC-STATUS.md`;
- у каждой операции, включённой в mapping, есть ровно один gRPC-метод;
- публичные auth-маршруты не требуют cookie;
- protected-маршруты требуют cookie;
- unsafe-маршруты требуют CSRF;
- mutation-маршруты требуют `Idempotency-Key` по правилам;
- import возвращает 202;
- export возвращает файл.

---

## 7. Критерии приемки

1. Mapping содержит все применимые operationId; gateway-managed операции явно исключены.
2. Нет неизвестных gRPC-методов.
3. Gateway не агрегирует ответы. Текущее исключение к целевой схеме: Gateway вызывает Notification и Audit по внутреннему HTTP; см. `docs/IMPLEMENTATION-STATUS.md`.
4. `Set-Cookie` передается.
5. Ошибки gRPC → HTTP корректны.
6. Импорт/экспорт и праздники используют актуальные пути.
7. Контрактные тесты проходят.


