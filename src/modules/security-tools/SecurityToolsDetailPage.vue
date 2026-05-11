<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useSecurityToolsStore } from './security-tools.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'

const store = useSecurityToolsStore()
const dicts = useDictionariesStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const item = ref(null)
const org = ref(null)
const infoSystem = ref(null)
const loading = ref(false)

const STATUS_LABEL = {
  active: 'Активна',
  expired: 'Лицензия истекла',
  decommissioned: 'Выведено из эксплуатации'
}
const STATUS_BADGE = {
  active: 'text-bg-success',
  expired: 'text-bg-danger',
  decommissioned: 'text-bg-secondary'
}

const kindLabel = computed(() =>
  item.value?.catalog ? dicts.labelOf('typeSzi', item.value.catalog.kindId) : ''
)

const expiry = computed(() => {
  const v = item.value?.licenseExpiresAt
  if (!v) return null
  const d = new Date(v).getTime()
  if (Number.isNaN(d)) return null
  const days = Math.round((d - Date.now()) / (24 * 3600 * 1000))
  if (days < 0) return { cls: 'text-bg-danger', text: `Истёк ${v} (${-days} дн. назад)` }
  if (days < 30) return { cls: 'text-bg-warning', text: `${v} (через ${days} дн.)` }
  return { cls: 'text-bg-light', text: v }
})

async function load() {
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    item.value = x
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
  if (!item.value) return
  const ok = await confirm.ask({
    title: 'Удалить экземпляр СЗИ?',
    message: `Удалить «${item.value.catalog?.name || item.value.serialNumber || item.value.id}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(item.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/security-tools')
  } catch (err) {
    toast.error(err?.message || 'Не удалось удалить.')
  }
}

onMounted(async () => {
  dicts.load('typeSzi')
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

    <template v-else-if="item">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ item.catalog?.name || '— без записи каталога —' }}
          </h1>
          <span :class="['badge me-2', STATUS_BADGE[item.status] ?? 'text-bg-light']">
            {{ STATUS_LABEL[item.status] ?? item.status }}
          </span>
          <span class="text-secondary small">{{ kindLabel || '—' }}</span>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <RouterLink
            class="btn btn-outline-primary"
            :to="`/dashboard/security-tools/${item.id}/edit`"
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
          Карточка СЗИ (из каталога)
        </h2>
        <dl
          v-if="item.catalog"
          class="row mb-0"
        >
          <dt class="col-sm-3">
            Запись каталога
          </dt>
          <dd class="col-sm-9">
            <RouterLink :to="`/dashboard/security-tools-db/${item.catalog.id}`">
              {{ item.catalog.name }}
            </RouterLink>
          </dd>
          <dt class="col-sm-3">
            Вендор
          </dt>
          <dd class="col-sm-9">
            {{ item.catalog.vendor || '—' }}
          </dd>
          <dt class="col-sm-3">
            Сертификат ФСТЭК
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ item.catalog.certNumber || '—' }}
          </dd>
          <dt class="col-sm-3">
            Класс защиты
          </dt>
          <dd class="col-sm-9">
            {{ item.catalog.certClass || '—' }}
          </dd>
        </dl>
        <p
          v-else
          class="text-secondary mb-0"
        >
          Запись каталога не найдена (возможно, удалена администратором).
        </p>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Развёртывание
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
            Серийный номер
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ item.serialNumber || '—' }}
          </dd>
          <dt class="col-sm-3">
            Лицензионный ключ
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ item.licenseKey || '—' }}
          </dd>
          <dt class="col-sm-3">
            Дата ввода
          </dt>
          <dd class="col-sm-9">
            {{ item.deployedAt || '—' }}
          </dd>
          <dt class="col-sm-3">
            Срок лицензии
          </dt>
          <dd class="col-sm-9">
            <span
              v-if="expiry"
              :class="['badge', expiry.cls]"
            >
              {{ expiry.text }}
            </span>
            <span
              v-else
              class="text-secondary"
            >—</span>
          </dd>
        </dl>
      </div>

      <div
        v-if="item.notes"
        class="cd-card p-4 mb-3"
      >
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Примечания
        </h2>
        <p class="mb-0 text-prewrap">
          {{ item.notes }}
        </p>
      </div>

      <div class="cd-card p-4 text-secondary small">
        Создано: {{ formatDate(item.createdAt) }} ·
        Обновлено: {{ formatDate(item.updatedAt) }}
      </div>
    </template>

    <div
      v-else
      class="cd-card p-4 text-center text-secondary"
    >
      Экземпляр СЗИ не найден.
    </div>
  </section>
</template>
