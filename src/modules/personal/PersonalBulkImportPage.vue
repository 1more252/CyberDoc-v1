<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePersonalStore } from './personal.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { parsePersonalFile } from '@/lib/personal-import-runner.js'
import { useToast } from '@/ui/useToast.js'

const store = usePersonalStore()
const toast = useToast()
const router = useRouter()

const orgs = ref([])
const orgsLoading = ref(false)
const organizationId = ref('')

const fileRef = ref(null)
const file = ref(null)

const phase = ref('idle')
const parseProgress = ref({ done: 0, total: 0 })
const parsedItems = ref([])
const parseErrors = ref([])
const uploadResult = ref(null)

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'parse':
      return `Чтение файла: ${parseProgress.value.done} / ${parseProgress.value.total}`
    case 'upload': {
      const { done, total } = store.importProgress
      return `Загрузка на сервер: ${done} / ${total}`
    }
    case 'done':
      return 'Готово'
    default:
      return ''
  }
})

const inProgress = computed(() => phase.value === 'parse' || phase.value === 'upload')

async function loadOrgs() {
  orgsLoading.value = true
  try {
    const res = await organizationApi.list({ page: 1, pageSize: 200 })
    orgs.value = res.items
    if (orgs.value.length === 1) organizationId.value = orgs.value[0].id
  } finally {
    orgsLoading.value = false
  }
}

function onFileChange(e) {
  const f = e.target.files?.[0] || null
  file.value = f
  parsedItems.value = []
  parseErrors.value = []
  uploadResult.value = null
  phase.value = 'idle'
}

async function onStart() {
  if (!organizationId.value) {
    toast.warning('Выберите организацию.')
    return
  }
  if (!file.value) {
    toast.warning('Выберите файл (CSV / TSV).')
    return
  }

  phase.value = 'parse'
  parseProgress.value = { done: 0, total: 0 }
  try {
    const { items, errors } = await parsePersonalFile(file.value, (done, total) => {
      parseProgress.value = { done, total }
    })
    parsedItems.value = items
    parseErrors.value = errors
    if (!items.length) {
      phase.value = 'done'
      toast.error('Файл не дал ни одной валидной строки. Проверьте заголовки.')
      return
    }
  } catch (err) {
    phase.value = 'idle'
    toast.error(err?.message || 'Не удалось прочитать файл.')
    return
  }

  phase.value = 'upload'
  try {
    const result = await store.bulkImport(organizationId.value, parsedItems.value)
    uploadResult.value = result
    phase.value = 'done'
    toast.success(`Сохранено: ${result.saved.length}.`)
  } catch (err) {
    phase.value = 'done'
    toast.error(err?.message || 'Загрузка не завершилась.')
  }
}

function onReset() {
  file.value = null
  parsedItems.value = []
  parseErrors.value = []
  uploadResult.value = null
  phase.value = 'idle'
  if (fileRef.value) fileRef.value.value = ''
}

function goToList() {
  router.push('/dashboard/personal')
}

onMounted(loadOrgs)
</script>

<template>
  <section>
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h1 class="h3 mb-0">
        Импорт персонала из CSV
      </h1>
      <button
        type="button"
        class="btn btn-outline-secondary"
        @click="goToList"
      >
        К списку
      </button>
    </div>

    <div class="cd-card p-4 mb-3">
      <h2 class="h6 text-secondary text-uppercase mb-3">
        Шаг 1 — выбор организации и файла
      </h2>

      <div class="mb-3">
        <label class="form-label">Организация <span class="text-danger">*</span></label>
        <select
          v-model="organizationId"
          class="form-select"
          :disabled="orgsLoading || inProgress"
        >
          <option value="">
            — выберите —
          </option>
          <option
            v-for="o in orgs"
            :key="o.id"
            :value="o.id"
          >
            {{ o.name }}
          </option>
        </select>
        <div class="form-text">
          Все импортируемые сотрудники будут привязаны к этой организации.
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label">Файл (CSV / TSV / TXT, UTF-8)</label>
        <input
          ref="fileRef"
          type="file"
          class="form-control"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          :disabled="inProgress"
          @change="onFileChange"
        >
        <div class="form-text">
          Заголовки (любые из): <code>Фамилия / lastName</code>, <code>Имя / firstName</code>
          (обязательно), <code>Отчество</code>, <code>Должность</code>, <code>Подразделение</code>,
          <code>Телефон</code>, <code>Email</code>, <code>Админ.права</code>, <code>Примечания</code>.
          Разделитель — запятая, точка с запятой или табуляция (определяется автоматически).
        </div>
      </div>

      <div class="d-flex gap-2 align-items-center">
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!file || !organizationId || inProgress"
          @click="onStart"
        >
          <span
            v-if="inProgress"
            class="spinner-border spinner-border-sm me-2"
          />
          <i
            v-else
            class="bi bi-cloud-upload me-1"
          />
          Запустить импорт
        </button>
        <button
          v-if="file && phase !== 'idle'"
          type="button"
          class="btn btn-outline-secondary"
          :disabled="inProgress"
          @click="onReset"
        >
          Сбросить
        </button>
        <span
          v-if="phaseLabel"
          class="small text-secondary"
        >
          {{ phaseLabel }}
        </span>
      </div>
    </div>

    <div
      v-if="phase !== 'idle'"
      class="cd-card p-4 mb-3"
    >
      <h2 class="h6 text-secondary text-uppercase mb-3">
        Результат
      </h2>
      <ul class="list-unstyled mb-0 small">
        <li>Распознано строк: <b>{{ parsedItems.length }}</b></li>
        <li>
          Ошибок парсинга:
          <b :class="parseErrors.length ? 'text-danger' : 'text-success'">
            {{ parseErrors.length }}
          </b>
        </li>
        <li v-if="uploadResult">
          Сохранено в БД (новых + обновлённых): <b class="text-success">{{ uploadResult.saved.length }}</b>
        </li>
        <li v-if="uploadResult?.errors?.length">
          Ошибок при сохранении: <b class="text-danger">{{ uploadResult.errors.length }}</b>
        </li>
      </ul>

      <details
        v-if="parseErrors.length"
        class="mt-3"
      >
        <summary class="small text-danger">
          Пропущенные строки ({{ parseErrors.length }})
        </summary>
        <ul class="small text-secondary mt-2 mb-0">
          <li
            v-for="(e, i) in parseErrors.slice(0, 50)"
            :key="i"
          >
            Строка {{ e.row }}: {{ e.error }}<span v-if="e.detail"> — {{ e.detail }}</span>
          </li>
          <li v-if="parseErrors.length > 50">
            … и ещё {{ parseErrors.length - 50 }}
          </li>
        </ul>
      </details>

      <div
        v-if="phase === 'done' && uploadResult?.saved?.length"
        class="mt-3"
      >
        <button
          type="button"
          class="btn btn-outline-primary"
          @click="goToList"
        >
          <i class="bi bi-list me-1" /> Перейти к списку персонала
        </button>
      </div>
    </div>
  </section>
</template>
