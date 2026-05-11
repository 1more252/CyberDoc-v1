# CyberDoc-v1

Платформа учёта организаций, ИБ-средств и нормативной документации. Vue 3 SPA + Express/SQLite-бэкенд.

---

## Быстрый старт

> Требования: **Node.js 20.19+ или 22.12+**. На Windows для `better-sqlite3` нужен установленный VS Build Tools, но если `node_modules` уже закоммичен в репо — устанавливать ничего не надо.

### Клонировать и запустить

```bash
git clone https://github.com/1more252/CyberDoc-v1.git
cd CyberDoc-v1
npm run dev:full
```

Откроется:

- **Frontend:** http://localhost:5173
- **Backend:** http://127.0.0.1:3001
- **Healthcheck:** http://127.0.0.1:3001/health

### Тестовые учётки

| Логин   | Пароль      | Роль   |
|---------|-------------|--------|
| admin   | admin123    | admin  |
| expert  | expert123   | expert |
| user    | user123     | user   |
