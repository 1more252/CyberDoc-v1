<script setup>
import { ref, onMounted, computed } from 'vue'
import FlowNextStep from '@/ui/FlowNextStep.vue'
import { adminApi } from './admin.api.js'

const health = ref(null)
const dbStats = ref(null)
const loading = ref(false)
const error = ref('')
// busy: какая ops-кнопка сейчас в работе ('backup'|'wal'|'maintenance'|null).
// Используется для disabled + спиннера, чтобы не позволить дабл-клик.
const busy = ref(null)
const lastOp = ref(null)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [h, s] = await Promise.all([adminApi.health(), adminApi.dbStats()])
    health.value = h
    dbStats.value = s
  } catch (e) {
    error.value = e?.message || 'Не удалось загрузить состояние сервера'
  } finally {
    loading.value = false
  }
}

async function runOp(name, fn, label) {
  if (busy.value) return
  busy.value = name
  lastOp.value = null
  try {
    const result = await fn()
    lastOp.value = { name, label, ok: true, at: new Date(), result }
    await loadAll()
  } catch (e) {
    lastOp.value = { name, label, ok: false, at: new Date(), error: e?.message || 'Ошибка' }
  } finally {
    busy.value = null
  }
}

const fmt = (bytes) => {
  if (typeof bytes !== 'number') return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const fmtDuration = (sec) => {
  if (typeof sec !== 'number') return '—'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

// «Давно ли был последний бэкап» с цветом: >1.5× от интервала — алерт.
const backupAge = computed(() => {
  if (!health.value?.backup) return null
  const { lastAgeSec, autoIntervalSec } = health.value.backup
  const intervalsAgo = autoIntervalSec > 0 ? lastAgeSec / autoIntervalSec : 0
  return {
    text: fmtDuration(lastAgeSec),
    severity: intervalsAgo > 1.5 ? 'danger' : intervalsAgo > 1 ? 'warning' : 'success'
  }
})

onMounted(loadAll)
</script>

<template>
  <section>
    <h1 class="h3 mb-3">
      Настройки и состояние сервера
    </h1>

    <div
      v-if="error"
      class="alert alert-danger"
      role="alert"
    >
      {{ error }}
    </div>

    <div
      v-if="lastOp"
      :class="['alert', lastOp.ok ? 'alert-success' : 'alert-danger', 'small']"
      role="status"
    >
      <strong>{{ lastOp.label }}:</strong>
      {{ lastOp.ok ? 'выполнено' : 'ошибка' }}
      <span v-if="lastOp.error"> — {{ lastOp.error }}</span>
      <span class="ms-2 text-muted">{{ lastOp.at.toLocaleTimeString() }}</span>
    </div>

    <div class="row g-3">
      <div class="col-12 col-lg-6">
        <div class="cd-card p-3">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h2 class="h6 mb-0">
              Состояние сервера
            </h2>
            <button
              class="btn btn-sm btn-outline-secondary"
              :disabled="loading"
              aria-label="Обновить состояние"
              @click="loadAll"
            >
              <i class="bi bi-arrow-clockwise" /> Обновить
            </button>
          </div>
          <dl
            v-if="health"
            class="row mb-0 small"
          >
            <dt class="col-5">
              Uptime
            </dt>
            <dd class="col-7">
              {{ fmtDuration(health.uptime) }}
            </dd>
            <dt class="col-5">
              Версия / Node
            </dt>
            <dd class="col-7">
              {{ health.version }} / {{ health.node }}
            </dd>
            <dt class="col-5">
              Среда
            </dt>
            <dd class="col-7">
              {{ health.env }}
            </dd>
            <dt class="col-5">
              БД (размер)
            </dt>
            <dd class="col-7">
              {{ health.db?.sizeMB }} MB
              <span
                v-if="health.db?.walAlert"
                class="badge bg-warning text-dark ms-1"
              >WAL вырос</span>
            </dd>
            <dt class="col-5">
              WAL
            </dt>
            <dd class="col-7">
              {{ health.db?.walSizeMB }} MB
            </dd>
            <dt class="col-5">
              Пользователи (в БД)
            </dt>
            <dd class="col-7">
              {{ health.db?.users }}
            </dd>
            <dt class="col-5">
              Pending writes
            </dt>
            <dd class="col-7">
              {{ health.db?.pendingWrites ? 'да' : 'нет' }}
            </dd>
            <dt class="col-5">
              Inflight (cur / peak)
            </dt>
            <dd class="col-7">
              {{ health.inflight?.total }} / {{ health.inflight?.peak }}
              <span class="text-muted">(cap {{ health.inflight?.cap }})</span>
            </dd>
            <dt class="col-5">
              503-shed
            </dt>
            <dd class="col-7">
              {{ health.inflight?.shed }}
            </dd>
            <dt class="col-5">
              Lockout (user / IP)
            </dt>
            <dd class="col-7">
              {{ health.lockoutEntries }} / {{ health.lockoutIpEntries }}
            </dd>
            <dt class="col-5">
              Refresh (rotated / replays)
            </dt>
            <dd class="col-7">
              {{ health.refresh?.rotated }} / {{ health.refresh?.replays }}
              <span
                v-if="health.refresh?.replays > 0"
                class="badge bg-danger ms-1"
              >replay!</span>
            </dd>
            <dt class="col-5">
              RAM (heap / rss)
            </dt>
            <dd class="col-7">
              {{ health.mem?.heapUsedMB }} / {{ health.mem?.rssMB }} MB
            </dd>
            <dt class="col-5">
              Read-only
            </dt>
            <dd class="col-7">
              {{ health.readOnly ? 'да' : 'нет' }}
            </dd>
            <dt class="col-5">
              Последний авто-бэкап
            </dt>
            <dd class="col-7">
              <span
                v-if="backupAge"
                :class="`text-${backupAge.severity}`"
              >{{ backupAge.text }} назад</span>
              <span
                v-else
                class="text-muted"
              >—</span>
            </dd>
          </dl>
          <div
            v-else-if="loading"
            class="text-muted small"
          >
            Загрузка…
          </div>
        </div>
      </div>

      <div class="col-12 col-lg-6">
        <div class="cd-card p-3 mb-3">
          <h2 class="h6 mb-2">
            Действия
          </h2>
          <p class="text-muted small mb-3">
            Ручные операции, обычно выполняются автоматически в maintenance-цикле.
          </p>
          <div class="d-grid gap-2">
            <button
              class="btn btn-outline-primary btn-sm"
              :disabled="busy !== null"
              @click="runOp('backup', adminApi.backup, 'Бэкап БД')"
            >
              <i class="bi bi-download me-1" />
              <span v-if="busy === 'backup'">Бэкап…</span>
              <span v-else>Создать бэкап</span>
            </button>
            <button
              class="btn btn-outline-primary btn-sm"
              :disabled="busy !== null"
              @click="runOp('wal', adminApi.walCheckpoint, 'WAL checkpoint')"
            >
              <i class="bi bi-arrow-repeat me-1" />
              <span v-if="busy === 'wal'">Checkpoint…</span>
              <span v-else>WAL checkpoint</span>
            </button>
            <button
              class="btn btn-outline-primary btn-sm"
              :disabled="busy !== null"
              @click="runOp('maintenance', adminApi.maintenance, 'Maintenance')"
            >
              <i class="bi bi-tools me-1" />
              <span v-if="busy === 'maintenance'">Maintenance…</span>
              <span v-else>Запустить maintenance</span>
            </button>
          </div>
        </div>

        <div
          v-if="dbStats"
          class="cd-card p-3"
        >
          <h2 class="h6 mb-2">
            Таблицы БД
          </h2>
          <div
            class="small overflow-auto"
            style="max-height: 320px"
          >
            <table class="table table-sm mb-0">
              <thead>
                <tr>
                  <th>Таблица</th>
                  <th class="text-end">
                    Строк
                  </th>
                  <th class="text-end">
                    Размер
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(s, name) in dbStats.tables"
                  :key="name"
                >
                  <td>{{ name }}</td>
                  <td class="text-end">
                    {{ s.rows }}
                  </td>
                  <td class="text-end">
                    {{ fmt(s.bytes) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <FlowNextStep />
  </section>
</template>
