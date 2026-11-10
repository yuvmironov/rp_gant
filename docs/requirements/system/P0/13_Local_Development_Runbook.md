# P0: Local Development Runbook
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28  
**Область:** локальная разработка full-stack приложения

---

## 1. Целевой сценарий

- Кросс-платформенный runbook.
- Основные ОС: Windows 11, macOS, Linux.
- **Все приложения и инфраструктура запускаются в Docker Compose.**
- Инфраструктура: PostgreSQL latest, Redis, Kafka, Mailpit, mock Telegram, Traefik.
- Приложения: API Gateway, User & Access, Project / Diagram, Notification, Audit, Sync / Realtime, Frontend Nuxt SSR.
- HTTPS локально через `mkcert`.
- Пакетный менеджер — `pnpm`.
- Node.js 22 LTS.

---

## 2. Рекомендации по локальной машине

### 2.1. Минимально

- 4 CPU;
- 16 ГБ RAM;
- 60 ГБ свободного SSD;
- Docker Desktop/Engine с Compose v2;
- современный браузер.

### 2.2. Рекомендуется

- 8 CPU;
- 32 ГБ RAM;
- 100 ГБ SSD;
- Docker Desktop с WSL2 backend на Windows;
- отдельный профиль Docker для проекта.

### 2.3. Windows

- Windows 11 22H2+.
- Включена виртуализация в BIOS/UEFI.
- WSL2 установлен.
- Docker Desktop: WSL2 backend, 8–12 ГБ памяти.
- Репозиторий лучше держать в файловой системе WSL (`~/projects/...`), а не на `/mnt/c`.
- Если репозиторий остается на `D:`, включить file sharing в Docker Desktop.
- Добавить исключения антивируса для репозитория, WSL и Docker volumes.
- `git config --global core.autocrlf input` и `.gitattributes` с LF.

### 2.4. macOS

- macOS 14+.
- Docker Desktop с 8–12 ГБ памяти.
- На Apple Silicon использовать multi-arch images; при необходимости `platform: linux/arm64`.

### 2.5. Linux

- Docker Engine + Docker Compose plugin.
- Пользователь в группе `docker`.
- 8–12 ГБ памяти для Docker.
- Свободные порты 80/443.

---

## 3. Установка инструментов на host

Обязательно:

- Git;
- Docker Desktop/Engine + Compose v2;
- Node.js 22 LTS через `fnm`/`nvm`;
- pnpm через Corepack;
- mkcert.

Опционально:

- `kcat` для Kafka;
- Kafka UI;
- `jq`;
- VS Code + Dev Containers.

Команды:

```text
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
node --version
docker --version
docker compose version
mkcert -version
```

Ожидаемо:

- Node.js 22.x;
- pnpm 10.x;
- Docker Compose v2;
- mkcert установлен.

---

## 4. Клонирование и подготовка репозитория

```text
git clone <repo-url> smart-oati
cd smart-oati
pnpm install
```

Рекомендуемая структура:

```text
apps/
  api-gateway/
  user-service/
  project-service/
  notification-service/
  audit-service/
  sync-service/
  frontend/
packages/
  shared/
  proto/
infrastructure/
  local/
    docker-compose.yml
    .env.example
    traefik/
    postgres/init/
    telegram-mock/
```

Правила:

- `.env.local` не коммитится;
- `certs/` не коммитится;
- `node_modules/` не коммитится;
- `generated/` не коммитится;
- LF line endings.

---

## 5. Локальные домены и HTTPS

Установить доверие mkcert:

```text
mkcert -install
```

Сгенерировать сертификат:

```text
mkdir certs
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem "*.localhost" localhost 127.0.0.1 ::1
```

Домены:

| Домен | Назначение |
|-------|------------|
| `app.localhost` | Nuxt frontend |
| `api.localhost` | API Gateway |
| `sync.localhost` | Sync WebSocket |
| `notify.localhost` | Notification API/WebSocket/webhook |
| `mail.localhost` | Mailpit UI |
| `kafka.localhost` | Kafka UI, опционально |

Если `*.localhost` не резолвится в вашей ОС, добавить в hosts:

```text
127.0.0.1 app.localhost api.localhost sync.localhost notify.localhost mail.localhost kafka.localhost
```

Проверить:

```text
curl -k https://api.localhost/health
```

---

## 6. Переменные окружения

Создать `.env.local` из `.env.example`.

Основные переменные:

