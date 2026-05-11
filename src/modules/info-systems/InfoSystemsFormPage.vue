<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInfoSystemsStore } from './info-systems.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'
import DictionarySelect from '@/modules/dictionaries/DictionarySelect.vue'

const store = useInfoSystemsStore()
const dicts = useDictionariesStore()
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
  name: '',
  typeId: '',
  regimId: '',
  strukId: '',
  inetId: '',
  codId: '',
  classification: '',
  purpose: '',
  address: '',
  operatorName: '',
  operatorInn: '',
  operatorOgrn: '',
  hasPdn: false,
  pdnSubjectsCount: '',
  kiiCategory: '',
  gisLevel: '',
  notes: '',
  status: 'draft'
})

const errors = reactive({
  organizationId: '',
  name: '',
  typeId: ''
})

function validate() {
  errors.organizationId = form.organizationId ? '' : 'Выберите организацию'
  errors.name = form.name.trim() ? '' : 'Введите название ИС'
  errors.typeId = form.typeId ? '' : 'Укажите тип ИС'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = {
      organizationId: form.organizationId,
      name: form.name.trim(),
      typeId: form.typeId,
      regimId: form.regimId,
      strukId: form.strukId,
      inetId: form.inetId,
      codId: form.codId,
      classification: form.classification.trim(),
      purpose: form.purpose.trim(),
      address: form.address.trim(),
      operatorName: form.operatorName.trim(),
      operatorInn: form.operatorInn.trim(),
      operatorOgrn: form.operatorOgrn.trim(),
      hasPdn: !!form.hasPdn,
      pdnSubjectsCount: form.pdnSubjectsCount ? Number(form.pdnSubjectsCount) : 0,
      kiiCategory: form.kiiCategory.trim(),
      gisLevel: form.gisLevel.trim(),
      notes: form.notes.trim(),
      status: form.status
    }
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success('Сохранено.')
      router.push(`/dashboard/info-systems/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success('Информационная система создана.')
      router.push(`/dashboard/info-systems/${created.id}`)
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

watch(
  () => form.organizationId,
  (orgId) => {
    if (isEdit) return
    const org = orgs.value.find((o) => o.id === orgId)
    if (!org) return
    if (!form.operatorName) form.operatorName = org.name
    if (!form.operatorInn) form.operatorInn = org.inn
    if (!form.operatorOgrn) form.operatorOgrn = org.ogrn
    if (!form.address) form.address = org.address ?? ''
  }
)

onMounted(async () => {
  dicts.loadMany(['infoSysType', 'regimIS', 'strukIS', 'inet_answers', 'cod_answers'])
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
      name: x.name,
      typeId: x.typeId,
      regimId: x.regimId ?? '',
      strukId: x.strukId ?? '',
      inetId: x.inetId ?? '',
      codId: x.codId ?? '',
      classification: x.classification ?? '',
      purpose: x.purpose ?? '',
      address: x.address ?? '',
      operatorName: x.operatorName ?? '',
      operatorInn: x.operatorInn ?? '',
      operatorOgrn: x.operatorOgrn ?? '',
      hasPdn: !!x.hasPdn,
      pdnSubjectsCount: x.pdnSubjectsCount ?? '',
      kiiCategory: x.kiiCategory ?? '',
      gisLevel: x.gisLevel ?? '',
      notes: x.notes ?? '',
      status: x.status ?? 'draft'
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
      {{ isEdit ? 'Редактирование ИС' : 'Новая информационная система' }}
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
      <h2 class="h6 text-secondary text-uppercase mb-3">
        Основные сведения
      </h2>

      <div class="mb-3">
        <label class="form-label">Организация-оператор <span class="text-danger">*</span></label>
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

      <FormField
        v-model="form.name"
        label="Название ИС"
        required
        :error="errors.name"
        placeholder="Например: ИС «Бухгалтерия 1С»"
      />

      <FormField
        v-model="form.purpose"
        label="Назначение"
        as="textarea"
        :rows="2"
        hint="Какие задачи решает система."
      />

      <h2 class="h6 text-secondary text-uppercase mt-4 mb-3">
        Классификация
      </h2>

      <div class="row">
        <div class="col-md-6">
          <DictionarySelect
            v-model="form.typeId"
            dict="infoSysType"
            label="Тип ИС"
            required
            :error="errors.typeId"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.classification"
            label="Класс защищённости"
            placeholder="Например: УЗ-3 / К3"
            hint="Заполните вручную или после расчёта в модуле «Классификация»."
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <DictionarySelect
            v-model="form.regimId"
            dict="regimIS"
            label="Режим обработки"
          />
        </div>
        <div class="col-md-6">
          <DictionarySelect
            v-model="form.strukId"
            dict="strukIS"
            label="Структура ИС"
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <DictionarySelect
            v-model="form.inetId"
            dict="inet_answers"
            label="Подключение к интернету"
          />
        </div>
        <div class="col-md-6">
          <DictionarySelect
            v-model="form.codId"
            dict="cod_answers"
            label="Размещение (ЦОД)"
          />
        </div>
      </div>

      <h2 class="h6 text-secondary text-uppercase mt-4 mb-3">
        Персональные данные / КИИ / ГИС
      </h2>

      <div class="form-check mb-3">
        <input
          id="hasPdn"
          v-model="form.hasPdn"
          type="checkbox"
          class="form-check-input"
        >
        <label
          for="hasPdn"
          class="form-check-label"
        >В ИС обрабатываются персональные данные</label>
      </div>

      <div
        v-if="form.hasPdn"
        class="row"
      >
        <div class="col-md-6">
          <FormField
            v-model="form.pdnSubjectsCount"
            label="Количество субъектов ПДн"
            type="number"
            placeholder="Например: 250"
          />
        </div>
      </div>

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.kiiCategory"
            label="Категория КИИ"
            placeholder="1, 2, 3 или пусто"
            hint="Если ИС — объект КИИ."
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.gisLevel"
            label="Класс ГИС"
            placeholder="К1 / К2 / К3"
            hint="Если ИС — государственная."
          />
        </div>
      </div>

      <h2 class="h6 text-secondary text-uppercase mt-4 mb-3">
        Оператор
      </h2>

      <FormField
        v-model="form.operatorName"
        label="Наименование оператора"
        hint="По умолчанию — название организации."
      />

      <div class="row">
        <div class="col-md-6">
          <FormField
            v-model="form.operatorInn"
            label="ИНН оператора"
          />
        </div>
        <div class="col-md-6">
          <FormField
            v-model="form.operatorOgrn"
            label="ОГРН оператора"
          />
        </div>
      </div>

      <FormField
        v-model="form.address"
        label="Адрес размещения ИС"
      />

      <h2 class="h6 text-secondary text-uppercase mt-4 mb-3">
        Прочее
      </h2>

      <div class="mb-3">
        <label class="form-label">Статус</label>
        <select
          v-model="form.status"
          class="form-select"
        >
          <option value="draft">
            Черновик
          </option>
          <option value="active">
            В эксплуатации
          </option>
          <option value="archived">
            Архив
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
