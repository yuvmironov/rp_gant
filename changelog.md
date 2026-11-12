# Changelog приложения RP Gant

Этот файл фиксирует изменения кода и поведения приложения. История изменений исходных требований ведётся отдельно в [`docs/requirements/changelog.md`](docs/requirements/changelog.md).

## Unreleased

### Назначения задач и ответственные направлений

- Ответственный допускается только у направления и может быть только активным участником проекта; у задач и подзадач остались исполнитель и до двух соисполнителей — участники текущего проекта.
- Каталожные назначения задач больше нельзя создавать. Legacy catalog assignments для задач остаются видимыми до явной замены; task-level `responsible` переносится в `executor` с приоритетом уже заданного исполнителя.
- Добавлены dry-run/apply backfill с подробным отчётом и миграция `0008_assignment_roles_by_entity.sql`; импорт/экспорт JSON/CSV и REST-контракты различают направления и задачи.

### Пагинация административных списков

- В `/admin` списки пользователей и исполнителей используют серверную пагинацию через `limit`/`offset`; размер страницы можно выбрать — 5 или 10 записей. Счётчик показывает диапазон записей и общее количество из ответа API.
- Поиск пользователей возвращает на первую страницу; после удаления последнего элемента страница автоматически ограничивается последней доступной.
- Форма создания исполнителя адаптируется к ширине экрана. Таблица сохраняет колонки в горизонтально прокручиваемой области, выравнивает действия и переносит длинный ID связанного пользователя.

### Надёжность событий и staging readiness

- Все Kafka consumers используют bounded retry (5 доставок всего, паузы 1/2/5/10 секунд), DLQ и метрики; Audit, Notification и Sync имеют dry-run/approval-gated replay в отдельные service topics.
- Consumer side effects/processed-event markers фиксируются транзакционно; Sync dedup ledger вынесен в отдельную `rp_gant_sync` БД.
- Добавлены Kafka TLS/SASL options с обязательным TLS для SASL, optional CA и staging-only per-service Vault principals; локальный Kafka остаётся без TLS/SASL.
- Helm staging values задают canonical topic, обязательный bootstrap endpoint, Sync URL/migration и `/ws` ingress; digest/bootstrap guard и Helm render checks включены в required CI. Production Sync DB/security остаются opt-out.
- Добавлены Prometheus Kafka Exporter, DLQ/outbox alerts и Grafana dashboard panels; restore drill проверяет пять баз, включая Sync ledger.
- E2E auth-сценарии используют отдельные тестовые учётные записи и завершают admin-сессии, чтобы повторные прогоны не упирались в лимит двух активных сессий seed-администратора.
- После локальной пересборки `local:health`, restore drill всех пяти БД и полный Playwright E2E (20/20) прошли; unit — 118 тестов.
- VPS Compose подключает выделенную `rp_gant_sync`, ждёт `db-init`, проверяет Sync health и создаёт все DLQ/replay topics; CI валидирует sample-config без реальных секретов.
- Production VPS rollout выполнен 2026-11-11 на release `b75c853` после owner-confirmed staging acceptance: миграции прошли, все контейнеры healthy, внешние app/Sync health — 200, Kafka topics проверены. Pre/post deployment backups восстановлены в изолированной проверке.
- Внешний WebSocket route отклонил invalid-token handshake кодом 401; authenticated 101 handshake и реальные auth-email/replay события в production не проверялись.
- Kubernetes staging rollout не выполнялся; prepared staging deployment/acceptance/rollback runbook остаётся для будущего managed-cluster rollout.

### Глобальный доступ `app_admin` по ADR-008

- User Service сообщает отдельный `is_admin` flag в `ListAccessibleProjectIds`; Project Service возвращает все проекты администратору, не запрашивая данные напрямую из User DB.
- Добавлены regression tests для администратора без membership и для сохранения 403 на прямом серверном вызове без permission.

### Auth-письма по ADR-010

- User Service создаёт durable `auth_email_jobs` вместе с auth-операциями и передаёт их в Notification Service по gRPC с повторными попытками.
- Notification Service идемпотентно принимает задания, рендерит verification/reset/activation/invitation шаблоны, отправляет SMTP и сохраняет журнал попыток с backoff.
- SMTP-конфигурация удалена из User Service; local mail доставляет Notification Service через Mailpit. Production rollout не выполнялся.

## 2026-11-10

### Исправления входа — PR #142

- Текст ответа при запросе сброса пароля теперь одинаков для существующего и неизвестного адреса: интерфейс не раскрывает наличие учётной записи.
- Удалена публичная подсказка с локальным адресом development-администратора.

### Исправления сессий — PR #143

- Истёкшие по idle- или абсолютному сроку сессии, у которых нет действующего remember-токена, больше не учитываются в лимите двух активных сессий; устаревшие записи отзываются при следующем входе/проверке или миграции.
- Миграция `0002_session_idle_expiration.sql` приводит существующие remember-сессии в соответствие с idle-сроком и отзывает уже истёкшие записи.
- Проверка и восстановление remember-сессий теперь соблюдают idle-срок; активность, продлевающая сессию, продлевает и remember idle deadline.
- Исправлен HTTP 500 у авторизованного `GET /api/v1/auth/session`: nullable timestamp в SQL обновляется с явным типом `timestamptz`.
- VPS runbook дополнен резервным копированием БД и явным запуском миграций перед обновлением сервисов.
- README User Service, API Gateway и implementation status описывают TTL, лимит активных сессий, ответы `401` и восстановление remember-сессии.
- Nuxt-форма входа передаёт состояние чекбокса «Запомнить меня»; при истёкшей access-сессии или после перезапуска браузера login-страница восстанавливает сессию по remember-cookie и возвращает пользователя в проекты.
- Создан корневой `changelog.md` для изменений приложения; история изменений требований остаётся в `docs/requirements/changelog.md`.

### Форма «Запомнить меня»

- Чекбокс связан с `rememberMe` в запросе входа; снятый флажок создаёт обычную сессию без remember-cookie.
- При открытии страницы входа после истечения access-сессии фронтенд вызывает `POST /api/v1/auth/restore`; если remember-cookie ещё действителен, пользователь возвращается в проекты без повторного ввода пароля.
- Обычный выход по-прежнему отзывает сессию и очищает access-, remember- и CSRF-cookie.

## 2026-11-11

### Старт hardening-этапа

- Gateway и Sync Service больше не используют общий `local-sync-secret` вне local/development/test; production startup требует настроенный секрет и отклоняет известный шаблон из `.env.example`.
- Local Compose теперь передаёт development sync-secret и повышенный `RATE_LIMIT_MAX=1000` для последовательного E2E-набора с общим IP; production-лимит не менялся.
- Kafka publishers/consumers используют общий fallback `rp_gant.events`, совпадающий с Compose.
- User и Project outbox publishers сохраняют snapshot `actor_roles` для Audit, включая роль до её изменения у актёра.
- Contract check сравнивает REST `operationId` с gRPC mapping; единственные явные исключения — gateway-managed `health` и `getSyncToken`.
