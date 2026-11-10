# VPS deployment

Production-конфигурация для одного VPS за reverse proxy Jino.

## Требования

- Ubuntu 24.04+;
- Docker Engine + Compose v2;
- 4 ГБ RAM и 20 ГБ диска;
- домены `app.rp-gant.ru` и `sync.rp-gant.ru`, направленные на VPS;
- Jino завершает TLS и проксирует HTTPS на внутренний порт `80`;
- отдельный ящик `no-reply@app.rp-gant.ru` для SMTP.

## Состав

Запускаются только production-сервисы:

- Caddy (HTTP reverse proxy);
- PostgreSQL;
- Kafka в KRaft-режиме;
- API Gateway, User, Project, Notification, Audit, Sync;
- Nuxt frontend.

Redis, Mailpit, Kafka UI, mock Telegram, Traefik и мониторинг в этот compose не входят.

## Запуск

```bash
cd /opt/rp-gant
cp infrastructure/vps/.env.example infrastructure/vps/.env
nano infrastructure/vps/.env
docker compose --env-file infrastructure/vps/.env -f infrastructure/vps/docker-compose.yml up -d --build
```

Перед первым запуском задать:

- случайный `POSTGRES_PASSWORD` и такие же пароли в `DATABASE_URL_*`;
- случайный `SYNC_TOKEN_SECRET`;
- SMTP-пароль;
- начальный пароль администратора.

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

WebSocket `sync.rp-gant.ru` должен отвечать `101 Switching Protocols`.

## Начальный администратор

`DEV_ADMIN_*` создаёт администратора при старте `user-service`, даже при
`DEV_AUTO_VERIFY=false`. После первого успешного входа:

1. сменить пароль через профиль;
2. удалить `DEV_ADMIN_PASSWORD` из `infrastructure/vps/.env`;
3. перезапустить `user-service`, чтобы пароль больше не сбрасывался.

## Обновление

Перед применением изменений БД сделайте backup. На VPS выполните:

```bash
set -euo pipefail
cd /opt/rp-gant
git pull --ff-only

umask 077
compose=(docker compose --env-file infrastructure/vps/.env -f infrastructure/vps/docker-compose.yml)
backup_dir=/opt/rp-gant-backups
mkdir -p "$backup_dir"
pg_user="$("${compose[@]}" exec -T postgres printenv POSTGRES_USER)"
backup="$backup_dir/rp-gant-$(date +%Y%m%d-%H%M%S).sql"
"${compose[@]}" exec -T postgres pg_dumpall -U "$pg_user" > "$backup"
test -s "$backup"

# Повторно применяет идемпотентные миграции и seed, включая новые миграции.
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
