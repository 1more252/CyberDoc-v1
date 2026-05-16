# ===========================================================================
# КиберДок (apn-vue) — single-container deploy: Express + SQLite + SPA-статика.
# Multi-stage: builder собирает frontend, runtime тянет prod-deps и копирует
# dist/ + server/. Финальный образ ~150MB (node:22-alpine + better-sqlite3).
# ===========================================================================

# ---------- Stage 1: build SPA -------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Сначала package.json — кэш слоя npm install переживает изменения исходников.
COPY package.json package-lock.json* ./
RUN npm ci

# Исходники + сборка. VITE_USE_MOCK_API=false вшито (прод всегда смотрит в /api).
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---------- Stage 2: runtime ---------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# better-sqlite3 на alpine требует python+make+g++ для native-build. Ставим
# только в этой стадии — финальный образ их не несёт.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && apk add --no-cache tini

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev \
 && apk del .build-deps

# Только то, что нужно в runtime — server/, src/mock (для handlers), dist/.
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY src/mock ./src/mock
COPY src/lib/jwt.js ./src/lib/jwt.js

# Папка для SQLite + бэкапов; volume в compose / k8s PV.
RUN mkdir -p /app/data /app/data/backups && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV SERVE_STATIC=true

# JWT_SECRET и ALLOWED_ORIGINS ОБЯЗАТЕЛЬНЫ в проде — задаются в `docker run -e`
# или secrets/configmap. Без них сервер упадёт на старте (это фича).

EXPOSE 3001

USER node
VOLUME ["/app/data"]

# tini как PID 1 — корректная пересылка SIGTERM в node (graceful shutdown).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1 || exit 1
