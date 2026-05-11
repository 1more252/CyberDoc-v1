# CyberDoc-v1

Платформа учёта организаций, ИБ-средств и нормативной документации.
Vue 3 SPA + Express/SQLite-бэкенд.

---

## Быстрый старт

> Требования: **Node.js 20.19+ или 22.12+**. На Windows для `better-sqlite3` нужен
> установленный VS Build Tools, но если `node_modules` уже закоммичен в репо —
> устанавливать ничего не надо.

### Клонировать и запустить

```bash
git clone https://github.com/1more252/CyberDoc-v1.git
cd CyberDoc-v1
npm run dev:full
```

Откроется:

- **Frontend:** http://localhost:5173
- **Backend:**  http://127.0.0.1:3001
- **Healthcheck:** http://127.0.0.1:3001/health

### Тестовые учётки

| Логин   | Пароль      | Роль        |
|---------|-------------|-------------|
| admin   | admin123    | admin       |
| expert  | expert123   | expert      |
| user    | user123     | user        |

---

## Все команды

```bash
# Разработка
npm run dev          # только фронт (Vite, :5173)
npm run server       # только бэк  (Express, :3001)
npm run dev:full     # фронт + бэк одной командой (рекомендуется)

# Продакшн
npm run build        # собрать SPA в dist/
npm run preview      # локально посмотреть собранный bundle

# Качество
npm run lint         # ESLint --fix
npm test             # vitest (стресс-тесты бэка)
```

### Прод-режим (бэк отдаёт собранный фронт)

```bash
npm run build
JWT_SECRET=your-secret-here SERVE_STATIC=true npm run server
# → http://127.0.0.1:3001 (один порт на всё)
```

---

## Переменные окружения

| Переменная        | Где              | Назначение                                |
|-------------------|------------------|-------------------------------------------|
| `VITE_API_URL`    | `.env` (фронт)   | URL API (по умолчанию `/api` через прокси)|
| `VITE_USE_MOCK_API` | `.env` (фронт) | `true` — в браузере, без бэка             |
| `JWT_SECRET`      | env бэка         | Обязательно в prod. В dev генерится случайный |
| `PORT`            | env бэка         | Порт бэка (по умолчанию `3001`)           |
| `HOST`            | env бэка         | Хост бэка (по умолчанию `127.0.0.1`)      |
| `SERVE_STATIC`    | env бэка         | `true` — отдавать `dist/` (single-port)    |
| `TRUST_PROXY`     | env бэка         | `true` — за nginx/cloudflare              |

---

## Стек

**Frontend:** Vue 3 (Composition API), Vite 8, Pinia, vue-router 4, Bootstrap 5,
docx (Web Worker), axios.

**Backend:** Express 5, better-sqlite3 (WAL), HMAC SHA-256 JWT, helmet,
express-rate-limit, cors.

**Хранилище:** SQLite в `data/app.db` (создаётся автоматически).
При первом запуске, если рядом есть `data/db.json` от старой версии — данные
импортируются в SQLite, JSON остаётся как бэкап.

---

## Структура

```
src/
  app/              — bootstrap (main.js, router, pinia)
  layouts/          — оболочка дашборда (сайдбар, навбар)
  modules/          — бизнес-фичи по доменам:
    auth/              логин/регистрация/профиль
    organization/      организации
    inn-registry/      реестр контрагентов из ФНС
    personal/          сотрудники + CSV-импорт
    info-systems/      информационные системы
    equipment/         оборудование
    software/          ПО
    security-tools-db/ каталог СЗИ ФСТЭК
    security-tools/    «мои СЗИ»
    threat-models/     модели угроз
    document-set/      генерация пакетов ОРД
    registry/          реестр документов
    statistics/        аналитика
    admin/             админка
    expert/            экспертная очередь
  mock/             — handlers, симулирующие реальный бэк
  lib/              — http, jwt, storage helpers
  flow/             — guided-flow (нумерованные шаги в сайдбаре)
  ui/               — общие компоненты (FormField, FlowNextStep, Toast)
  workers/          — docx + personal-import Web Worker'ы

server/
  index.js          — Express-приложение
  jwt.js            — HMAC-подпись JWT
  storage.js        — SQLite-персистенс

scripts/
  dev-full.mjs      — параллельный запуск vite + бэка
  stress.test.js    — нагрузочные тесты
```

---

## Производительность

Стресс-тест на «толстом» датасете (200 орг, 10k персонала, 50k оборудования,
50k ПО, 100k ИНН):

- большая часть GET-эндпоинтов — **< 1 мс**
- 1000 параллельных запросов `/equipment` (50k записей) — **933 мс** (~1 070 req/s)
- единственное узкое место — `/personal` (~12 мс из-за сортировки по `Intl.Collator`)

Запустить локально:

```bash
npm test
```
