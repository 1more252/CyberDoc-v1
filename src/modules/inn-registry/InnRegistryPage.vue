<script setup>
import { computed, onMounted, ref } from 'vue'
import { useInnRegistryStore } from './inn-registry.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { saveDocx } from '@/lib/docx-runner.js'
import { formatDate } from '@/lib/format.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useInnRegistryStore()
const toast = useToast()
const confirm = useConfirm()

const input = ref('')
const exporting = ref(false)
const exportProgress = ref({ done: 0, total: 0 })

const progressPct = computed(() => {
  const { done, total } = store.lookupProgress
  return total > 0 ? Math.round((done / total) * 100) : 0
})

async function onRunLookup() {
  const trimmed = input.value.trim()
  if (!trimmed) {
    toast.warning('Вставьте список ИНН.')
    return
  }
  try {
    await store.runLookup(trimmed)
    if (store.errorCount > 0) {
      toast.warning(
        `Готово. Успешно: ${store.completedCount}, с ошибками: ${store.errorCount}.`
      )
    } else {
      toast.success(`Загружено ${store.completedCount} организаций.`)
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось обработать список.')
  }
}

async function onExportDocx() {
  if (!store.saved.length) {
    toast.warning('Сначала загрузите хотя бы одну запись.')
    return
  }
  exporting.value = true
  exportProgress.value = { done: 0, total: store.saved.length }
  try {
    await saveDocx(
      'inn-registry',
      { entries: store.saved, title: 'Реестр организаций' },
      `inn-registry-${new Date().toISOString().slice(0, 10)}.docx`,
      (done, total) => {
        exportProgress.value = { done, total }
      }
    )
    toast.success('Документ скачан.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось собрать DOCX.')
  } finally {
    exporting.value = false
  }
}

async function onClearAll() {
  const ok = await confirm.ask({
    title: 'Очистить реестр?',
    message: `Удалить все ${store.saved.length} записей? Действие необратимо.`,
    okText: 'Очистить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.clearAll()
    store.clearEntries()
    toast.success('Реестр очищен.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось очистить.')
  }
}

async function onRemoveOne(id) {
  try {
    await store.removeOne(id)
    toast.success('Запись удалена.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

onMounted(() => {
  store.fetchSaved()
})
</script>

<template>
  <section>
    <h1 class="h3 mb-1">
      Реестр ИНН
    </h1>
    <p class="text-secondary">
      Вставьте список ИНН (по одному на строке). Запросы автоматически
      разбиваются на чанки по 50 и отправляются партиями — нагрузка на
      сервис ФНС остаётся равномерной даже на больших объёмах.
    </p>

    <div :class="['cd-card p-3 mb-3']">
      <textarea
        v-model="input"
        class="form-control mb-2"
        rows="5"
        placeholder="7707083893&#10;500100732259&#10;..."
        :disabled="store.lookupRunning"
      />
      <div class="d-flex flex-wrap gap-2 align-items-center">
        <button
          type="button"
          :class="['btn btn-primary']"
          :disabled="store.lookupRunning || !input.trim()"
          @click="onRunLookup"
        >
          <span
            v-if="store.lookupRunning"
            class="spinner-border spinner-border-sm me-2"
          />
          Загрузить из ФНС
        </button>
        <button
          type="button"
          :class="['btn btn-outline-success']"
          :disabled="exporting || !store.saved.length"
          @click="onExportDocx"
        >
          <span
            v-if="exporting"
            class="spinner-border spinner-border-sm me-2"
          />
          <i
            v-else
            class="bi bi-file-earmark-word me-1"
          />
          Скачать DOCX
        </button>
        <button
          type="button"
          :class="['btn btn-outline-danger ms-auto']"
          :disabled="!store.saved.length || store.lookupRunning"
          @click="onClearAll"
        >
          <i class="bi bi-trash me-1" /> Очистить реестр
        </button>
      </div>

      <div
        v-if="store.lookupRunning || store.lookupProgress.total > 0"
        class="mt-3"
      >
        <div class="d-flex justify-content-between small text-secondary mb-1">
          <span>Загрузка из ФНС</span>
          <span>{{ store.lookupProgress.done }} / {{ store.lookupProgress.total }}</span>
        </div>
        <div class="progress">
          <div
            class="progress-bar"
            role="progressbar"
            :style="{ width: progressPct + '%' }"
            :aria-valuenow="progressPct"
            aria-valuemin="0"
            aria-valuemax="100"
          />
        </div>
      </div>

      <div
        v-if="exporting"
        class="mt-2 small text-secondary"
      >
        Сборка DOCX: {{ exportProgress.done }} / {{ exportProgress.total }} строк…
      </div>
    </div>

    <!-- Live-результаты текущей сессии lookup -->
    <div
      v-if="store.entries.length"
      :class="['cd-card mb-3']"
    >
      <div class="p-3 d-flex justify-content-between align-items-center border-bottom">
        <strong>Результаты обработки</strong>
        <button
          type="button"
          :class="['btn btn-sm btn-outline-secondary']"
          @click="store.clearEntries()"
        >
          Скрыть
        </button>
      </div>
      <table class="table table-sm mb-0 align-middle">
        <thead class="table-light">
          <tr>
            <th>ИНН</th>
            <th>Статус</th>
            <th>Название</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in store.entries"
            :key="e.inn"
          >
            <td class="font-monospace small">
              {{ e.inn }}
            </td>
            <td>
              <span
                v-if="e.status === 'pending'"
                class="badge text-bg-secondary"
              >ожидание</span>
              <span
                v-else-if="e.status === 'done'"
                class="badge text-bg-success"
              >ок</span>
              <span
                v-else
                class="badge text-bg-danger"
                :title="e.error"
              >ошибка</span>
            </td>
            <td>{{ e.data?.shortName ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Сохранённый реестр -->
    <div :class="['cd-card']">
      <div class="p-3 border-bottom">
        <strong>Сохранённые записи</strong>
        <span class="text-secondary ms-2">всего: {{ store.saved.length }}</span>
      </div>
      <div
        v-if="store.loading"
        class="p-4 text-center text-secondary"
      >
        <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
      </div>
      <div
        v-else-if="!store.saved.length"
        class="p-4 text-center text-secondary"
      >
        Реестр пуст.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>ИНН</th>
            <th>Полное наименование</th>
            <th>ОГРН</th>
            <th>Обновлено</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in store.saved"
            :key="r.id"
          >
            <td class="font-monospace small">
              {{ r.inn }}
            </td>
            <td>{{ r.data?.orgName ?? '—' }}</td>
            <td class="font-monospace small">
              {{ r.data?.ogrn ?? '—' }}
            </td>
            <td class="small text-secondary">
              {{ formatDate(r.updatedAt) }}
            </td>
            <td class="text-end">
              <button
                type="button"
                :class="['btn btn-sm btn-outline-danger']"
                @click="onRemoveOne(r.id)"
              >
                <i class="bi bi-trash" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <FlowNextStep />
  </section>
</template>
