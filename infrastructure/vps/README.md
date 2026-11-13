# VPS deployment

Production-конфигурация для одного VPS за reverse proxy Jino.

> **Статус:** production VPS обновлён 2026-11-12 до release `6643a1a` (`PR #155`) после подтверждённой владельцем staging-приёмки. Выполнены rollout и health checks. По явному решению владельца pre-migration backup сохранён только на диске VPS и проверен восстановлением в изолированный PostgreSQL; off-host копии нет — это исключение не отменяет обычное требование runbook. Kubernetes staging deployment не выполнялся. Сводка: [`IMPLEMENTATION-STATUS.md`](../../docs/IMPLEMENTATION-STATUS.md).

## Требования

- Ubuntu 24.04+;
- Docker Engine + Compose v2;
- 4 ГБ RAM и 20 ГБ диска;
- домены `app.rp-gant.ru` и `sync.rp-gant.ru`, направленные на VPS;
- Jino завершает TLS и проксирует HTTPS на внутренний порт `80`;
- отдельный ящик `no-reply@app.rp-gant.ru` для SMTP;
- отдельная БД `rp_gant_sync` в том же PostgreSQL для Sync processed-event ledger и replay deduplication.

## Состав

Запускаются только production-сервисы:

- Caddy (HTTP reverse proxy);
- PostgreSQL;
- Kafka в KRaft-режиме; `kafka-init` создаёт canonical topic `rp_gant.events` и DLQ/replay topics для Notification, Audit и Sync;
- API Gateway, User, Project, Notification, Audit, Sync;
- Nuxt frontend.

Redis, Mailpit, Kafka UI, mock Telegram, Traefik и мониторинг в этот compose не входят.

## Подготовка и запуск

Перед первым запуском или обновлением:

1. Убедиться, что staging acceptance пройдена, release commit одобрен, DNS/TLS/SMTP доступны.
2. Создать `infrastructure/vps/.env` только если его ещё нет, заполнить все placeholder значения и сохранить файл только на VPS. Не вставлять содержимое в Git, CI, чат или логи.
3. Задать случайный `POSTGRES_PASSWORD` и согласованный пароль во всех явных `DATABASE_URL_*`; `SYNC_DB=rp_gant_sync`; случайный `SYNC_TOKEN_SECRET`; SMTP-пароль и начальный пароль администратора. `DATABASE_URL_SYNC` можно задать явно; если его нет, Compose передаст Sync Service параметры PG подключения из уже имеющихся `POSTGRES_USER`/`POSTGRES_PASSWORD`, направив его в `rp_gant_sync`.
4. Проверить Compose-конфигурацию командой `config --quiet`; не вызывать `config` без `--quiet` в общем терминале, так как полный вывод содержит переменные окружения.
5. Для существующего VPS подготовить и проверить off-host backup всех БД и план rollback; для пустой первой установки заранее определить backup target и процедуру восстановления.

Подготовка и безопасная проверка (Compose использует `.env`, команда не печатает значения):

```bash
cd /opt/rp-gant
test -f infrastructure/vps/.env || cp infrastructure/vps/.env.example infrastructure/vps/.env
nano infrastructure/vps/.env
docker compose --env-file infrastructure/vps/.env -f infrastructure/vps/docker-compose.yml config --quiet
```

После прохождения всех gates и только на одобренном release commit запускать:

```bash
docker compose --env-file infrastructure/vps/.env -f infrastructure/vps/docker-compose.yml up -d --build
```

Пример генерации секрета:

```bash
openssl rand -hex 24
```

## Проверка

```bash
docker compose --env-file infrastructure/vps/.env -f infrastructure/vps/docker-compose.yml ps
curl -fsS -H 'Host: app.rp-gant.ru' http://127.0.0.1/health
curl -fsS -H 'Host: sync.rp-gant.ru' http://127.0.0.1/health/live
```

Снаружи:

