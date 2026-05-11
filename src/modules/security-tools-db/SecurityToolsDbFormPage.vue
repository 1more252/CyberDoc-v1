<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSecurityToolsDbStore } from './security-tools-db.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'
import DictionarySelect from '@/modules/dictionaries/DictionarySelect.vue'

const store = useSecurityToolsDbStore()
const dicts = useDictionariesStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const isEdit = !!route.params.id
const loading = ref(false)
const submitting = ref(false)

const form = reactive({
  name: '',
  vendor: '',
  kindId: '',
  certNumber: '',
  certClass: '',
  certDate: '',
  certExpiry: '',
  description: ''
})

const errors = reactive({
  name: '',
  kindId: ''
})

function validate() {
  errors.name = form.name.trim() ? '' : 'Введите наименование'
  errors.kindId = form.kindId ? '' : 'Укажите категорию СЗИ'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      name: form.name.trim(),
      vendor: form.vendor.trim(),
      kindId: form.kindId,
      certNumber: form.certNumber.trim(),
      certClass: form.certClass.trim(),
      certDate: form.certDate,
      certExpiry: form.certExpiry,
      description: form.description.trim()
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/security-tools-db/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('Запись создана.')
      router.push(`/dashboard/security-tools-db/${created.id}`)
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось сохранить.')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  dicts.load('typeSzi')
  if (!isEdit) return
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    Object.assign(form, {
      name: x.name,
      vendor: x.vendor ?? '',
      kindId: x.kindId ?? '',
      certNumber: x.certNumber ?? '',
      certClass: x.certClass ?? '',
      certDate: x.certDate ?? '',
      certExpiry: x.certExpiry ?? '',
      description: x.description ?? ''
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
      {{ isEdit ? 'Редактирование записи каталога СЗИ' : 'Новая запись каталога СЗИ' }}
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
      <FormField
        v-model="form.name"
        label="Наименование"
        required
        :error="errors.name"
      />

      <FormField
        v-model="form.vendor"
        label="Вендор / разработчик"
      />

      <DictionarySelect
        v-model="form.kindId"
        dict="typeSzi"
        label="Категория СЗИ"
        required
        :error="errors.kindId"
      />

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.certNumber"
            label="Номер сертификата"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.certClass"
            label="Класс защиты"
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.certDate"
            label="Дата выдачи"
            type="date"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.certExpiry"
            label="Срок действия до"
            type="date"
          />
        </div>
      </div>

      <FormField
        v-model="form.description"
        label="Описание"
        as="textarea"
        :rows="3"
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
