<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useThreatModelsStore } from './threat-models.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'
import {
  INTRUDER_TYPE_LABEL,
  INTRUDER_POTENTIAL_LABEL,
  INTRUDER_CAPABILITIES,
  LEVEL_OPTIONS,
  LEVEL_LABEL,
  LEVEL_BADGE,
  THREAT_CATEGORIES,
  isRelevant
} from './threat-model.labels.js'

const store = useThreatModelsStore()
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
  intruder: {
    type: 'external',
    potential: 'basic',
    capabilities: [],
    motivation: ''
  },
  threats: {},
  conclusion: '',
  status: 'draft'
})

const errors = reactive({
  organizationId: '',
  infoSystemId: '',
  name: ''
})

const threatSearch = ref('')
const collapsedCategories = reactive({})

function toggleCategory(catId) {
  collapsedCategories[catId] = !collapsedCategories[catId]
}

const threatsByCategory = computed(() => {
  const q = threatSearch.value.trim().toLowerCase()
  const groups = THREAT_CATEGORIES.map((c) => ({ ...c, items: [] }))
  const idx = new Map(groups.map((g, i) => [g.id, i]))
  for (const t of store.catalog) {
    const groupIdx = idx.get(t.category)
    if (groupIdx === undefined) continue
    if (q) {
      const hay = `${t.code} ${t.name} ${t.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    groups[groupIdx].items.push(t)
  }
  for (const g of groups) g.items.sort((a, b) => a.code.localeCompare(b.code))
  return groups
})

const selectedThreats = computed(() => {
  const list = []
  for (const t of store.catalog) {
    const sel = form.threats[t.id]
    if (sel) list.push({ ...sel, catalog: t })
  }
  list.sort((a, b) => {
    if (a.isRelevant !== b.isRelevant) return a.isRelevant ? -1 : 1
    return a.catalog.code.localeCompare(b.catalog.code)
  })
  return list
})

const totalSelected = computed(() => Object.keys(form.threats).length)
const totalRelevant = computed(
  () => Object.values(form.threats).filter((t) => t.isRelevant).length
)

function isThreatSelected(catalogId) {
  return Boolean(form.threats[catalogId])
}

function toggleThreat(t) {
  if (form.threats[t.id]) {
    delete form.threats[t.id]
    return
  }
  const probability = t.defaultProbability ?? 'medium'
  const damage = t.defaultDamage ?? 'medium'
  form.threats[t.id] = {
    catalogId: t.id,
    probability,
    damage,
    isRelevant: isRelevant(probability, damage),
    justification: '',
    mitigation: ''
  }
}

function updateThreatField(catalogId, field, value) {
  const t = form.threats[catalogId]
  if (!t) return
  t[field] = value
  if (field === 'probability' || field === 'damage') {
    t.isRelevant = isRelevant(t.probability, t.damage)
  }
}

function selectAllInCategory(catId) {
  for (const t of store.catalog) {
    if (t.category === catId && !form.threats[t.id]) toggleThreat(t)
  }
}
function clearCategory(catId) {
  for (const t of store.catalog) {
    if (t.category === catId && form.threats[t.id]) delete form.threats[t.id]
  }
}

function toggleCapability(id) {
  const arr = form.intruder.capabilities
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(id)
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
    if (isEdit) return
    form.infoSystemId = ''
    await loadInfoSystems(orgId)
  }
)

function validate() {
  errors.organizationId = isEdit || form.organizationId ? '' : 'Выберите организацию'
  errors.infoSystemId = isEdit || form.infoSystemId ? '' : 'Выберите ИС'
  errors.name = form.name.trim() ? '' : 'Введите название модели'
  return !Object.values(errors).some(Boolean)
}

function buildPayload(targetStatus) {
  return {
    infoSystemId: form.infoSystemId,
    name: form.name.trim(),
    status: targetStatus,
    intruder: {
      type: form.intruder.type,
      potential: form.intruder.potential,
      capabilities: [...form.intruder.capabilities],
      motivation: form.intruder.motivation.trim()
    },
    threats: Object.values(form.threats).map((t) => ({
      catalogId: t.catalogId,
      probability: t.probability,
      damage: t.damage,
      isRelevant: t.isRelevant,
      justification: t.justification.trim(),
      mitigation: t.mitigation.trim()
    })),
    conclusion: form.conclusion.trim()
  }
}

async function submit(targetStatus) {
  if (!validate()) return
  submitting.value = true
  try {
    const payload = buildPayload(targetStatus)
    if (isEdit) {
      const updated = await store.update(route.params.id, payload)
      toast.success(targetStatus === 'finalized' ? 'Модель утверждена.' : 'Сохранено.')
      router.push(`/dashboard/threat-models/${updated.id}`)
    } else {
      const created = await store.create(payload)
      toast.success(
        targetStatus === 'finalized' ? 'Модель создана и утверждена.' : 'Модель создана.'
      )
      router.push(`/dashboard/threat-models/${created.id}`)
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось сохранить.')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await Promise.all([store.loadCatalog(), loadOrgs()])

  if (!isEdit) {
    if (store.organizationId) {
      form.organizationId = store.organizationId
      await loadInfoSystems(form.organizationId)
      if (store.infoSystemId) form.infoSystemId = store.infoSystemId
    }
    return
  }

  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id, { force: true })
    form.organizationId = x.organizationId
    form.infoSystemId = x.infoSystemId
    form.name = x.name
    form.intruder = {
      type: x.intruder?.type ?? 'external',
      potential: x.intruder?.potential ?? 'basic',
      capabilities: Array.isArray(x.intruder?.capabilities)
        ? [...x.intruder.capabilities]
        : [],
      motivation: x.intruder?.motivation ?? ''
    }
    const map = {}
    for (const t of x.threats ?? []) {
      map[t.catalogId] = {
        catalogId: t.catalogId,
        probability: t.probability,
        damage: t.damage,
        isRelevant: t.isRelevant,
        justification: t.justification ?? '',
        mitigation: t.mitigation ?? ''
      }
    }
    form.threats = map
    form.conclusion = x.conclusion ?? ''
    form.status = x.status ?? 'draft'
    await loadInfoSystems(form.organizationId)
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить модель угроз.')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        {{ isEdit ? 'Редактирование модели угроз' : 'Новая модель угроз' }}
      </h1>
      <RouterLink
        class="btn btn-outline-secondary"
        to="/dashboard/threat-models"
      >
        <i class="bi bi-arrow-left me-1" /> К списку
      </RouterLink>
    </div>

    <div
      v-if="loading || store.catalogLoading"
      class="cd-card p-4 text-center text-secondary"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <form
      v-else
      class="cd-card p-4"
      novalidate
      @submit.prevent="submit('draft')"
    >
      <h2 class="h6 text-secondary text-uppercase mb-3">
        Основные сведения
      </h2>

      <div class="row">
        <div class="col-md-6">
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
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">Информационная система <span class="text-danger">*</span></label>
            <select
              v-model="form.infoSystemId"
              :class="['form-select', { 'is-invalid': errors.infoSystemId }]"
              :disabled="!form.organizationId || infoSystemsLoading || isEdit"
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
            <div
              v-else-if="isEdit"
              class="form-text"
            >
              Привязка к ИС фиксируется при создании.
            </div>
          </div>
        </div>
      </div>

      <FormField
        v-model="form.name"
        label="Название модели угроз"
        required
        :error="errors.name"
        placeholder="Например: Модель угроз ИСПДн «Бухгалтерия 1С»"
        hint="По умолчанию подставляется в шапку DOCX-документа."
      />

      <h2 class="h6 text-secondary text-uppercase mt-4 mb-3">
        Модель нарушителя
      </h2>

      <div class="row">
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">Тип нарушителя</label>
            <div>
              <div
                v-for="(label, value) in INTRUDER_TYPE_LABEL"
                :key="value"
                class="form-check"
              >
                <input
                  :id="`intr-type-${value}`"
                  v-model="form.intruder.type"
                  type="radio"
                  class="form-check-input"
                  name="intruder-type"
                  :value="value"
                >
                <label
                  :for="`intr-type-${value}`"
                  class="form-check-label"
                >{{ label }}</label>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">Потенциал нарушителя</label>
            <div>
              <div
                v-for="(label, value) in INTRUDER_POTENTIAL_LABEL"
                :key="value"
                class="form-check"
              >
                <input
                  :id="`intr-pot-${value}`"
                  v-model="form.intruder.potential"
                  type="radio"
                  class="form-check-input"
                  name="intruder-potential"
                  :value="value"
                >
                <label
                  :for="`intr-pot-${value}`"
                  class="form-check-label"
                >{{ label }}</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label">Возможности нарушителя</label>
        <div class="row g-2">
          <div
            v-for="cap in INTRUDER_CAPABILITIES"
            :key="cap.id"
            class="col-md-6"
          >
            <div class="form-check">
              <input
                :id="`cap-${cap.id}`"
                type="checkbox"
                class="form-check-input"
                :checked="form.intruder.capabilities.includes(cap.id)"
                @change="toggleCapability(cap.id)"
              >
              <label
                :for="`cap-${cap.id}`"
                class="form-check-label"
              >{{ cap.name }}</label>
            </div>
          </div>
        </div>
        <div class="form-text">
          Отмеченные возможности попадут в DOCX в раздел «Модель нарушителя».
        </div>
      </div>

      <FormField
        v-model="form.intruder.motivation"
        label="Мотивация / цели нарушителя"
        as="textarea"
        :rows="2"
        hint="Например: финансовая выгода, конкуренты, идеологические мотивы."
      />

      <div class="d-flex justify-content-between align-items-end flex-wrap gap-2 mt-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-0">
          Каталог угроз (БДУ ФСТЭК)
        </h2>
        <span class="text-secondary small">
          Выбрано: <strong>{{ totalSelected }}</strong>,
          из них актуальных:
          <strong :class="totalRelevant ? 'text-danger' : 'text-success'">
            {{ totalRelevant }}
          </strong>
        </span>
      </div>

      <div class="mb-3">
        <input
          v-model="threatSearch"
          type="search"
          class="form-control"
          placeholder="Поиск по коду, названию или описанию УБИ…"
        >
      </div>

      <div
        v-for="cat in threatsByCategory"
        :key="cat.id"
        class="mb-3 border rounded"
      >
        <div class="d-flex align-items-center justify-content-between p-2 bg-body-tertiary">
          <button
            type="button"
            class="btn btn-link p-0 text-decoration-none fw-semibold"
            @click="toggleCategory(cat.id)"
          >
            <i :class="['bi', collapsedCategories[cat.id] ? 'bi-caret-right-fill' : 'bi-caret-down-fill', 'me-1']" />
            {{ cat.name }}
            <span class="badge text-bg-light ms-2">{{ cat.items.length }}</span>
          </button>
          <div class="btn-group btn-group-sm">
            <button
              type="button"
              class="btn btn-outline-secondary"
              :disabled="!cat.items.length"
              @click="selectAllInCategory(cat.id)"
            >
              Выбрать все
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary"
              :disabled="!cat.items.length"
              @click="clearCategory(cat.id)"
            >
              Снять
            </button>
          </div>
        </div>
        <div
          v-if="!collapsedCategories[cat.id]"
          class="p-2"
        >
          <div
            v-if="!cat.items.length"
            class="text-secondary small px-2 py-1"
          >
            Нет угроз в этой категории по фильтру.
          </div>
          <div
            v-for="t in cat.items"
            :key="t.id"
            class="form-check py-1 border-bottom border-light"
          >
            <input
              :id="`thr-${t.id}`"
              type="checkbox"
              class="form-check-input"
              :checked="isThreatSelected(t.id)"
              @change="toggleThreat(t)"
            >
            <label
              :for="`thr-${t.id}`"
              class="form-check-label d-block"
            >
              <span class="font-monospace small text-secondary me-2">{{ t.code }}</span>
              <span>{{ t.name }}</span>
              <div
                v-if="t.description"
                class="small text-secondary"
              >
                {{ t.description }}
              </div>
            </label>
          </div>
        </div>
      </div>

      <div
        v-if="totalSelected"
        class="mt-4"
      >
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Оценка выбранных угроз
        </h2>
        <p class="text-secondary small">
          Актуальность вычисляется по матрице <em>вероятность × ущерб</em> в режиме
          предпросмотра. Бэк пересчитывает значение при сохранении (ваше явное
          значение, если задано, сохраняется).
        </p>
        <div
          v-for="t in selectedThreats"
          :key="t.catalogId"
          class="border rounded p-3 mb-2"
        >
          <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
            <div>
              <div class="small text-secondary font-monospace">
                {{ t.catalog.code }}
              </div>
              <div class="fw-semibold">
                {{ t.catalog.name }}
              </div>
            </div>
            <div class="d-flex align-items-center gap-2">
              <span :class="['badge', t.isRelevant ? 'text-bg-danger' : 'text-bg-success']">
                {{ t.isRelevant ? 'Актуальная' : 'Не актуальна' }}
              </span>
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                title="Убрать угрозу из модели"
                @click="toggleThreat(t.catalog)"
              >
                <i class="bi bi-x-lg" />
              </button>
            </div>
          </div>
          <div class="row mt-2">
            <div class="col-md-6">
              <label class="form-label small">Вероятность реализации</label>
              <select
                class="form-select form-select-sm"
                :value="t.probability"
                @change="updateThreatField(t.catalogId, 'probability', $event.target.value)"
              >
                <option
                  v-for="opt in LEVEL_OPTIONS"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
              <span :class="['badge mt-1', LEVEL_BADGE[t.probability]]">
                {{ LEVEL_LABEL[t.probability] }}
              </span>
            </div>
            <div class="col-md-6">
              <label class="form-label small">Ущерб от реализации</label>
              <select
                class="form-select form-select-sm"
                :value="t.damage"
                @change="updateThreatField(t.catalogId, 'damage', $event.target.value)"
              >
                <option
                  v-for="opt in LEVEL_OPTIONS"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
              <span :class="['badge mt-1', LEVEL_BADGE[t.damage]]">
                {{ LEVEL_LABEL[t.damage] }}
              </span>
            </div>
          </div>
          <div class="mt-2">
            <label class="form-label small">Обоснование оценки</label>
            <textarea
              class="form-control form-control-sm"
              rows="2"
              :value="t.justification"
              placeholder="Почему именно такая вероятность и ущерб."
              @input="updateThreatField(t.catalogId, 'justification', $event.target.value)"
            />
          </div>
          <div class="mt-2">
            <label class="form-label small">Меры защиты / нейтрализации</label>
            <textarea
              class="form-control form-control-sm"
              rows="2"
              :value="t.mitigation"
              placeholder="Технические и организационные меры."
              @input="updateThreatField(t.catalogId, 'mitigation', $event.target.value)"
            />
          </div>
        </div>
      </div>

      <h2 class="h6 text-secondary text-uppercase mt-4 mb-3">
        Заключение
      </h2>
      <FormField
        v-model="form.conclusion"
        label="Выводы по модели угроз"
        as="textarea"
        :rows="4"
        hint="Краткое резюме: какие угрозы актуальны и какие меры приняты/планируются."
      />

      <div class="d-flex flex-wrap gap-2 mt-3">
        <button
          type="submit"
          class="btn btn-outline-primary"
          :disabled="submitting"
        >
          <span
            v-if="submitting"
            class="spinner-border spinner-border-sm me-2"
          />
          <i
            v-else
            class="bi bi-save me-1"
          />
          Сохранить черновик
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="submitting"
          @click="submit('finalized')"
        >
          <i class="bi bi-check2-circle me-1" />
          Утвердить модель
        </button>
        <button
          type="button"
          class="btn btn-outline-secondary"
          :disabled="submitting"
          @click="router.back()"
        >
          Отмена
        </button>
      </div>
    </form>
  </section>
</template>
