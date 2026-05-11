<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSecurityToolsStore } from './security-tools.store.js'
import { securityToolsDbApi } from '@/modules/security-tools-db/security-tools-db.api.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'

const store = useSecurityToolsStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const isEdit = !!route.params.id
const loading = ref(false)
const submitting = ref(false)

const orgs = ref([])
const orgsLoading = ref(false)
const infoSystems = ref([])
const infoSystemsLoading = ref(false)

const catalog = ref([])
const catalogLoading = ref(false)

const form = reactive({
  organizationId: '',
  infoSystemId: '',
  catalogId: '',
  serialNumber: '',
  licenseKey: '',
  licenseExpiresAt: '',
  deployedAt: '',
  status: 'active',
  responsiblePersonId: '',
  notes: ''
})

const errors = reactive({
  organizationId: '',
  catalogId: ''
})

const STATUS_OPTIONS = [
  { value: 'active', label: 'Активна' },
  { value: 'expired', label: 'Лицензия истекла' },
  { value: 'decommissioned', label: 'Выведено из эксплуатации' }
]

function validate() {
  errors.organizationId = form.organizationId ? '' : 'Выберите организацию'
  errors.catalogId = form.catalogId ? '' : 'Выберите запись каталога СЗИ'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      organizationId: form.organizationId,
      infoSystemId: form.infoSystemId || '',
      catalogId: form.catalogId,
      serialNumber: form.serialNumber.trim(),
      licenseKey: form.licenseKey.trim(),
      licenseExpiresAt: form.licenseExpiresAt,
      deployedAt: form.deployedAt,
      status: form.status,
      responsiblePersonId: form.responsiblePersonId,
      notes: form.notes.trim()
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/security-tools/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('СЗИ добавлено.')
      router.push(`/dashboard/security-tools/${created.id}`)
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось сохранить.')
  } finally {
    submitting.value = false
  }
}

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

async function loadCatalog() {
  catalogLoading.value = true
  try {
    const data = await securityToolsDbApi.list({ page: 1, pageSize: 200 })
    catalog.value = data.items
  } finally {
    catalogLoading.value = false
  }
}

watch(
  () => form.organizationId,
  async (orgId) => {
    if (!isEdit) form.infoSystemId = ''
    await loadInfoSystems(orgId)
  }
)

onMounted(async () => {
  await Promise.all([loadOrgs(), loadCatalog()])
  if (!isEdit) {
    if (store.organizationId) {
      form.organizationId = store.organizationId
      if (store.infoSystemId && store.infoSystemId !== 'none') {
        form.infoSystemId = store.infoSystemId
      }
    }
    return
  }
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    await loadInfoSystems(x.organizationId)
    Object.assign(form, {
      organizationId: x.organizationId,
      infoSystemId: x.infoSystemId ?? '',
      catalogId: x.catalogId ?? '',
      serialNumber: x.serialNumber ?? '',
      licenseKey: x.licenseKey ?? '',
      licenseExpiresAt: x.licenseExpiresAt ?? '',
      deployedAt: x.deployedAt ?? '',
      status: x.status ?? 'active',
      responsiblePersonId: x.responsiblePersonId ?? '',
      notes: x.notes ?? ''
    })
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section>
    <h1 class="h3 mb-3">
      {{ isEdit ? 'Редактирование СЗИ' : 'Новое СЗИ' }}
    </h1>

    <div
      v-if="loading"
      class="cd-card p-4 text-center text-secondary"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <form
      v-else
      class="cd-card p-4"
      novalidate
      @submit.prevent="submit"
    >
      <div class="mb-3">
        <label class="form-label">Организация <span class="text-danger">*</span></label>
        <select
          v-model="form.organizationId"
          :class="['form-select', { 'is-invalid': errors.organizationId }]"
          :disabled="orgsLoading || isEdit"
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

      <div class="mb-3">
        <label class="form-label">Информационная система</label>
        <select
          v-model="form.infoSystemId"
          class="form-select"
          :disabled="!form.organizationId || infoSystemsLoading"
        >
          <option value="">
            — без привязки —
          </option>
          <option
            v-for="is in infoSystems"
            :key="is.id"
            :value="is.id"
          >
            {{ is.name }}
          </option>
        </select>
        <div class="form-text">
          К какой ИС применяется СЗИ. Доступны только ИС выбранной организации.
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label">СЗИ из каталога <span class="text-danger">*</span></label>
        <select
          v-model="form.catalogId"
          :class="['form-select', { 'is-invalid': errors.catalogId }]"
          :disabled="catalogLoading"
        >
          <option value="">
            — выберите —
          </option>
          <option
            v-for="c in catalog"
            :key="c.id"
            :value="c.id"
          >
            {{ c.name }}{{ c.vendor ? ` — ${c.vendor}` : '' }}
          </option>
        </select>
        <div
          v-if="errors.catalogId"
          class="invalid-feedback d-block"
        >
          {{ errors.catalogId }}
        </div>
        <div
          v-else
          class="form-text"
        >
          Если нужного СЗИ нет в каталоге — обратитесь к администратору.
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.serialNumber"
            label="Серийный номер / идентификатор"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.licenseKey"
            label="Лицензионный ключ"
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.deployedAt"
            label="Дата ввода в эксплуатацию"
            type="date"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.licenseExpiresAt"
            label="Срок действия лицензии"
            type="date"
          />
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label">Статус</label>
        <select
          v-model="form.status"
          class="form-select"
        >
          <option
            v-for="opt in STATUS_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </div>

      <FormField
        v-model="form.notes"
        label="Примечания"
        as="textarea"
      />

      <div class="d-flex gap-2">
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="submitting"
        >
          <span
            v-if="submitting"
            class="spinner-border spinner-border-sm me-2"
          />
          Сохранить
        </button>
        <button
          type="button"
          class="btn btn-outline-secondary"
          @click="router.back()"
        >
          Отмена
        </button>
      </div>
    </form>
  </section>
</template>
