<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useEquipmentStore } from './equipment.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { saveDocx } from '@/lib/docx-runner.js'
import { formatDate } from '@/lib/format.js'

const store = useEquipmentStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const eq = ref(null)
const org = ref(null)
const infoSystem = ref(null)
const loading = ref(false)
const exporting = ref(false)

const KIND_LABEL = {
  server: 'Сервер',
  network: 'Сетевое оборудование',
  pc: 'ПК / Рабочая станция',
  printer: 'Принтер / МФУ',
  pos: 'Кассовое оборудование',
  ups: 'ИБП',
  other: 'Прочее'
}
const STATUS_LABEL = {
  active: 'В эксплуатации',
  repair: 'В ремонте',
  decommissioned: 'Списано'
}
const STATUS_BADGE = {
  active: 'text-bg-success',
  repair: 'text-bg-warning',
  decommissioned: 'text-bg-secondary'
}

const kindLabel = computed(() => (eq.value ? KIND_LABEL[eq.value.kind] ?? eq.value.kind : ''))

async function load() {
  loading.value = true
  try {
    const e = await store.fetchOne(route.params.id)
    eq.value = e
    const [orgRes, isRes] = await Promise.all([
      e?.organizationId
        ? organizationApi.get(e.organizationId).catch(() => null)
        : null,
      e?.infoSystemId
        ? infoSystemsApi.get(e.infoSystemId).catch(() => null)
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

async function onExportOne() {
  if (!eq.value) return
  exporting.value = true
  try {
    const filename = `equipment-${eq.value.inventoryNumber || eq.value.id}.docx`
    await saveDocx('equipment-card', { equipment: eq.value, organization: org.value }, filename)
    toast.success('Карточка скачана.')
  } catch (err) {
    toast.error(err?.message || 'Не удалось собрать DOCX.')
  } finally {
    exporting.value = false
  }
}

async function onDelete() {
  if (!eq.value) return
  const ok = await confirm.ask({
    title: 'Удалить оборудование?',
    message: `Удалить «${eq.value.name}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(eq.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/equipment')
  } catch (err) {
    toast.error(err?.message || 'Не удалось удалить.')
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div
      v-if="loading"
      class="text-center text-secondary py-5"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <template v-else-if="eq">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ eq.name }}
          </h1>
          <span :class="['badge me-2', STATUS_BADGE[eq.status] ?? 'text-bg-light']">
            {{ STATUS_LABEL[eq.status] ?? eq.status }}
          </span>
          <span class="text-secondary small">{{ kindLabel }}</span>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button
            type="button"
            :class="['btn btn-outline-success']"
            :disabled="exporting"
            @click="onExportOne"
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
          <RouterLink
            :class="['btn btn-outline-primary']"
            :to="`/dashboard/equipment/${eq.id}/edit`"
          >
            <i class="bi bi-pencil me-1" /> Редактировать
          </RouterLink>
          <button
            type="button"
            :class="['btn btn-outline-danger']"
            @click="onDelete"
          >
            <i class="bi bi-trash me-1" /> Удалить
          </button>
        </div>
      </div>

      <div :class="['cd-card p-4']">
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
            Производитель
          </dt>
          <dd class="col-sm-9">
            {{ eq.manufacturer || '—' }}
          </dd>
          <dt class="col-sm-3">
            Модель
          </dt>
          <dd class="col-sm-9">
            {{ eq.model || '—' }}
          </dd>
          <dt class="col-sm-3">
            Серийный номер
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ eq.serial || '—' }}
          </dd>
          <dt class="col-sm-3">
            Инвентарный номер
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ eq.inventoryNumber || '—' }}
          </dd>
          <dt class="col-sm-3">
            Год выпуска
          </dt>
          <dd class="col-sm-9">
            {{ eq.yearMade || '—' }}
          </dd>
          <dt class="col-sm-3">
            Местонахождение
          </dt>
          <dd class="col-sm-9">
            {{ eq.location || '—' }}
          </dd>
          <template v-if="eq.notes">
            <dt class="col-sm-3">
              Примечания
            </dt>
            <dd class="col-sm-9 text-prewrap">
              {{ eq.notes }}
            </dd>
          </template>
          <dt class="col-sm-3">
            Создано
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(eq.createdAt) }}
          </dd>
          <dt class="col-sm-3">
            Обновлено
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(eq.updatedAt) }}
          </dd>
        </dl>
      </div>
    </template>

    <div
      v-else
      :class="['cd-card p-4 text-center text-secondary']"
    >
      Оборудование не найдено.
    </div>
  </section>
</template>
