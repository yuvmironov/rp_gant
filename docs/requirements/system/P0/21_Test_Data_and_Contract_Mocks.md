# P0: Test Data и Contract Mocks
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28  
**Статус:** draft for approval  
**Область:** seed-данные, fixtures, mock server, contract tests, E2E и нагрузочные данные  
**Связанные документы:** `P0/07_REST_gRPC_mapping.md`, `P0/10_План_тестирования.md`, `P0/19_API_Conventions_and_Error_Catalog.md`

---

## 1. Цели

- Дать frontend и backend одинаковые данные для параллельной разработки.
- Проверить все роли и состояния без ручной подготовки.
- Сделать E2E и contract tests воспроизводимыми.
- Исключить реальные персональные данные из тестов.

---

## 2. Принципы

- Все тестовые email — только `*.test`.
- Пароли — только dev/CI, не production.
- Данные детерминированы: фиксированные UUID и даты.
- Seed и fixtures идемпотентны.
- Для каждого состояния есть отдельный набор.
- Реальные ПДн запрещены.
- Fixtures версионируются вместе с контрактами.

---

## 3. Тестовые пользователи

Пароль для всех local/CI: `ChangeMeDevOnly!` (не использовать в staging/prod).

| Email | Роль | Статус | Назначение |
|---|---|---|---|
| `admin@smart-oati.test` | `app_admin` | active | Админ, privileged audit |
| `owner@smart-oati.test` | `project_owner` | active | Владелец проекта |
| `manager@smart-oati.test` | `project_manager` | active | Руководитель |
| `editor@smart-oati.test` | `project_editor` | active | Редактор |
| `participant@smart-oati.test` | `project_participant` | active | Участник |
| `viewer@smart-oati.test` | `project_viewer` | active | Наблюдатель |
| `blocked@smart-oati.test` | — | blocked | Проверка блокировки |
| `unverified@smart-oati.test` | — | email unverified | Проверка verification |
| `deleted@smart-oati.test` | — | deleted | Проверка удаления |

Требования:

- у всех заполнены фамилия, имя, отчество;
- timezone `Europe/Moscow`;
- locale `ru-RU`;
- у admin есть `app_admin`;
- у owner есть membership `project_owner`.

---

## 4. Проекты и диаграммы

| ID | Название | Состояние | Роль тестового пользователя |
|---|---|---|---|
| `10000000-0000-4000-8000-000000000001` | Внедрение SMART OATI | active | owner |
| `10000000-0000-4000-8000-000000000002` | Миграция данных | archived | owner |
| `10000000-0000-4000-8000-000000000003` | Архивный проект | deleted | owner |
| `10000000-0000-4000-8000-000000000004` | Чужой проект | active | нет доступа |
| `10000000-0000-4000-8000-000000000005` | Большой план | active | manager |

Диаграммы:

- `20000000-0000-4000-8000-000000000001` — основной план;
- `20000000-0000-4000-8000-000000000002` — пустая диаграмма;
- `20000000-0000-4000-8000-000000000003` — диаграмма с конфликтом ревизий;
- `20000000-0000-4000-8000-000000000004` — большой план для нагрузки.

Состав основного плана:

- 3 направления;
- 12 задач;
- 4 подзадачи;
- 6 зависимостей, включая критический путь;
- 2 просроченные задачи;
- 1 заблокированная;
- 1 задача без исполнителя;
- 1 задача с несвязанным исполнителем;
- 5 комментариев;
- 2 рабочих дня/праздника;
- 1 ревизия с конфликтом.

---

## 5. Состояния для UI

Обязательные fixtures:

- loading;
- empty projects;
- empty diagram;
- empty notifications (R2);
- error 500;
- 403;
- 404;
- no access;
- offline/sync lost;
- conflict banner;
- long project/task names;
- 50+ rows;
- audit with privileged events;
- import queued/processing/completed/failed.

---

## 6. Import fixtures

