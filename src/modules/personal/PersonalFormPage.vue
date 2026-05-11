<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePersonalStore } from './personal.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'

const store = usePersonalStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const isEdit = !!route.params.id
const loading = ref(false)
const submitting = ref(false)

const orgs = ref([])
const orgsLoading = ref(false)

const form = reactive({
  organizationId: '',
  lastName: '',
  firstName: '',
  middleName: '',
  position: '',
  department: '',
  phone: '',
  email: '',
  hasAdminRights: false,
  notes: ''
})

const errors = reactive({
  organizationId: '',
  lastName: '',
  firstName: ''
})

function validate() {
  errors.organizationId = form.organizationId ? '' : 'Выберите организацию'
  errors.lastName = form.lastName.trim() ? '' : 'Введите фамилию'
  errors.firstName = form.firstName.trim() ? '' : 'Введите имя'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      organizationId: form.organizationId,
      lastName: form.lastName.trim(),
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim(),
      position: form.position.trim(),
      department: form.department.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      hasAdminRights: !!form.hasAdminRights,
      notes: form.notes.trim()
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/personal/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('Сотрудник добавлен.')
      router.push(`/dashboard/personal/${created.id}`)
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

onMounted(async () => {
  await loadOrgs()
  if (!isEdit) {
    if (store.organizationId) form.organizationId = store.organizationId
    return
  }
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    Object.assign(form, {
      organizationId: x.organizationId,
      lastName: x.lastName,
      firstName: x.firstName,
      middleName: x.middleName ?? '',
      position: x.position ?? '',
      department: x.department ?? '',
      phone: x.phone ?? '',
      email: x.email ?? '',
      hasAdminRights: !!x.hasAdminRights,
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
      {{ isEdit ? 'Редактирование сотрудника' : 'Новый сотрудник' }}
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

      <div class="row">
        <div class="col-md-4">
          <FormField
            v-model="form.lastName"
            label="Фамилия"
            required
            :error="errors.lastName"
          />
        </div>
        <div class="col-md-4">
          <FormField
            v-model="form.firstName"
            label="Имя"
            required
            :error="errors.firstName"
          />
        </div>
        <div class="col-md-4">
          <FormField
            v-model="form.middleName"
            label="Отчество"
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.position"
            label="Должность"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.department"
            label="Подразделение"
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.phone"
            label="Телефон"
            type="tel"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.email"
            label="Email"
            type="email"
          />
        </div>
      </div>

      <div class="form-check mb-3">
        <input
          id="hasAdminRights"
          v-model="form.hasAdminRights"
          type="checkbox"
          class="form-check-input"
        >
        <label
          for="hasAdminRights"
          class="form-check-label"
        >
          Имеет административные права в ИС
        </label>
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
