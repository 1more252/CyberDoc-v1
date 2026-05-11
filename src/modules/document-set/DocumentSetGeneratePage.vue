<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useDocumentSetStore } from './document-set.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { personalApi } from '@/modules/personal/personal.api.js'
import { equipmentApi } from '@/modules/equipment/equipment.api.js'
import { softwareApi } from '@/modules/software/software.api.js'
import { securityToolsApi } from '@/modules/security-tools/security-tools.api.js'
import { runDocxTask } from '@/lib/docx-runner.js'
import { saveAs } from 'file-saver'
import { useToast } from '@/ui/useToast.js'

const store = useDocumentSetStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const orgs = ref([])
const orgsLoading = ref(false)
const infoSystems = ref([])
const infoSystemsLoading = ref(false)

const form = reactive({
  templateId: '',
  organizationId: '',
  infoSystemId: ''
})
const errors = reactive({
  templateId: '',
  organizationId: '',
  infoSystemId: ''
})

const generating = ref(false)
const progress = ref({ done: 0, total: 0 })
const lastFile = ref(null)

const selectedTemplate = computed(() => {
  if (!form.templateId) return null
  return store.getTemplate(form.templateId)
})
const requiresIs = computed(() => Boolean(selectedTemplate.value?.requiresIs))

async function loadOrgs() {
  orgsLoading.value = true
  try {
    const res = await organizationApi.list({ page: 1, pageSize: 200 })
    orgs.value = res.items
  } finally {
    orgsLoading.value = false
  }
}

async function loadInfoSystems(orgId) {
  if (!orgId) {
    infoSystems.value = []
    return
  }
  infoSystemsLoading.value = true
  try {
    const res = await infoSystemsApi.list({ page: 1, pageSize: 200, organizationId: orgId })
    infoSystems.value = res.items
  } finally {
    infoSystemsLoading.value = false
  }
}

watch(
  () => form.organizationId,
  async (orgId) => {
    form.infoSystemId = ''
    await loadInfoSystems(orgId)
  }
)

watch(
  () => form.templateId,
  (id) => {
    const tpl = store.getTemplate(id)
    if (!tpl?.requiresIs) form.infoSystemId = ''
  }
)

function validate() {
  errors.templateId = form.templateId ? '' : 'Выберите шаблон'
  errors.organizationId = form.organizationId ? '' : 'Выберите организацию'
  errors.infoSystemId = requiresIs.value && !form.infoSystemId ? 'Выберите ИС' : ''
  return !Object.values(errors).some(Boolean)
}

async function collectContext(org, infoSystem) {
  const [personalRes, equipmentRes, softwareRes, sziRes, infoSystemsRes] = await Promise.all([
    personalApi.list({ page: 1, pageSize: 200, organizationId: org.id }),
    equipmentApi.list({
      page: 1,
      pageSize: 500,
      organizationId: org.id,
      infoSystemId: infoSystem?.id ?? ''
    }),
    softwareApi.list({
      page: 1,
      pageSize: 500,
      organizationId: org.id,
      infoSystemId: infoSystem?.id ?? ''
    }),
    securityToolsApi.list({
      page: 1,
      pageSize: 500,
      organizationId: org.id,
      infoSystemId: infoSystem?.id ?? ''
    }),
    infoSystem
      ? Promise.resolve({ items: [] })
      : infoSystemsApi.list({ page: 1, pageSize: 200, organizationId: org.id })
  ])
  return {
    personal: personalRes.items,
    equipment: equipmentRes.items,
    software: softwareRes.items,
    securityTools: sziRes.items,
    infoSystems: infoSystemsRes.items
  }
}

