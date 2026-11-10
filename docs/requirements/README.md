# Документация требований

Исходные бизнес- и системные постановки проекта, перенесённые в репозиторий с исходным кодом.

> Историческое имя продукта в этих документах — **SMART OATI**. Текущее имя проекта —
> **RP Gant**. Бизнес- и системные постановки сохранены как требования и исторический
> контекст; их наличие не означает, что описанное поведение уже реализовано.
> Состояние кода и инфраструктуры см. в [`docs/IMPLEMENTATION-STATUS.md`](../IMPLEMENTATION-STATUS.md),
> покрытие контрактов — в [`docs/SPEC-STATUS.md`](../SPEC-STATUS.md) и артефактах `openapi/`,
> `proto/`, `events/`, `sync/`, `notifications/`.

## С чего начать

- [Состояние реализации и известные расхождения](../IMPLEMENTATION-STATUS.md)
- [Состояние контрактов](../SPEC-STATUS.md)
- [Переименование в RP Gant](../MIGRATION-rp-gant.md)

## Бизнес-постановки

- [Бизнес-постановка](business/SMART_OATI_диаграмма_Ганта_бизнес_постановка.md)
- [HTML-версия бизнес-постановки](business/SMART_OATI_диаграмма_Ганта.html)
- [Экспорты исходных данных](business/exports/)

## Системные постановки

- [Общая системная постановка](system/SMART_OATI_диаграмма_Ганта_системная_постановка.md)
- [План реализации серверных интеграций](system/SMART_OATI_план_реализации_серверных_интеграций.md)
- [Архитектура базы данных](system/Архитектура_базы_данных_SMART_OATI.md)
- [Поэкранная спецификация Frontend](system/Поэкранная_спецификация_Frontend_SMART_OATI.md)
- [UI/UX Visual Design](system/UI_UX_Visual_Design_SMART_OATI.md)

### Сервисные постановки

- [API Gateway](system/Системная_постановка_API_Gateway_SMART_OATI.md)
- [User & Access Service](system/Системная_постановка_User_and_Access_Service_SMART_OATI.md)
- [Project & Diagram Service](system/Системная_постановка_Project_and_Diagram_Service_SMART_OATI.md)
- [Notification Service](system/Системная_постановка_Notification_Service_SMART_OATI.md)
- [Audit Service](system/Системная_постановка_Audit_Service_SMART_OATI.md)
- [Sync / Realtime Service](system/Системная_постановка_Sync_Realtime_Service_SMART_OATI.md)
- [Frontend](system/Системная_постановка_Frontend_SMART_OATI.md)
- [OpenAPI](system/Системная_постановка_OpenAPI_SMART_OATI.md)
- [Proto Contracts](system/Системная_постановка_Proto_Contracts_SMART_OATI.md)
- [Telegram Bot](system/Системная_постановка_Telegram_Bot_SMART_OATI.md)

## P0-пакет

- [P0: контракты и спецификации](system/P0/README.md)
  - DDL и миграции
  - Контракт событий
  - WebSocket-контракт
  - Глобальные роли
  - Notification-шаблоны и матрица
  - Audit-каталог действий
  - REST/gRPC mapping
  - Proto-сборка и кодогенерация
  - Эксплуатация и безопасность
  - План тестирования
  - Полные payload-события
  - Формат импорта/экспорта
  - Local Development Runbook
  - MVP Scope and Backlog
  - ADR Package
  - Authorization Matrix
  - Engineering Handbook
  - CI/CD and Environments
  - API Conventions and Error Catalog
  - Messaging Operations
  - Test Data and Contract Mocks

## История изменений

- [Changelog](changelog.md)
