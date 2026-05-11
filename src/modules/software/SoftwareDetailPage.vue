<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useSoftwareStore } from './software.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'

const store = useSoftwareStore()
const dicts = useDictionariesStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const sw = ref(null)
const org = ref(null)
const infoSystem = ref(null)
const loading = ref(false)

const CATEGORY_LABEL = { system: 'Системное', application: 'Прикладное' }
const CATEGORY_BADGE = {
  system: 'text-bg-primary',
  application: 'text-bg-info'
}
const LICENSE_LABEL = {
  commercial: 'Коммерческая',
  oem: 'OEM (поставка с устройством)',
  opensource: 'Open Source',
  free: 'Свободное распространение',
  subscription: 'Подписка',
  other: 'Иное'
}

const kindLabel = computed(() => (sw.value ? dicts.labelOf('typeApp', sw.value.kindId) : ''))

async function load() {
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    sw.value = x
    const [orgRes, isRes] = await Promise.all([
      x?.organizationId
        ? organizationApi.get(x.organizationId).catch(() => null)
        : null,
      x?.infoSystemId
        ? infoSystemsApi.get(x.infoSystemId).catch(() => null)
        : null
    ])
    org.value = orgRes
    infoSystem.value = isRes
  } catch (err) {
    toast.error(err?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
}

async function onDelete() {
  if (!sw.value) return
  const ok = await confirm.ask({
    title: 'Удалить ПО?',
    message: `Удалить «${sw.value.name}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(sw.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/software')
  } catch (err) {
    toast.error(err?.message || 'Не удалось удалить.')
  }
}

onMounted(async () => {
  dicts.load('typeApp')
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

    <template v-else-if="sw">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ sw.name }}
          </h1>
          <span :class="['badge me-2', CATEGORY_BADGE[sw.category] ?? 'text-bg-light']">
            {{ CATEGORY_LABEL[sw.category] ?? sw.category }}
          </span>
          <span class="text-secondary small">{{ kindLabel || '—' }}</span>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <RouterLink
            class="btn btn-outline-primary"
            :to="`/dashboard/software/${sw.id}/edit`"
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

      <div class="cd-card p-4">
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
            Информационная система
          </dt>
          <dd class="col-sm-9">
            <RouterLink
              v-if="infoSystem"
              :to="`/dashboard/info-systems/${infoSystem.id}`"
            >
              {{ infoSystem.name }}
            </RouterLink>
            <span
              v-else
              class="text-secondary"
            >—</span>
          </dd>

          <dt class="col-sm-3">
            Версия
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ sw.version || '—' }}
          </dd>
          <dt class="col-sm-3">
            Вендор / разработчик
          </dt>
          <dd class="col-sm-9">
            {{ sw.vendor || '—' }}
          </dd>
          <dt class="col-sm-3">
            Тип лицензии
          </dt>
          <dd class="col-sm-9">
            {{ LICENSE_LABEL[sw.licenseType] ?? sw.licenseType }}
          </dd>
          <dt class="col-sm-3">
            Сведения о лицензии
          </dt>
          <dd class="col-sm-9 text-prewrap">
            {{ sw.licenseInfo || '—' }}
          </dd>
          <dt class="col-sm-3">
            Путь установки
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ sw.installPath || '—' }}
          </dd>
          <template v-if="sw.notes">
            <dt class="col-sm-3">
              Примечания
            </dt>
            <dd class="col-sm-9 text-prewrap">
              {{ sw.notes }}
            </dd>
          </template>
          <dt class="col-sm-3">
            Создано
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(sw.createdAt) }}
          </dd>
          <dt class="col-sm-3">
            Обновлено
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(sw.updatedAt) }}
          </dd>
        </dl>
      </div>
    </template>

    <div
      v-else
      class="cd-card p-4 text-center text-secondary"
    >
      ПО не найдено.
    </div>
  </section>
</template>
