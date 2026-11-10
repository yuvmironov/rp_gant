# P0: сборка proto и кодогенерация
## SMART OATI

**Версия:** 1.0  
**Дата:** 2026-10-28

---

## 1. Артефакты

- `Исходные кодв/proto/`;
- `Исходные кодв/proto/buf.yaml`;
- `Исходные кодв/tools/generate-proto.ps1`;
- `Исходные кодв/openapi/` — для REST.

---

## 2. Правила

- Node.js 22 LTS;
- JavaScript без TypeScript;
- источник истины — `.proto`;
- runtime-загрузка через `@grpc/proto-loader`;
- статическая генерация через `grpc_tools_node_protoc` — опционально;
- сгенерированный код не коммитится;
- `buf` используется для lint/breaking.

---

## 3. Буф

```text
buf lint
buf breaking --against '.git#branch=main'
```

Конфигурация:

```text
proto/buf.yaml
```

Правила:

- STANDARD lint;
- FILE breaking;
- запрещены ломающие изменения;
- удаленные поля — `reserved`;
- новые поля — с новыми номерами.

---

## 4. Кодогенерация

```powershell
powershell -File tools/generate-proto.ps1
```

Результат:

```text
generated/proto/
```

Требования:

- `grpc-tools` доступен через `npx`;
- каталог `generated/` не коммитится;
- generated-код пересобирается в CI;
- ошибка генерации ломает сборку.

---

## 5. Runtime

Для сервисов без статической генерации:

- `@grpc/grpc-js`;
- `@grpc/proto-loader`;
- `includeDirs` — `Исходные кодв/proto`;
- `keepCase: false`;
- `longs: String`;
- `enums: String`;
- `defaults: true`;
- `oneofs: true`.

---

## 6. CI

Обязательные шаги:

1. `buf lint`;
2. `buf breaking`;
3. `pbjs`/`protoc` parse;
4. генерация JS;
5. проверка сгенерированных сервисов;
6. контрактные тесты;
7. отказ при предупреждениях.

---

## 7. Критерии приемки

1. Все proto загружаются.
2. `buf lint` проходит.
3. `buf breaking` проходит.
4. Генерация JS проходит.
5. Пакеты и методы соответствуют постановкам.
6. Generated-код отсутствует в репозитории.
7. CI блокирует ломающие изменения.
