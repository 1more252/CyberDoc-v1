<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEquipmentStore } from './equipment.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'

const store = useEquipmentStore()
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
  name: '',
  kind: 'other',
  model: '',
  manufacturer: '',
  serial: '',
  inventoryNumber: '',
  yearMade: '',
  location: '',
  status: 'active',
  notes: ''
})

const errors = reactive({
  organizationId: '',
  name: '',
  yearMade: ''
})

const KIND_OPTIONS = [
  { value: 'server', label: 'Сервер' },
  { value: 'network', label: 'Сетевое оборудование' },
  { value: 'pc', label: 'ПК / Рабочая станция' },
  { value: 'printer', label: 'Принтер / МФУ' },
  { value: 'pos', label: 'Кассовое оборудование' },
  { value: 'ups', label: 'ИБП' },
  { value: 'other', label: 'Прочее' }
]
const STATUS_OPTIONS = [
  { value: 'active', label: 'В эксплуатации' },
  { value: 'repair', label: 'В ремонте' },
  { value: 'decommissioned', label: 'Списано' }
]

function validate() {
  errors.organizationId = form.organizationId ? '' : 'Выберите организацию'
  errors.name = form.name.trim() ? '' : 'Введите название'
  if (form.yearMade) {
    const y = Number(form.yearMade)
    const now = new Date().getFullYear()
    errors.yearMade = Number.isFinite(y) && y >= 1900 && y <= now + 1 ? '' : 'Некорректный год'
  } else {
    errors.yearMade = ''
  }
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      organizationId: form.organizationId,
      infoSystemId: form.infoSystemId || '',
      name: form.name.trim(),
      kind: form.kind,
      model: form.model.trim(),
      manufacturer: form.manufacturer.trim(),
      serial: form.serial.trim(),
      inventoryNumber: form.inventoryNumber.trim(),
      yearMade: form.yearMade ? Number(form.yearMade) : null,
      location: form.location.trim(),
      status: form.status,
      notes: form.notes.trim()
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/equipment/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('Оборудование добавлено.')
      router.push(`/dashboard/equipment/${created.id}`)
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
  await loadOrgs()
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
    const e = await store.fetchOne(route.params.id)
    await loadInfoSystems(e.organizationId)
    Object.assign(form, {
      organizationId: e.organizationId,
      infoSystemId: e.infoSystemId ?? '',
      name: e.name,
      kind: e.kind ?? 'other',
      model: e.model ?? '',
      manufacturer: e.manufacturer ?? '',
      serial: e.serial ?? '',
      inventoryNumber: e.inventoryNumber ?? '',
      yearMade: e.yearMade ?? '',
      location: e.location ?? '',
      status: e.status ?? 'active',
      notes: e.notes ?? ''
    })
  } catch (err) {
    toast.error(err?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section>
    <h1 class="h3 mb-3">
      {{ isEdit ? 'Редактирование оборудования' : 'Новое оборудование' }}
    </h1>

    <div
      v-if="loading"
      :class="['cd-card p-4 text-center text-secondary']"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <form
      v-else
      :class="['cd-card p-4']"
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
          Привязка к организации фиксируется при создании и не меняется.
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
          К какой ИС относится это техсредство. Доступны только ИС выбранной организации.
        </div>
      </div>

      <FormField
        v-model="form.name"
        label="Название"
        required
        :error="errors.name"
      />

      <div class="row">
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">Тип</label>
            <select
              v-model="form.kind"
              class="form-select"
            >
              <option
                v-for="opt in KIND_OPTIONS"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>
        <div class="col-md-6">
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
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.manufacturer"
            label="Производитель"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.model"
            label="Модель"
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-4">
          <FormField
            v-model="form.serial"
            label="Серийный номер"
          />
        </div>
        <div class="col-md-4">
          <FormField
            v-model="form.inventoryNumber"
            label="Инвентарный номер"
          />
        </div>
        <div class="col-md-4">
          <FormField
            v-model="form.yearMade"
            label="Год выпуска"
            type="number"
            :error="errors.yearMade"
          />
        </div>
      </div>

      <FormField
        v-model="form.location"
        label="Местонахождение"
      />

      <FormField
        v-model="form.notes"
        label="Примечания"
        as="textarea"
      />

      <div class="d-flex gap-2">
        <button
          type="submit"
          :class="['btn btn-primary']"
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
          :class="['btn btn-outline-secondary']"
          @click="router.back()"
        >
          Отмена
        </button>
      </div>
    </form>
  </section>
</template>
