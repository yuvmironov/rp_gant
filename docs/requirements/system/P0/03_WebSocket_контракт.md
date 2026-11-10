# P0: WebSocket-контракты Sync / Realtime и Notification
## SMART OATI

**Версия:** 1.0  
**Дата исходного документа:** 2026-10-28

> **Статус:** описанный ниже cookie/subscribe/backfill протокол — проектное требование, не текущая реализация. Sync сейчас использует `GET /api/v1/sync/token` и `/ws?token=...` без subscribe/unsubscribe; `/ws/notifications` не реализован. Для фактических форматов используйте `sync/asyncapi.yaml`, `notifications/asyncapi.yaml` и [`docs/IMPLEMENTATION-STATUS.md`](../../../IMPLEMENTATION-STATUS.md).

---

## 1. Артефакты

Текущие репозиторные схемы (не все описывают реализованный endpoint):

- `sync/asyncapi.yaml`;
- `sync/schemas/connected.schema.json`;
- `sync/schemas/diagram-changed.schema.json`;
- `sync/schemas/error.schema.json`;
- `sync/schemas/ping.schema.json`;
- `sync/schemas/pong.schema.json`;
- `notifications/asyncapi.yaml` — planned;
- `notifications/schemas/notification-created.schema.json`;
- `notifications/schemas/unread-count.schema.json`;
- `notifications/schemas/error.schema.json`;
- `notifications/schemas/ping.schema.json`;
- `notifications/schemas/pong.schema.json`.

---

## 2. Подключение

- URL: `wss://<host>/ws`.
- Аутентификация: `__Host-session`.
- Проверка `Origin`.
- Только WebSocket.
- CSRF не применяется.
- Подключение проверяет сессию через User & Access.
- Сессия проверяется каждые 60 секунд.
- `ping/pong` не продлевает idle-сессию.

---

## 3. Сообщения

### 3.1. Клиент → сервер

`subscribe`:

```json
{
  "type": "subscribe",
  "requestId": "uuid",
  "diagramId": "uuid",
  "lastRevision": 42
}
```

`unsubscribe`:

```json
{
  "type": "unsubscribe",
  "requestId": "uuid",
  "diagramId": "uuid"
}
```

`ping`:

```json
{ "type": "ping", "requestId": "uuid" }
```

### 3.2. Сервер → клиент

`subscribed`:

```json
{
  "type": "subscribed",
  "requestId": "uuid",
  "diagramId": "uuid",
  "projectId": "uuid",
  "currentRevision": 42
}
```

`diagram.changed`:

```json
{
  "type": "diagram.changed",
  "version": 1,
  "diagramId": "uuid",
  "revision": 43,
  "entityType": "task",
  "entityId": "uuid",
  "operation": "update",
  "payload": {},
  "actorUserId": "uuid",
  "occurredAt": "2026-10-28T10:00:00Z"
}
```

`snapshot_required`:

```json
{
  "type": "snapshot_required",
  "requestId": "uuid",
  "diagramId": "uuid",
  "reason": "revision_gap"
}
```

`error`:

```json
{
  "type": "error",
  "requestId": "uuid",
  "code": "permission_denied",
  "message": "Нет доступа",
  "recoverable": false
}
```

`pong`:

```json
{ "type": "pong", "requestId": "uuid" }
```

---

## 4. Жизненный цикл

1. Клиент получает snapshot через REST.
2. Клиент подключается к `/ws`.
3. Sync проверяет сессию и Origin.
4. Клиент отправляет `subscribe` с `lastRevision`.
5. Sync проверяет доступ через Project / Diagram.
6. Sync догружает изменения.
7. Клиент получает `subscribed` и `diagram.changed`.
8. При разрыве — reconnect с `lastRevision`.
9. При недоступной истории — `snapshot_required`.

---

## 5. Backfill

- `ListDiagramChanges(diagramId, fromRevision)`.
- Сообщения отправляются по возрастанию `revision`.
- Если `revision` пришел с пропуском — backfill.
- Если backfill невозможен — `snapshot_required`.
- Клиент дедуплицирует по `diagramId + revision`.
- Сообщение старше уже примененной ревизии игнорируется.

---

## 6. Ограничения

| Параметр | Значение |
|----------|----------|
| WebSocket на пользователя | 5 |
| На одну сессию | 2 |
| Размер сообщения | 1 МБ |
| Heartbeat | 30 секунд |
| Нет pong | 60 секунд |
| Проверка сессии | 60 секунд |

---

## 7. Close-коды

| Код | Причина |
|-----|---------|
| `1001` | Нет pong |
| `1009` | Сообщение слишком большое |
| `4401` | Сессия истекла/отозвана |
| `4403` | Нет доступа |
| `4404` | Диаграмма не найдена |
| `4429` | Превышен лимит подключений |
| `4503` | Зависимость недоступна |

---

## 8. Reconnect

- Клиент использует экспоненциальную задержку: 1, 2, 5, 10, 30 секунд.
- Максимум попыток — не ограничен, пока сессия активна.
- При `4401` клиент восстанавливает сессию через API.
- При `4403` повторная подписка запрещена.
- При `snapshot_required` клиент заново получает snapshot.
- `lastRevision` сохраняется на клиенте.

---

## 9. Безопасность

- Только WSS.
- Cookie `__Host-session`.
- Origin allowlist.
- Нет токена в query.
- Проверка доступа к диаграмме.
- Лимиты сообщений и подключений.
- Логи без payload и cookie.
- Сервис не хранит бизнес-данные.

---

## 10. Критерии приемки

1. AsyncAPI валиден.
2. Все сообщения имеют JSON Schema.
3. `subscribe` проверяет сессию и доступ.
4. `lastRevision` запускает backfill.
5. При разрыве истории — `snapshot_required`.
6. `diagram.changed` содержит полный объект.
7. Ревизии обрабатываются по порядку.
8. Дубликаты не применяются.
9. Лимиты и close-коды соблюдаются.
10. Reconnect не теряет ревизию.
11. Origin и cookie проверяются.
12. Payload не пишется в логи.
---

## 11. WebSocket уведомлений

- Отдельный от Sync endpoint: `wss://<host>/ws/notifications`.
- Аутентификация: `__Host-session`.
- Проверка Origin.
- Одно соединение на пользователя.
- Сервер отправляет `notification.created` и `unread_count`.
- Клиент отправляет только `ping`.
- Настройки и список уведомлений загружаются через REST.
- Сессия проверяется каждые 60 секунд.
- Ping/pong не продлевает idle-сессию.
- Close-коды: 4401, 4403, 4429, 4503.
- Reconnect: 1, 2, 5, 10, 30 секунд.
- После reconnect — `ListNotifications` и `GetUnreadCount`.
- Лимит сообщения — 1 МБ.
---

## 12. Критерии Notification WebSocket

1. Аутентификация через __Host-session.
2. Origin проверяется.
3. Одно соединение на пользователя.
4. 
otification.created доставляется.
5. unread_count обновляется.
6. Сессия проверяется каждые 60 секунд.
7. Истечение сессии закрывает 4401.
8. Reconnect не теряет уведомления.
9. После reconnect выполняется REST-синхронизация.
10. Payload не пишется в логи.