function buildFilename(org, infoSystem, tpl) {
  const today = new Date().toISOString().slice(0, 10)
  const slug = (s) =>
    String(s ?? '')
      .replace(/[\\/:*?"<>|«»]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'без_названия'
  const parts = ['ОРД']
  if (tpl?.name) parts.push(slug(tpl.name))
  if (org?.name) parts.push(slug(org.name))
  if (infoSystem?.name) parts.push(slug(infoSystem.name))
  parts.push(today)
  return `${parts.join('_')}.docx`
}

async function generate() {
  if (!validate() || generating.value) return
  const tpl = selectedTemplate.value
  const org = orgs.value.find((o) => o.id === form.organizationId)
  if (!tpl || !org) return
  const infoSystem = tpl.requiresIs
    ? infoSystems.value.find((i) => i.id === form.infoSystemId) ?? null
    : null

  generating.value = true
  progress.value = { done: 0, total: tpl.sections.length }
  if (lastFile.value?.blobUrl) {
    URL.revokeObjectURL(lastFile.value.blobUrl)
    lastFile.value = null
  }

  try {
    const ctx = await collectContext(org, infoSystem)
    const blob = await runDocxTask(
      'document-set',
      {
        template: tpl,
        organization: org,
        infoSystem,
        infoSystems: ctx.infoSystems,
        personal: ctx.personal,
        equipment: ctx.equipment,
        software: ctx.software,
        securityTools: ctx.securityTools
      },
      (done, total) => {
        progress.value = { done, total }
      }
    )
    const filename = buildFilename(org, infoSystem, tpl)
    saveAs(blob, filename)
    // Сохраняем для повторного скачивания в течение сессии без второй
    // генерации.
    lastFile.value = { filename, blobUrl: URL.createObjectURL(blob) }

    // Пишем факт генерации в историю. Если запись не сохранится —
    // не катастрофа, файл уже у пользователя; покажем неблокирующий
    // toast и предложим повторить.
    try {
      await store.create({
        templateId: tpl.id,
        organizationId: org.id,
        infoSystemId: infoSystem?.id ?? '',
        filename,
        sectionsCount: tpl.sections.length
      })
      toast.success('Пакет ОРД сгенерирован и сохранён в историю.')
    } catch (e) {
      toast.error('Файл создан, но не удалось записать в историю: ' + (e?.message || ''))
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось сгенерировать пакет.')
  } finally {
    generating.value = false
  }
}

function downloadAgain() {
  if (!lastFile.value) return
  const a = document.createElement('a')
  a.href = lastFile.value.blobUrl
  a.download = lastFile.value.filename
  a.click()
}

onMounted(async () => {
  await Promise.all([loadOrgs(), store.loadTemplates()])

  // Префилл из query (?template=...&organizationId=...&infoSystemId=...).
  // Это поддерживает переход с DocumentSetListPage по «Сгенерировать» на
  // карточке шаблона.
  const q = route.query
  if (q.template && store.getTemplate(String(q.template))) {
    form.templateId = String(q.template)
  }
  if (q.organizationId && orgs.value.some((o) => o.id === q.organizationId)) {
    form.organizationId = String(q.organizationId)
    await loadInfoSystems(form.organizationId)
    if (q.infoSystemId && infoSystems.value.some((i) => i.id === q.infoSystemId)) {
      form.infoSystemId = String(q.infoSystemId)
    }
  }
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Генерация пакета ОРД
      </h1>
      <RouterLink
        class="btn btn-outline-secondary"
        to="/dashboard/document-sets"
      >
        <i class="bi bi-arrow-left me-1" /> К списку
      </RouterLink>
    </div>

    <form
      class="cd-card p-4"
      novalidate
      @submit.prevent="generate"
    >
      <div class="mb-3">
        <label class="form-label">Шаблон <span class="text-danger">*</span></label>
        <select
          v-model="form.templateId"
          :class="['form-select', { 'is-invalid': errors.templateId }]"
          :disabled="store.templatesLoading"
        >
          <option value="">
            — выберите —
          </option>
          <option
            v-for="t in store.templates"
            :key="t.id"
            :value="t.id"
          >
            {{ t.name }}
          </option>
        </select>
        <div
          v-if="errors.templateId"
          class="invalid-feedback d-block"
        >
          {{ errors.templateId }}
        </div>
        <div
          v-if="selectedTemplate"
          class="form-text"
        >
          {{ selectedTemplate.description }}
          <span class="ms-2 text-secondary">
            Разделов: {{ selectedTemplate.sections.length }}.
          </span>
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label">Организация <span class="text-danger">*</span></label>
        <select
          v-model="form.organizationId"
          :class="['form-select', { 'is-invalid': errors.organizationId }]"
          :disabled="orgsLoading"
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
        <div
          v-if="errors.organizationId"
          class="invalid-feedback d-block"
        >
          {{ errors.organizationId }}
        </div>
      </div>

      <div
        v-if="requiresIs"
        class="mb-3"
      >
        <label class="form-label">Информационная система <span class="text-danger">*</span></label>
        <select
          v-model="form.infoSystemId"
          :class="['form-select', { 'is-invalid': errors.infoSystemId }]"
          :disabled="!form.organizationId || infoSystemsLoading"
        >
          <option value="">
            — выберите —
          </option>
          <option
            v-for="is in infoSystems"
            :key="is.id"
            :value="is.id"
          >
            {{ is.name }}
          </option>
        </select>
        <div
          v-if="errors.infoSystemId"
          class="invalid-feedback d-block"
        >
          {{ errors.infoSystemId }}
        </div>
        <div class="form-text">
          Шаблон содержит секции с привязкой к ИС (классификация, перечни ТС/ПО/СЗИ).
        </div>
      </div>
      <div
        v-else-if="selectedTemplate"
        class="mb-3"
      >
        <div class="alert alert-secondary mb-0 py-2 small">
          <i class="bi bi-info-circle me-1" />
          Шаблон формируется на уровне организации — выбор ИС не требуется.
        </div>
      </div>

      <div
        v-if="generating"
        class="mb-3"
      >
        <label class="form-label small text-secondary">
          Генерация… ({{ progress.done }} / {{ progress.total }} разделов)
        </label>
        <div class="progress">
          <div
            class="progress-bar progress-bar-striped progress-bar-animated"
            :style="{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }"
          />
        </div>
      </div>

      <div
        v-if="lastFile && !generating"
        class="alert alert-success py-2 small d-flex justify-content-between align-items-center"
      >
        <span>
          <i class="bi bi-check2-circle me-1" />
          Файл «{{ lastFile.filename }}» сохранён.
        </span>
        <button
          type="button"
          class="btn btn-sm btn-outline-success"
          @click="downloadAgain"
        >
          <i class="bi bi-download me-1" /> Скачать ещё раз
        </button>
      </div>

      <div class="d-flex gap-2">
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="generating"
        >
          <span
            v-if="generating"
            class="spinner-border spinner-border-sm me-2"
          />
          <i
            v-else
            class="bi bi-file-earmark-word me-1"
          />
          Сгенерировать DOCX
        </button>
        <button
          type="button"
          class="btn btn-outline-secondary"
          :disabled="generating"
          @click="router.push('/dashboard/document-sets')"
        >
          Отмена
        </button>
      </div>
    </form>
  </section>
</template>