| Переменная | Назначение |
|------------|------------|
| `POSTGRES_USER` | Пользователь PostgreSQL |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL local |
| `POSTGRES_DB` | Основная БД |
| `DATABASE_URL_USER` | User & Access DB |
| `DATABASE_URL_PROJECT` | Project / Diagram DB |
| `DATABASE_URL_NOTIFICATION` | Notification DB |
| `DATABASE_URL_AUDIT` | Audit DB |
| `REDIS_URL` | Redis |
| `KAFKA_BROKERS` | `kafka:9092` |
| `KAFKA_TOPIC` | `smartoati.events` |
| `SMTP_HOST` | `mailpit` |
| `SMTP_PORT` | `1025` |
| `TELEGRAM_API_BASE` | `http://telegram-mock:8080` |
| `TELEGRAM_BOT_TOKEN` | dev placeholder |
| `TELEGRAM_WEBHOOK_SECRET` | dev placeholder |
| `NUXT_PUBLIC_API_BASE` | `https://api.localhost/api/v1` |
| `NUXT_PUBLIC_SYNC_WS` | `wss://sync.localhost/ws` |
| `NUXT_PUBLIC_NOTIFICATION_WS` | `wss://notify.localhost/ws/notifications` |
| `CORS_ORIGINS` | `https://app.localhost` |
| `DEV_ADMIN_EMAIL` | Первый администратор |
| `DEV_ADMIN_PASSWORD` | Пароль только для local |

Правила:

- реальные секреты не использовать;
- `.env.local` в `.gitignore`;
- dev-пароль не коммитить;
- Telegram — mock, реальный бот не обязателен.

---

## 7. Docker Compose

### 7.1. Профили

- `infra` — PostgreSQL, Redis, Kafka, Kafka UI, Mailpit, Telegram mock, Traefik.
- `apps` — API Gateway, User, Project, Notification, Audit, Sync, Frontend.
- `all` — infra + apps.

### 7.2. Инфраструктура

| Сервис | Внутренний адрес | Host-порт |
|--------|------------------|-----------|
| PostgreSQL latest | `postgres:5432` | `5432` |
| Redis | `redis:6379` | `6379` |
| Kafka | `kafka:9092` | `9092` |
| Kafka UI | `kafka-ui:8080` | `8081` |
| Mailpit SMTP | `mailpit:1025` | `1025` |
| Mailpit UI | `mailpit:8025` | `8025` |
| Telegram mock | `telegram-mock:8080` | не публикуется |
| Traefik | `traefik:443` | `80/443` |

### 7.3. PostgreSQL

- один контейнер;
- базы: `smart_oati_user`, `smart_oati_project`, `smart_oati_notification`, `smart_oati_audit`;
- init-скрипт создает базы;
- volume `postgres_data`;
- `postgres:latest` только для local; CI/staging пиновать по digest.

### 7.4. Kafka

- один KRaft-брокер;
- topic `smartoati.events`;
- partitions — 6;
- replication factor — 1;
- Kafka UI — опционально;
- init-контейнер создает topic.

### 7.5. Traefik

- HTTPS entrypoint 443;
- HTTP 80 redirect на HTTPS;
- сертификат `certs/local.pem`;
- маршруты:
  - `app.localhost` → frontend:3000;
  - `api.localhost` → api-gateway:8080;
  - `sync.localhost` → sync:8080;
  - `notify.localhost` → notification:8080;
  - `mail.localhost` → mailpit:8025;
  - `kafka.localhost` → kafka-ui:8080.

### 7.6. Приложения

- каждый сервис — отдельный контейнер;
- dev Dockerfile;
- bind mount исходников;
- `pnpm --filter <service> dev`;
- отдельный volume для `node_modules`;
- file watching: polling на Windows/WSL при необходимости;
- зависимости через `depends_on` и healthchecks;
- приложения не публикуют порты напрямую, кроме Traefik.

---

## 8. Команды

Корневые pnpm-скрипты добавляются вместе с сервисами; до появления кода инфраструктура запускается напрямую через `docker compose --profile infra up -d`.

```text
pnpm dev:infra:up
pnpm dev:apps:up
pnpm dev:up
pnpm dev:logs
pnpm dev:down
pnpm dev:reset
pnpm db:migrate
pnpm db:seed
pnpm dev:bootstrap-admin
```

Назначение:

| Команда | Действие |
|---------|----------|
| `dev:infra:up` | Поднять инфраструктуру |
| `dev:apps:up` | Поднять приложения |
| `dev:up` | Поднять всё |
| `dev:logs` | Логи всех контейнеров |
| `dev:down` | Остановить без удаления volume |
| `dev:reset` | Удалить volume, поднять infra, миграции, seed, bootstrap |
| `db:migrate` | Применить 4 миграции |
| `db:seed` | Роли, права, настройки, audit actions |
| `dev:bootstrap-admin` | Создать первого администратора |

---

## 9. Миграции

Порядок:

1. User & Access DB.
2. Project / Diagram DB.
3. Notification DB.
4. Audit DB.
5. Seed User & Access.
6. Seed Audit actions.

Команды выполняются в контейнере migration или через host с `localhost:5432`.

