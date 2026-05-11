<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useRegistryStore } from './registry.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { equipmentApi } from '@/modules/equipment/equipment.api.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { saveDocx } from '@/lib/docx-runner.js'
import { formatDate, formatDateTime } from '@/lib/format.js'

const store = useRegistryStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const doc = ref(null)
const org = ref(null)
const equipment = ref(null)
const loading = ref(false)
const exporting = ref(false)
const acting = ref(false)

const TYPE_LABEL = {
  act: 'Акт',
  contract: 'Договор',
  protocol: 'Протокол',
  order: 'Приказ',
  report: 'Отчёт'
}
const STATUS_LABEL = {
  draft: 'Черновик',
  pending: 'На согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено'
}
const STATUS_BADGE = {
  draft: 'text-bg-secondary',
  pending: 'text-bg-warning',
  approved: 'text-bg-success',
  rejected: 'text-bg-danger'
}

const isOwner = computed(() => doc.value?.ownerUsername === auth.user?.username)
const canSubmit = computed(
  () => doc.value && ['draft', 'rejected'].includes(doc.value.status) && (isOwner.value || auth.role === 'admin')
)
const canEdit = computed(
  () => doc.value && ['draft', 'rejected'].includes(doc.value.status) && (isOwner.value || auth.role === 'admin')
)
const canReview = computed(
  () => doc.value?.status === 'pending' && ['expert', 'admin'].includes(auth.role)
)
const canDelete = computed(
  () => doc.value && (doc.value.status !== 'approved' || auth.role === 'admin')
)

async function load() {
  loading.value = true
  try {
    const d = await store.fetchOne(route.params.id)
    doc.value = d
    if (d?.organizationId) {
      org.value = await organizationApi.get(d.organizationId).catch(() => null)
    }
    if (d?.equipmentId) {
      equipment.value = await equipmentApi.get(d.equipmentId).catch(() => null)
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
}

async function onSubmit() {
  if (!doc.value) return
  acting.value = true
  try {
    doc.value = await store.submit(doc.value.id)
    toast.success('Отправлено на согласование.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось отправить.')
  } finally {
    acting.value = false
  }
}

async function onApprove() {
  if (!doc.value) return
  const ok = await confirm.ask({
    title: 'Согласовать документ?',
    message: `Согласовать «${doc.value.title}»? Документ станет недоступен для редактирования владельцем.`,
    okText: 'Согласовать',
    variant: 'success'
  })
  if (!ok) return
  acting.value = true
  try {
    doc.value = await store.approve(doc.value.id, '')
    toast.success('Документ согласован.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось согласовать.')
  } finally {
    acting.value = false
  }
}

async function onReject() {
  if (!doc.value) return
  const comment = window.prompt('Причина отклонения (обязательно):')
  if (!comment?.trim()) {
    if (comment !== null) toast.warning('Нужен комментарий с причиной.')
    return
  }
  acting.value = true
  try {
    doc.value = await store.reject(doc.value.id, comment.trim())
    toast.success('Документ отклонён, отправлен на доработку.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось отклонить.')
  } finally {
    acting.value = false
  }
}

async function onDelete() {
  if (!doc.value) return
  const ok = await confirm.ask({
    title: 'Удалить документ?',
    message: `Удалить «${doc.value.title}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(doc.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/registry')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

async function onExportDocx() {
  if (!doc.value) return
  exporting.value = true
  try {
    const tag = doc.value.number || doc.value.id
    const filename = `document-${tag}.docx`
    await saveDocx('document', { document: doc.value, organization: org.value }, filename)
    toast.success('DOCX скачан.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось собрать DOCX.')
  } finally {
    exporting.value = false
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

    <template v-else-if="doc">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ doc.title }}
          </h1>
          <span :class="['badge me-2', STATUS_BADGE[doc.status] ?? 'text-bg-light']">
            {{ STATUS_LABEL[doc.status] ?? doc.status }}
          </span>
          <span class="text-secondary small">
            {{ TYPE_LABEL[doc.type] ?? doc.type }}
            <template v-if="doc.number">· №&nbsp;{{ doc.number }}</template>
            <template v-if="doc.date">· {{ doc.date }}</template>
          </span>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button
            type="button"
            :class="['btn btn-outline-success']"
            :disabled="exporting"
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
            DOCX
          </button>
          <button
            v-if="canSubmit"
            type="button"
            :class="['btn btn-primary']"
            :disabled="acting"
            @click="onSubmit"
          >
            <i class="bi bi-send me-1" /> На согласование
          </button>
          <button
            v-if="canReview"
            type="button"
            :class="['btn btn-success']"
            :disabled="acting"
            @click="onApprove"
          >
            <i class="bi bi-check-lg me-1" /> Согласовать
          </button>
          <button
            v-if="canReview"
            type="button"
            :class="['btn btn-warning']"
            :disabled="acting"
            @click="onReject"
          >
            <i class="bi bi-x-lg me-1" /> Отклонить
          </button>
          <RouterLink
            v-if="canEdit"
            :class="['btn btn-outline-primary']"
            :to="`/dashboard/registry/${doc.id}/edit`"
          >
            <i class="bi bi-pencil me-1" /> Редактировать
          </RouterLink>
          <button
            v-if="canDelete"
            type="button"
            :class="['btn btn-outline-danger']"
            @click="onDelete"
          >
            <i class="bi bi-trash me-1" /> Удалить
          </button>
        </div>
      </div>

      <div :class="['cd-card p-4 mb-3']">
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
          <template v-if="equipment">
            <dt class="col-sm-3">
              Оборудование
            </dt>
            <dd class="col-sm-9">
              <RouterLink :to="`/dashboard/equipment/${equipment.id}`">
                {{ equipment.name }}
              </RouterLink>
              <span class="text-secondary small ms-2">
                ({{ equipment.inventoryNumber || '—' }})
              </span>
            </dd>
          </template>
          <dt class="col-sm-3">
            Автор
          </dt>
          <dd class="col-sm-9">
            {{ doc.ownerUsername }}
          </dd>
          <dt class="col-sm-3">
            Создан
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(doc.createdAt) }}
          </dd>
          <dt class="col-sm-3">
            Обновлён
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(doc.updatedAt) }}
          </dd>
          <template v-if="doc.reviewedBy">
            <dt class="col-sm-3">
              Рассмотрел
            </dt>
            <dd class="col-sm-9">
              {{ doc.reviewedBy }}
              <span class="text-secondary small ms-2">{{ formatDateTime(doc.reviewedAt) }}</span>
            </dd>
          </template>
        </dl>
      </div>

      <div
        v-if="doc.status === 'rejected' && doc.reviewComment"
        :class="['cd-card p-3 mb-3 border border-danger-subtle']"
      >
        <strong class="text-danger">Замечания:</strong>
        <p class="mb-0 mt-1 text-prewrap">
          {{ doc.reviewComment }}
        </p>
      </div>

      <div :class="['cd-card p-4']">
        <h2 class="h6 text-secondary mb-3">
          Текст документа
        </h2>
        <p class="mb-0 text-prewrap">
          {{ doc.content || '—' }}
        </p>
      </div>
    </template>

    <div
      v-else
      :class="['cd-card p-4 text-center text-secondary']"
    >
      Документ не найден.
    </div>
  </section>
</template>
