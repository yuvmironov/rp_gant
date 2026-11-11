# Changelog приложения RP Gant

Этот файл фиксирует изменения кода и поведения приложения. История изменений исходных требований ведётся отдельно в [`docs/requirements/changelog.md`](docs/requirements/changelog.md).

## Unreleased

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
