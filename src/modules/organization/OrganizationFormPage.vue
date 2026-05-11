<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useOrganizationStore } from './organization.store.js'
import { useToast } from '@/ui/useToast.js'
import { isInnValid } from '@/lib/inn-validate.js'
import { isOgrnValid } from '@/lib/ogrn-validate.js'
import FormField from '@/ui/FormField.vue'

const store = useOrganizationStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const isEdit = !!route.params.id
const loading = ref(false)
const submitting = ref(false)

const form = reactive({
  kind: 'ul',
  name: '',
  inn: '',
  ogrn: '',
  kpp: '',
  address: '',
  phone: '',
  email: '',
  notes: ''
})

const errors = reactive({
  name: '',
  inn: '',
  ogrn: '',
  kpp: '',
  address: '',
  email: ''
})

function validate() {
  errors.name = form.name.trim() ? '' : 'Введите название'
  errors.inn = isInnValid(form.inn) ? '' : 'Некорректный ИНН'
  errors.ogrn = isOgrnValid(form.ogrn) ? '' : 'Некорректный ОГРН/ОГРНИП'
  errors.kpp =
    form.kind === 'ip' || !form.kpp || /^\d{9}$/.test(form.kpp) ? '' : 'КПП — 9 цифр'
  errors.address = form.address.trim() ? '' : 'Введите адрес'
  errors.email = !form.email || /\S+@\S+\.\S+/.test(form.email) ? '' : 'Некорректный e-mail'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      kind: form.kind,
      name: form.name.trim(),
      inn: form.inn.trim(),
      ogrn: form.ogrn.trim(),
      kpp: form.kind === 'ip' ? '' : form.kpp.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      notes: form.notes.trim()
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/organizations/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('Организация создана.')
      router.push(`/dashboard/organizations/${created.id}`)
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось сохранить.')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  if (!isEdit) return
  loading.value = true
  try {
    const o = await store.fetchOne(route.params.id)
    Object.assign(form, {
      kind: o.kind,
      name: o.name,
      inn: o.inn,
      ogrn: o.ogrn,
      kpp: o.kpp ?? '',
      address: o.address,
      phone: o.phone ?? '',
      email: o.email ?? '',
      notes: o.notes ?? ''
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
      {{ isEdit ? 'Редактирование организации' : 'Новая организация' }}
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
        <label class="form-label d-block">Тип</label>
        <div class="btn-group">
          <input
            id="kindUl"
            v-model="form.kind"
            type="radio"
            class="btn-check"
            value="ul"
          >
          <label
            for="kindUl"
            class="btn btn-outline-primary"
          >Юр. лицо</label>
          <input
            id="kindIp"
            v-model="form.kind"
            type="radio"
            class="btn-check"
            value="ip"
          >
          <label
            for="kindIp"
            class="btn btn-outline-primary"
          >ИП</label>
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
          <FormField
            v-model="form.inn"
            label="ИНН"
            required
            :error="errors.inn"
            :hint="form.kind === 'ip' ? '12 цифр' : '10 цифр'"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.ogrn"
            :label="form.kind === 'ip' ? 'ОГРНИП' : 'ОГРН'"
            required
            :error="errors.ogrn"
            :hint="form.kind === 'ip' ? '15 цифр' : '13 цифр'"
          />
        </div>
      </div>

      <FormField
        v-if="form.kind !== 'ip'"
        v-model="form.kpp"
        label="КПП"
        :error="errors.kpp"
        hint="9 цифр (для ИП не заполняется)"
      />

      <FormField
        v-model="form.address"
        label="Адрес"
        required
        :error="errors.address"
      />

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
            label="E-mail"
            type="email"
            :error="errors.email"
          />
        </div>
      </div>

      <FormField
        v-model="form.notes"
        label="Заметки"
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
