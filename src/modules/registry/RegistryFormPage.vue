<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRegistryStore } from './registry.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { equipmentApi } from '@/modules/equipment/equipment.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'

const store = useRegistryStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const isEdit = !!route.params.id
const loading = ref(false)
const submitting = ref(false)

const orgs = ref([])
const orgsLoading = ref(false)
const equipment = ref([])
const equipmentLoading = ref(false)

const form = reactive({
  organizationId: '',
  equipmentId: '',
  title: '',
  type: 'act',
  number: '',
  date: '',
  content: ''
})

const errors = reactive({
  organizationId: '',
  title: ''
})

const TYPE_OPTIONS = [
  { value: 'act', label: 'Акт' },
  { value: 'contract', label: 'Договор' },
  { value: 'protocol', label: 'Протокол' },
  { value: 'order', label: 'Приказ' },
  { value: 'report', label: 'Отчёт' }
]

function validate() {
  errors.organizationId = form.organizationId ? '' : 'Выберите организацию'
  errors.title = form.title.trim() ? '' : 'Введите заголовок'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      organizationId: form.organizationId,
      equipmentId: form.equipmentId || '',
      title: form.title.trim(),
      type: form.type,
      number: form.number.trim(),
      date: form.date,
      content: form.content
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/registry/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('Документ создан как черновик.')
      router.push(`/dashboard/registry/${created.id}`)
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

async function loadEquipment(orgId) {
  if (!orgId) {
    equipment.value = []
    return
  }
  equipmentLoading.value = true
  try {
    const res = await equipmentApi.list({ page: 1, pageSize: 200, organizationId: orgId })
    equipment.value = res.items
  } finally {
    equipmentLoading.value = false
  }
}

watch(
  () => form.organizationId,
  (orgId) => {
    if (form.equipmentId && !equipment.value.some((e) => e.id === form.equipmentId)) {
      form.equipmentId = ''
    }
    loadEquipment(orgId)
  }
)

onMounted(async () => {
  await loadOrgs()
  if (!isEdit) {
    if (store.organizationId) form.organizationId = store.organizationId
    return
  }
  loading.value = true
  try {
    const d = await store.fetchOne(route.params.id)
    Object.assign(form, {
      organizationId: d.organizationId,
      equipmentId: d.equipmentId ?? '',
      title: d.title,
      type: d.type ?? 'act',
      number: d.number ?? '',
      date: d.date ?? '',
      content: d.content ?? ''
    })
    await loadEquipment(d.organizationId)
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
      {{ isEdit ? 'Редактирование документа' : 'Новый документ' }}
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
      <div class="row">
        <div class="col-md-6">
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
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">Связанное оборудование</label>
            <select
              v-model="form.equipmentId"
              class="form-select"
              :disabled="!form.organizationId || equipmentLoading"
            >
              <option value="">
                — не привязано —
              </option>
              <option
                v-for="e in equipment"
                :key="e.id"
                :value="e.id"
              >
                {{ e.name }} ({{ e.inventoryNumber || '—' }})
              </option>
            </select>
          </div>
        </div>
      </div>

      <FormField
        v-model="form.title"
        label="Заголовок"
        required
        :error="errors.title"
      />

      <div class="row">
        <div class="col-md-4">
          <div class="mb-3">
            <label class="form-label">Тип</label>
            <select
              v-model="form.type"
              class="form-select"
            >
              <option
                v-for="opt in TYPE_OPTIONS"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>
        <div class="col-md-4">
          <FormField
            v-model="form.number"
            label="Номер документа"
          />
        </div>
        <div class="col-md-4">
          <FormField
            v-model="form.date"
            label="Дата"
            type="date"
          />
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label">Текст документа</label>
        <textarea
          v-model="form.content"
          class="form-control"
          rows="10"
          placeholder="Содержание документа. Поддерживается простой текст с переносами строк."
        />
      </div>

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