```bash
curl -fsS https://app.rp-gant.ru/health
curl -fsS https://sync.rp-gant.ru/health/live
```

Убедиться, что Sync Service имеет статус `healthy` и `db-init` завершился успешно; его миграция создаёт `rp_gant_sync.events.processed_events`. При rollout 2026-11-11 оба внешних health endpoints вернули 200; запрос WebSocket с неверным token был отклонён 401. Успешный аутентифицированный handshake `101 Switching Protocols` отдельно не проверялся.

## Последний rollout

- Release: `6643a1a` (`PR #155`), 2026-11-12; staging acceptance подтверждена владельцем.
- `db-init` применяет project guard `0009_user_only_task_assignments` до user `0005_remove_executor_catalog`; все пять service DB присутствуют.
- Backfill: dry-run просканировал 0 назначений; apply выполнил 0 обновлений и 0 удалений.
- Все app containers проверены; внешние app и Sync health endpoints вернули 200, Sync `/health/live` и `/health/ready` отвечают `ok`/`ready`.
- Pre-migration полный PostgreSQL backup: `/opt/rp-gant-backups/rp-gant-pre-assignments-9f43bcc.sql` (5 DB, 690533 bytes, mode `0600`). Изолированный restore drill прошёл на том же VPS.
- **Исключение по решению владельца:** backup не скопирован off-host; локальный backup и restore drill не защищают от потери VPS. Kubernetes staging rollout не выполнялся.

## Начальный администратор

`DEV_ADMIN_*` создаёт администратора при старте `user-service`, даже при
`DEV_AUTO_VERIFY=false`. После первого успешного входа:

1. сменить пароль через профиль;
2. удалить `DEV_ADMIN_PASSWORD` из `infrastructure/vps/.env`;
3. перезапустить `user-service`, чтобы пароль больше не сбрасывался.

## Обновление

Перед применением изменений БД сделайте backup всех баз (включая `rp_gant_sync`). Применение миграций остаётся запрещено без принятой staging-приёмки.

Сначала создайте backup с закрытыми правами:

```bash
set -euo pipefail
cd /opt/rp-gant
umask 077
compose=(docker compose --env-file infrastructure/vps/.env -f infrastructure/vps/docker-compose.yml)
backup_dir=/opt/rp-gant-backups
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
pg_user="$("${compose[@]}" exec -T postgres printenv POSTGRES_USER)"
backup="$backup_dir/rp-gant-$(date +%Y%m%d-%H%M%S).sql"
"${compose[@]}" exec -T postgres pg_dumpall -U "$pg_user" > "$backup"
test -s "$backup"
printf 'Backup created: %s\n' "$backup"
```

**Не продолжать**, пока backup не скопирован в утверждённое off-host хранилище и не подтверждена процедура восстановления. Затем, только для одобренного release commit:

```bash
set -euo pipefail
cd /opt/rp-gant
git pull --ff-only
compose=(docker compose --env-file infrastructure/vps/.env -f infrastructure/vps/docker-compose.yml)
"${compose[@]}" config --quiet
# Идемпотентно повторно применяет миграции и seed, включая Sync ledger.
"${compose[@]}" run --rm db-init
"${compose[@]}" up -d --build
"${compose[@]}" ps
```

Если изменение затрагивает только `user-service`, после `db-init` можно пересобрать только его:

```bash
docker compose --env-file infrastructure/vps/.env \
  -f infrastructure/vps/docker-compose.yml up -d --build --no-deps user-service
```

Не используйте `down -v` для обычного обновления: это удалит volumes с данными.

## Ограничения

- swap в LXC недоступен, поэтому контейнеры ограничены по памяти;
- Kafka использует один брокер и replication factor 1;
- TLS и сертификаты обслуживает Jino;
- WebSocket для уведомлений не реализован: notifications загружаются через REST;
- перед обновлением БД делать backup PostgreSQL.
