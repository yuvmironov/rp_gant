# Миграция на RP Gant

Документ описывает переход с прежнего имени `smart-oati` на `rp-gant` / `rp_gant`.

## Что изменилось

| Область | Было | Стало |
|---|---|---|
| Название продукта | SMART OATI | RP Gant |
| GitHub-репозиторий | `yuvmironov/gantt` | `yuvmironov/rp_gant` |
| npm-пакеты | `@smart-oati/*` | `@rp-gant/*` |
| Docker-образы | `smart-oati/*` | `rp-gant/*` |
| GHCR | `ghcr.io/<owner>/smart-oati/*` | `ghcr.io/<owner>/rp-gant/*` |
| PostgreSQL role | `smart_oati` | `rp_gant` |
| PostgreSQL БД | `smart_oati_*` | `rp_gant_*` |
| Proto | `proto/smartoati`, `smartoati.*` | `proto/rpgant`, `rpgant.*` |
| Kafka topic | `smartoati.events` | `rp_gant.events` |
| Локальные домены | `*.localhost` | `*.rp-gant.localhost` |
| Helm umbrella chart | `smart-oati` | `rp-gant` |
| Helm Secret sync | `smart-oati-sync` | `rp-gant-sync` |
| Compose project | `smart-oati` | `rp-gant` |

## Локальный Docker Compose

Текущие Compose и кодовый fallback publishers/consumers используют canonical `KAFKA_TOPIC=rp_gant.events`; staging overlay задаёт его явно. Legacy non-staging Helm defaults сохранены до отдельной staging-приёмки. Подробности: [`Состояние реализации`](IMPLEMENTATION-STATUS.md).

Старые и новые volumes не совместимы по именам: Compose создаёт `rp-gant_postgres_data`,
`rp-gant_kafka_data` и `rp-gant_redis_data`. Автоматического переименования volumes нет.

Порядок миграции:

1. Сделать резервную копию старого стенда:
   ```bash
   pnpm local:backup
   ```
2. Остановить старый стек, не удаляя volumes:
   ```bash
   docker compose -p smart-oati \
     --env-file infrastructure/local/.env.local \
     -f infrastructure/local/docker-compose.yml down
   ```
3. Перейти на новую версию и поднять новый стек:
   ```bash
   pnpm local:up
   ```
4. Перенести дампы в новые БД. Для каждой БД использовать `pg_restore` с
   `--no-owner --no-privileges`, чтобы владельцем объектов стал `rp_gant`.
5. Перезапустить стек и проверить:
   ```bash
   pnpm local:health
   ```
6. Старые volumes `smart-oati_*` сохранить до подтверждения успешной миграции,
   затем удалить вручную.

Текущий локальный стенд уже мигрирован. Старые volumes `smart-oati_*` оставлены
как резервная копия.

После смены домена старые cookie не действуют: пользователям нужно войти заново.

## Kubernetes / Helm

Релиз и chart переименованы, поэтому простой `helm upgrade` старого релиза не подходит.

1. Собрать и опубликовать образы по новому пути `ghcr.io/<owner>/rp-gant/*`.
2. Подготовить новые Secret/ConfigMap с именами `rp-gant-*`.
3. Развернуть новый релиз `rp-gant` в namespace `rp-gant`.
4. Перенести данные PostgreSQL через dump/restore в БД `rp_gant_*`.
5. Переключить ingress/ALB на новые домены `app.*` и `sync.*`.
6. Проверить вход, Gantt, комментарии, уведомления и sync.
7. Удалить старый релиз и неиспользуемые ресурсы после проверки.

Для отката вернуть старый релиз, DNS и образы; старые БД и volumes не удалять
до завершения проверки.

## CI и GitHub

- Remote: `git@github.com:yuvmironov/rp_gant.git`.
- GHCR-путь образов изменён; workflow `images.yml` уже публикует в `rp-gant/*`.
- Старые ссылки GitHub перенаправляются, но в локальных клонах нужно обновить remote:
  ```bash
  git remote set-url origin git@github.com:yuvmironov/rp_gant.git
  ```
- Секреты CI, имена секретов Kubernetes и SMTP/Telegram-настройки проверяются
  отдельно: часть из них содержит прежнее имя проекта.

## Проверка после миграции

```bash
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
pnpm local:health
```

Ожидаемые проверки: health приложения, sync и Mailpit, вход администратора,
список проектов, открытие Gantt и загрузка комментариев.
