<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSoftwareStore } from './software.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'
import DictionarySelect from '@/modules/dictionaries/DictionarySelect.vue'

const store = useSoftwareStore()
const dicts = useDictionariesStore()
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

const form = reactive({
  organizationId: '',
  infoSystemId: '',
  category: 'application',
  kindId: '',
  name: '',
  version: '',
  vendor: '',
  licenseType: 'commercial',
  licenseInfo: '',
  installPath: '',
  notes: ''
})

const errors = reactive({
  organizationId: '',
  name: ''
})

const LICENSE_OPTIONS = [
  { value: 'commercial', label: 'Коммерческая' },
  { value: 'oem', label: 'OEM (поставка с устройством)' },
  { value: 'opensource', label: 'Open Source' },
  { value: 'free', label: 'Свободное распространение' },
  { value: 'subscription', label: 'Подписка' },
  { value: 'other', label: 'Иное' }
]

function validate() {
  errors.organizationId = form.organizationId ? '' : 'Выберите организацию'
  errors.name = form.name.trim() ? '' : 'Введите название ПО'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      organizationId: form.organizationId,
      infoSystemId: form.infoSystemId || '',
      category: form.category,
      kindId: form.kindId,
      name: form.name.trim(),
      version: form.version.trim(),
      vendor: form.vendor.trim(),
      licenseType: form.licenseType,
      licenseInfo: form.licenseInfo.trim(),
      installPath: form.installPath.trim(),
      notes: form.notes.trim()
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/software/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('ПО добавлено.')
      router.push(`/dashboard/software/${created.id}`)
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

watch(
  () => form.organizationId,
  async (orgId) => {
    if (!isEdit) form.infoSystemId = ''
    await loadInfoSystems(orgId)
  }
)

onMounted(async () => {
  dicts.load('typeApp')
  await loadOrgs()
  if (!isEdit) {
    if (store.organizationId) {
      form.organizationId = store.organizationId
      if (store.infoSystemId && store.infoSystemId !== 'none') {
        form.infoSystemId = store.infoSystemId
      }
    }
    if (store.category) form.category = store.category
    return
  }
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    await loadInfoSystems(x.organizationId)
    Object.assign(form, {
      organizationId: x.organizationId,
      infoSystemId: x.infoSystemId ?? '',
      category: x.category ?? 'application',
      kindId: x.kindId ?? '',
      name: x.name,
      version: x.version ?? '',
      vendor: x.vendor ?? '',
      licenseType: x.licenseType ?? 'commercial',
      licenseInfo: x.licenseInfo ?? '',
      installPath: x.installPath ?? '',
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
      {{ isEdit ? 'Редактирование ПО' : 'Новое ПО' }}
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
        <div
          v-else-if="isEdit"
          class="form-text"
        >
          Привязка к организации фиксируется при создании.
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
          К какой ИС относится это ПО. Доступны только ИС выбранной организации.
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label d-block">Категория ПО</label>
        <div class="btn-group">
          <input
            id="cat-system"
            v-model="form.category"
            type="radio"
            class="btn-check"
            value="system"
          >
          <label
            class="btn btn-outline-primary"
            for="cat-system"
          >Системное</label>

          <input
            id="cat-application"
            v-model="form.category"
            type="radio"
            class="btn-check"
            value="application"
          >
          <label
            class="btn btn-outline-primary"
            for="cat-application"
          >Прикладное</label>
        </div>
        <div class="form-text">
          Системное — ОС, СУБД, утилиты. Прикладное — учётные/бизнес-системы, офис.
        </div>
      </div>

      <DictionarySelect
        v-model="form.kindId"
        dict="typeApp"
        label="Тип ПО"
        hint="Категория из справочника. Влияет на отчёты и фильтры."
      />

      <FormField
        v-model="form.name"
        label="Название"
        required
        :error="errors.name"
      />

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.version"
            label="Версия"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.vendor"
            label="Вендор / разработчик"
          />
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label">Тип лицензии</label>
        <select
          v-model="form.licenseType"
          class="form-select"
        >
          <option
            v-for="opt in LICENSE_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </div>

      <FormField
        v-model="form.licenseInfo"
        label="Сведения о лицензии"
        as="textarea"
        :rows="2"
        hint="Номер лицензии, срок, количество мест, условия."
      />

      <FormField
        v-model="form.installPath"
        label="Путь установки"
      />

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