Требования:

- миграции идемпотентны;
- down-миграции проверены;
- seed идемпотентен;
- после reset — чистый старт;
- ошибка миграции останавливает запуск.

---

## 10. Первый администратор

1. Заполнить `DEV_ADMIN_EMAIL` и `DEV_ADMIN_PASSWORD`.
2. Запустить `pnpm dev:bootstrap-admin`.
3. Скрипт создает подтвержденного пользователя.
4. Назначает `app_admin`.
5. Пишет аудит.
6. Скрипт идемпотентен.
7. Пароль только для local.

---

## 11. Проверка после запуска

```text
curl -k https://api.localhost/health
curl -k https://app.localhost
```

Проверить:

- frontend открывается;
- API Gateway отвечает;
- PostgreSQL доступен;
- Redis доступен;
- Kafka topic создан;
- Mailpit UI открывается;
- mock Telegram доступен;
- миграции применены;
- администратор создан;
- вход работает;
- cookie `__Host-session` установлена;
- CSRF-cookie `__Host-csrf` установлена;
- WebSocket Sync подключается;
- WebSocket Notification подключается.

---

## 12. Email и Telegram

### 12.1. Email

- Mailpit UI: `https://mail.localhost`;
- SMTP: `mailpit:1025`;
- письма не уходят наружу;
- проверить auth-письма и приглашения.

### 12.2. Telegram

- mock Telegram API: `http://telegram-mock:8080`;
- реальный бот не обязателен;
- webhook: `https://notify.localhost/telegram/webhook`;
- секрет — dev placeholder;
- проверить `/start <код>` и `/stop` через mock.

---

## 13. Kafka

- broker: `kafka:9092`;
- topic: `smartoati.events`;
- partitions: 6;
- consumer groups:
  - `notification`;
  - `audit`;
  - `sync`.
- Kafka UI: `https://kafka.localhost`;
- проверить outbox → topic → consumers;
- DLQ/error topic — опционально.

---

## 14. Рабочий цикл

1. `git pull`.
2. `pnpm install`.
3. `pnpm dev:up`.
4. Проверить health.
5. Открыть `https://app.localhost`.
6. Войти dev-администратором.
7. Работать.
8. `pnpm dev:down` перед завершением.

При изменении зависимостей:

```text
pnpm install
pnpm dev:apps:down
pnpm dev:apps:up
```

---

## 15. Сброс окружения

```text
pnpm dev:reset
```

Удаляет:

- volume PostgreSQL;
- volume Kafka;
- volume Redis;
- volume Mailpit;
- локальные dev-данные;
- затем применяет миграции и seed.

Не удаляет:

- исходники;
- `.env.local`;
- сертификаты.

---

## 16. Типовые проблемы

| Проблема | Решение |
|----------|---------|
| Docker не стартует | Проверить WSL2/виртуализацию, перезапустить Docker Desktop |
| Мало памяти | Увеличить Docker memory до 8–12 ГБ |
| `*.localhost` не открывается | Добавить hosts-записи |
| Сертификат не доверенный | `mkcert -install`, перезапустить браузер |
| Cookie не устанавливается | Проверить HTTPS и `Secure`/`SameSite` |
| CORS-ошибка | Проверить `CORS_ORIGINS=https://app.localhost` |
| Kafka не готова | Дождаться healthcheck, проверить topic |
| PostgreSQL latest изменился | Пиновать digest в CI/staging |
| Миграция падает | Проверить подключение и порядок БД |
| Файлы не перезагружаются | Включить polling для Docker на Windows/WSL |
| Порт занят | Освободить 80/443/5432/6379/9092/8025 |
| `pnpm` не найден | `corepack enable` |
| Apple Silicon image | Указать `platform: linux/arm64` |

---

## 17. Безопасность local

- Только dev-секреты.
- Реальные Telegram/SMTP-токены не использовать.
- `.env.local` не коммитить.
- `certs/` не коммитить.
- Не открывать Docker API наружу.
- Не публиковать внутренние порты.
- Не использовать local-пароли вне local.
- Перед production — отдельные секреты и pinned images.

---

## 18. Критерии приемки

1. Docker Compose поднимает инфраструктуру и все приложения.
2. HTTPS работает на `*.localhost`.
3. PostgreSQL содержит 4 БД.
4. Kafka topic создан.
5. Redis доступен.
6. Mailpit принимает письма.
7. Telegram mock принимает webhook.
8. Миграции проходят.
9. Seed идемпотентен.
10. Первый администратор создается.
11. Frontend открывается.
12. API Gateway отвечает.
13. Cookie/CSRF работают.
14. Sync WS подключается.
15. Notification WS подключается.
16. `dev:reset` возвращает чистое окружение.
17. Команды документированы.
18. Разработчик может запустить проект без ручных правок.

