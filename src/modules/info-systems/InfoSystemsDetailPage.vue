<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useInfoSystemsStore } from './info-systems.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'

const store = useInfoSystemsStore()
const dicts = useDictionariesStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const is = ref(null)
const org = ref(null)
const loading = ref(false)

const STATUS_LABEL = { draft: 'Черновик', active: 'В эксплуатации', archived: 'Архив' }
const STATUS_BADGE = {
  draft: 'text-bg-secondary',
  active: 'text-bg-success',
  archived: 'text-bg-light'
}

const typeLabel = computed(() => (is.value ? dicts.labelOf('infoSysType', is.value.typeId) : ''))
const regimLabel = computed(() => (is.value ? dicts.labelOf('regimIS', is.value.regimId) : ''))
const strukLabel = computed(() => (is.value ? dicts.labelOf('strukIS', is.value.strukId) : ''))
const inetLabel = computed(() => (is.value ? dicts.labelOf('inet_answers', is.value.inetId) : ''))
const codLabel = computed(() => (is.value ? dicts.labelOf('cod_answers', is.value.codId) : ''))

async function load() {
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    is.value = x
    if (x?.organizationId) {
      org.value = await organizationApi.get(x.organizationId).catch(() => null)
    }
  } catch (err) {
    toast.error(err?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
}

async function onDelete() {
  if (!is.value) return
  const ok = await confirm.ask({
    title: 'Удалить ИС?',
    message: `Удалить «${is.value.name}»? Связанные документы потеряют связь с этой ИС.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(is.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/info-systems')
  } catch (err) {
    toast.error(err?.message || 'Не удалось удалить.')
  }
}

onMounted(async () => {
  dicts.loadMany(['infoSysType', 'regimIS', 'strukIS', 'inet_answers', 'cod_answers'])
  await load()
})
</script>

<template>
  <section>
    <div
      v-if="loading"
      class="text-center text-secondary py-5"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <template v-else-if="is">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ is.name }}
          </h1>
          <span :class="['badge me-2', STATUS_BADGE[is.status] ?? 'text-bg-light']">
            {{ STATUS_LABEL[is.status] ?? is.status }}
          </span>
          <span class="text-secondary small">{{ typeLabel }}</span>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <RouterLink
            class="btn btn-outline-primary"
            :to="`/dashboard/info-systems/${is.id}/edit`"
          >
            <i class="bi bi-pencil me-1" /> Редактировать
          </RouterLink>
          <button
            type="button"
            class="btn btn-outline-danger"
            @click="onDelete"
          >
            <i class="bi bi-trash me-1" /> Удалить
          </button>
        </div>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Основные сведения
        </h2>
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Организация
          </dt>
          <dd class="col-sm-9">
            <RouterLink
              v-if="org"
              :to="`/dashboard/organizations/${org.id}`"
            >
              {{ org.name }}
            </RouterLink>
            <span
              v-else
              class="text-secondary"
            >—</span>
          </dd>
          <dt class="col-sm-3">
            Назначение
          </dt>
          <dd class="col-sm-9 text-prewrap">
            {{ is.purpose || '—' }}
          </dd>
          <dt class="col-sm-3">
            Класс защищённости
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ is.classification || '—' }}
          </dd>
          <dt class="col-sm-3">
            Адрес размещения
          </dt>
          <dd class="col-sm-9">
            {{ is.address || '—' }}
          </dd>
        </dl>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Классификация
        </h2>
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Тип ИС
          </dt>
          <dd class="col-sm-9">
            {{ typeLabel || '—' }}
          </dd>
          <dt class="col-sm-3">
            Режим обработки
          </dt>
          <dd class="col-sm-9">
            {{ regimLabel || '—' }}
          </dd>
          <dt class="col-sm-3">
            Структура ИС
          </dt>
          <dd class="col-sm-9">
            {{ strukLabel || '—' }}
          </dd>
          <dt class="col-sm-3">
            Подключение к интернету
          </dt>
          <dd class="col-sm-9">
            {{ inetLabel || '—' }}
          </dd>
          <dt class="col-sm-3">
            Размещение
          </dt>
          <dd class="col-sm-9">
            {{ codLabel || '—' }}
          </dd>
        </dl>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          ПДн / КИИ / ГИС
        </h2>
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Обработка ПДн
          </dt>
          <dd class="col-sm-9">
            <span :class="['badge', is.hasPdn ? 'text-bg-warning' : 'text-bg-light']">
              {{ is.hasPdn ? 'Есть' : 'Нет' }}
            </span>
            <span
              v-if="is.hasPdn && is.pdnSubjectsCount"
              class="ms-2 small text-secondary"
            >
              субъектов: {{ is.pdnSubjectsCount }}
            </span>
          </dd>
          <dt class="col-sm-3">
            Категория КИИ
          </dt>
          <dd class="col-sm-9">
            {{ is.kiiCategory || '—' }}
          </dd>
          <dt class="col-sm-3">
            Класс ГИС
          </dt>
          <dd class="col-sm-9">
            {{ is.gisLevel || '—' }}
          </dd>
        </dl>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Оператор
        </h2>
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Наименование
          </dt>
          <dd class="col-sm-9">
            {{ is.operatorName || '—' }}
          </dd>
          <dt class="col-sm-3">
            ИНН
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ is.operatorInn || '—' }}
          </dd>
          <dt class="col-sm-3">
            ОГРН
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ is.operatorOgrn || '—' }}
          </dd>
        </dl>
      </div>

      <div
        v-if="is.notes"
        class="cd-card p-4 mb-3"
      >
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Примечания
        </h2>
        <p class="mb-0 text-prewrap">
          {{ is.notes }}
        </p>
      </div>

      <div class="cd-card p-4 text-secondary small">
        Создано: {{ formatDate(is.createdAt) }} · Обновлено: {{ formatDate(is.updatedAt) }}
      </div>
    </template>

    <div
      v-else
      class="cd-card p-4 text-center text-secondary"
    >
      Информационная система не найдена.
    </div>
  </section>
</template>