| Файл | Назначение |
|---|---|
| `project-export.v2.valid.json` | Валидный JSON v2 |
| `project-export.v2.minimal.json` | Минимальный набор полей |
| `project-export.v2.large.json` | Большой план |
| `project-export.v9.valid.json` | Legacy v9 |
| `project-export.v1.valid.json` | Legacy v1 |
| `project-export.v2.invalid.json` | Ошибка схемы |
| `project-export.v2.cycle.json` | Цикл зависимостей |
| `project-export.v2.csv` | CSV v2 |

Требования:

- файлы не содержат ПДн;
- даты фиксированы;
- ID стабильны;
- размер large — в пределах 50 МБ;
- ожидаемый результат и ошибки описаны в fixture manifest.

---

## 7. Mock server

### 7.1. REST

- Mock server генерируется из `openapi/openapi.yaml`.
- Инструмент: Prism или эквивалент.
- Порт local: `4010`.
- Поддержка примеров и схем.
- Auth/CSRF можно отключить только в mock-режиме.
- Ошибки 400/401/403/404/409/500 — по query parameter или отдельным сценариям.

### 7.2. WebSocket

- Mock Sync WS: subscribe, snapshot, diagram.changed, snapshot_required, ping/pong.
- Mock Notification WS: notification.created, unread-count, ping/pong.
- Сценарии конфликта и reconnect.
- Mock не заменяет integration tests.

### 7.3. Frontend

- MSW для component/unit tests.
- Prism — для локального mock API.
- Один источник fixtures.
- Не дублировать DTO вручную.

---

## 8. Contract tests

Проверять:

- текущий mapping содержит 97 записей; `health` и `getSyncToken` являются gateway-managed и не маппятся на gRPC (см. `docs/SPEC-STATUS.md`);
- request/response schemas;
- обязательные headers;
- error codes;
- event payloads против JSON Schema;
- proto ↔ OpenAPI mapping;
- generated clients соответствуют контрактам;
- WebSocket messages против AsyncAPI.

Правила:

- contract test падает при breaking change;
- fixture обновляется вместе с контрактом;
- mock и contract tests используют один набор examples.

---

## 9. E2E сценарии

1. Регистрация → verification → login.
2. Неверный пароль → lockout.
3. Reset password.
4. Session limit.
5. Owner создает проект.
6. Admin создает проект на другого владельца.
7. Owner приглашает участника; участник принимает.
8. Роли: manager/editor/participant/viewer.
9. Участник редактирует только назначенную задачу.
10. Зависимость с циклом отклоняется.
11. Критический путь отображается.
12. Комментарий и модерация.
13. Импорт v2 и legacy.
14. Экспорт JSON/CSV/PDF.
15. Два пользователя одновременно меняют диаграмму → конфликт.
16. Reconnect → snapshot.
17. Audit general/project/privileged.
18. Admin block/unblock/delete.
19. Ownership transfer.
20. Archive → delete → restore.
21. 403/404 для чужих объектов.
22. Admin без membership видит проект (ADR-008).

---

## 10. Load data

| Набор | Объем |
|---|---|
| Small | 1 проект, 100 задач |
| Medium | 10 проектов, 1 000 задач |
| Large | 50 проектов, 10 000 задач |
| Users | 100 |
| WS connections | 100 |
| Import | файл до 50 МБ |

Метрики:

- p95 чтения диаграммы;
- p95 сохранения;
- WS delivery;
- import duration;
- DB CPU/connections;
- Kafka lag.

---

## 11. Reset и изоляция

- `pnpm test:data:reset` — очистка и seed.
- CI использует Testcontainers и отдельную БД.
- E2E — отдельная БД/namespace.
- Staging seed не содержит тестовых паролей.
- Production seed — только системные роли/настройки.

---

## 12. Критерии приемки

1. Есть пользователи на все роли.
2. Есть проекты во всех состояниях.
3. Есть пустой, большой и конфликтный план.
4. Есть import fixtures v2/v9/v1 и invalid.
5. Mock server покрывает ключевые экраны.
6. Contract tests используют единые fixtures.
7. E2E проходит на чистом seed.
8. Нет реальных ПДн.
9. Reset воспроизводим.
10. Load data воспроизводимы.
