# P0: шаблоны и матрица уведомлений
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28

---

## 1. Артефакты

```text
Исходные кодв/notifications/templates/
  manifest.json
  <template_code>.html
  <template_code>.txt
```

Отправитель в шаблонах не указан. Он задается конфигурацией Notification Service.

---

## 2. Шаблоны

| Код | Назначение | Получатель |
|-----|------------|------------|
| `email_verification` | Подтверждение email | Регистрируемый пользователь |
| `password_reset` | Сброс пароля | Пользователь |
| `project_invitation` | Приглашение в проект | Приглашенный email |
| `account_activation` | Активация после создания админом | Пользователь |
| `task_assigned` | Назначение задачи | Ответственный, исполнитель, соисполнители |
| `task_reassigned` | Изменение назначения | Затронутый участник |
| `due_soon` | Скоро срок | Ответственный, исполнитель, соисполнители |
| `overdue` | Просрочка | Ответственный, исполнитель, соисполнители |
| `task_blocked` | Задача заблокирована | Ответственный, исполнитель, владелец |
| `task_completed` | Задача завершена | Ответственный, владелец |
| `comment_added` | Новый комментарий | Ответственный, исполнитель |
| `comment_mention` | Упоминание | Упомянутый пользователь |
| `project_member_added` | Добавление в проект | Добавленный пользователь |
| `dependency_violated` | Нарушение зависимости | Владелец, руководитель, ответственный |
| `critical_path_changed` | Изменение критического пути | Владелец, руководитель, ответственный |
| `import_completed` | Импорт завершен | Инициатор |
| `import_failed` | Ошибка импорта | Инициатор |

---

## 3. Матрица событий

| Событие | Каналы | Шаблон | Критическое |
|---------|--------|--------|-------------|
| `task.assignments.changed` | internal, email, telegram | `task_assigned` / `task_reassigned` | Нет |
| `due_soon` scheduler | internal, email, telegram | `due_soon` | Нет |
| `overdue` scheduler | internal, email, telegram | `overdue` | Да |
| `task.updated` → blocked | internal, email, telegram | `task_blocked` | Да |
| `task.updated` → done | internal, email | `task_completed` | Нет |
| `comment.created` | internal, email | `comment_added` | Нет |
| `comment.created` + mention | internal, email, telegram | `comment_mention` | Нет |
| `project.member.added` | internal, email | `project_member_added` | Нет |
| `dependency.violated` | internal, email, telegram | `dependency_violated` | Да |
| `diagram.critical_path.changed` | internal, email, telegram | `critical_path_changed` | Да |
| `diagram.import.completed` | internal, email | `import_completed` | Нет |
| `diagram.import.failed` | internal, email | `import_failed` | Да |
| Auth email request | email | Соответствующий auth-шаблон | — |

---

## 4. Настройки по умолчанию

- internal — включен;
- email — включен для критических, остальное по желанию;
- Telegram — выключен до привязки;
- тихие часы — 22:00–08:00;
- критические события игнорируют тихие часы;
- дайджест — ежедневно в 09:00;
- еженедельный дайджест не используется;
- три попытки доставки: сразу, 1 минута, 15 минут.

---

## 5. Переменные шаблонов

Общие:

- `displayName`;
- `projectName`;
- `taskName`;
- `actionUrl`;
- `expiresAt`;
- `roleName`;
- `authorName`;
- `dueDate`;
- `errorMessage`;
- `taskCount`;
- `issueCount`;
- `criticalTaskCount`;
- `predecessorName`;
- `successorName`.

Правила:

- значения экранируются при HTML-рендеринге;
- ссылки ведут на frontend;
- секреты и токены в тексте не логируются;
- тема письма не содержит ПДн больше необходимого;
- отправитель не зашит в шаблон.

---

## 6. Auth-письма

| Код | Тема |
|-----|------|
| `email_verification` | Подтвердите email в SMART OATI |
| `password_reset` | Сброс пароля в SMART OATI |
| `project_invitation` | Приглашение в проект |
| `account_activation` | Активация учетной записи |

Auth-письма:

- не создают внутреннее уведомление;
- идемпотентны по `jobId`;
- хранятся в `auth_email_deliveries`;
- доставляются через Notification Service;
- 3 попытки;
- отправитель задается конфигурацией.

---

## 7. Telegram

- только личные чаты;
- текст без HTML или с безопасным экранированием;
- до 4096 символов;
- при 429 учитывается `retry_after`;
- при 403 — fallback email/internal;
- бот не хранит привязку.

---

## 8. Критерии приемки

1. Все 17 шаблонов имеют `.html` и `.txt`.
2. `manifest.json` содержит subject, variables, paths.
3. Нет отправителя внутри шаблонов.
4. Все переменные документированы.
5. Матрица событие → шаблон заполнена.
6. Критические события обходят тихие часы.
7. Auth-письма идемпотентны по `jobId`.
8. Три попытки доставки.
9. Telegram использует только личные чаты.
10. HTML-переменные экранируются.
