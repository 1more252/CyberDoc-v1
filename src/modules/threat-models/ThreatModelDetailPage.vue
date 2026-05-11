<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useThreatModelsStore } from './threat-models.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { runDocxTask } from '@/lib/docx-runner.js'
import { saveAs } from 'file-saver'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import {
  INTRUDER_TYPE_LABEL,
  INTRUDER_POTENTIAL_LABEL,
  INTRUDER_CAPABILITIES,
  LEVEL_LABEL,
  LEVEL_BADGE,
  THREAT_CATEGORY_LABEL
} from './threat-model.labels.js'

const store = useThreatModelsStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const model = ref(null)
const loading = ref(false)
const exporting = ref(false)

const CAPABILITY_LABEL = Object.fromEntries(INTRUDER_CAPABILITIES.map((c) => [c.id, c.name]))

const STATUS_LABEL = { draft: 'Черновик', finalized: 'Утверждена' }
const STATUS_BADGE = { draft: 'text-bg-secondary', finalized: 'text-bg-success' }

const threatGroups = computed(() => {
  if (!model.value?.threats?.length) return []
  const groups = new Map()
  for (const t of model.value.threats) {
    const catId = t.catalog?.category ?? 'access'
    if (!groups.has(catId))
      groups.set(catId, { id: catId, name: THREAT_CATEGORY_LABEL[catId] ?? catId, items: [] })
    groups.get(catId).items.push(t)
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => (a.catalog?.code ?? '').localeCompare(b.catalog?.code ?? ''))
    g.relevantCount = g.items.filter((x) => x.isRelevant).length
  }
  return [...groups.values()].sort((a, b) => b.relevantCount - a.relevantCount)
})

const totalRelevant = computed(
  () => (model.value?.threats ?? []).filter((t) => t.isRelevant).length
)

async function load() {
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id, { force: true })
    model.value = x
    if (!x.infoSystem && x.infoSystemId) {
      x.infoSystem = await infoSystemsApi.get(x.infoSystemId).catch(() => null)
    }
    if (!x.organization && x.organizationId) {
      x.organization = await organizationApi.get(x.organizationId).catch(() => null)
    }
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить модель угроз.')
  } finally {
    loading.value = false
  }
}

async function onDelete() {
  if (!model.value) return
  const ok = await confirm.ask({
    title: 'Удалить модель угроз?',
    message: `Удалить «${model.value.name}»? Это действие необратимо.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(model.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/threat-models')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

function buildFilename() {
  const today = new Date().toISOString().slice(0, 10)
  const slug = (s) =>
    String(s ?? '')
      .replace(/[\\/:*?"<>|«»]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'без_названия'
  const parts = ['МодельУгроз', slug(model.value?.infoSystem?.name), today]
  return `${parts.filter(Boolean).join('_')}.docx`
}

async function exportDocx() {
  if (!model.value || exporting.value) return
  exporting.value = true
  try {
    const blob = await runDocxTask('threat-model', {
      model: model.value,
      organization: model.value.organization,
      infoSystem: model.value.infoSystem
    })
    saveAs(blob, buildFilename())
    toast.success('DOCX сгенерирован.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось сгенерировать DOCX.')
  } finally {
    exporting.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div
      v-if="loading"
      class="text-center text-secondary py-5"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <template v-else-if="model">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ model.name }}
          </h1>
          <span :class="['badge me-2', STATUS_BADGE[model.status] ?? 'text-bg-light']">
            {{ STATUS_LABEL[model.status] ?? model.status }}
          </span>
          <span class="text-secondary small">
            Угроз: {{ model.threats?.length ?? 0 }} ·
            актуальных:
            <strong :class="totalRelevant ? 'text-danger' : 'text-success'">
              {{ totalRelevant }}
            </strong>
          </span>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="exporting"
            @click="exportDocx"
          >
            <span
              v-if="exporting"
              class="spinner-border spinner-border-sm me-2"
            />
            <i
              v-else
              class="bi bi-file-earmark-word me-1"
            />
            Экспорт в DOCX
          </button>
          <RouterLink
            class="btn btn-outline-primary"
            :to="`/dashboard/threat-models/${model.id}/edit`"
          >
            <i class="bi bi-pencil me-1" /> Редактировать
          </RouterLink>
          <button
            type="button"
            class="btn btn-outline-danger"
            @click="onDelete"
          >
            <i class="bi bi-trash me-1" /> Удалить
          </button>
        </div>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Объект защиты
        </h2>
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Организация
          </dt>
          <dd class="col-sm-9">
            <RouterLink
              v-if="model.organization"
              :to="`/dashboard/organizations/${model.organization.id}`"
            >
              {{ model.organization.name }}
            </RouterLink>
            <span
              v-else
              class="text-secondary"
            >—</span>
          </dd>
          <dt class="col-sm-3">
            Информационная система
          </dt>
          <dd class="col-sm-9">
            <RouterLink
              v-if="model.infoSystem"
              :to="`/dashboard/info-systems/${model.infoSystem.id}`"
            >
              {{ model.infoSystem.name }}
            </RouterLink>
            <span
              v-else
              class="text-secondary"
            >—</span>
          </dd>
          <dt
            v-if="model.infoSystem?.classification"
            class="col-sm-3"
          >
            Класс защищённости
          </dt>
          <dd
            v-if="model.infoSystem?.classification"
            class="col-sm-9 font-monospace"
          >
            {{ model.infoSystem.classification }}
          </dd>
        </dl>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Модель нарушителя
        </h2>
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Тип
          </dt>
          <dd class="col-sm-9">
            {{ INTRUDER_TYPE_LABEL[model.intruder?.type] ?? '—' }}
          </dd>
          <dt class="col-sm-3">
            Потенциал
          </dt>
          <dd class="col-sm-9">
            {{ INTRUDER_POTENTIAL_LABEL[model.intruder?.potential] ?? '—' }}
          </dd>
          <dt class="col-sm-3">
            Возможности
          </dt>
          <dd class="col-sm-9">
            <template v-if="model.intruder?.capabilities?.length">
              <span
                v-for="cap in model.intruder.capabilities"
                :key="cap"
                class="badge text-bg-light me-1 mb-1"
              >
                {{ CAPABILITY_LABEL[cap] ?? cap }}
              </span>
            </template>
            <span
              v-else
              class="text-secondary"
            >Не указаны</span>
          </dd>
          <dt class="col-sm-3">
            Мотивация
          </dt>
          <dd class="col-sm-9 text-prewrap">
            {{ model.intruder?.motivation || '—' }}
          </dd>
        </dl>
      </div>

      <div class="cd-card p-4 mb-3">
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Угрозы по категориям
        </h2>

        <div
          v-if="!threatGroups.length"
          class="text-secondary small"
        >
          В модели не выбрано ни одной угрозы.
        </div>

        <div
          v-for="g in threatGroups"
          :key="g.id"
          class="mb-3"
        >
          <div class="d-flex align-items-center gap-2 mb-2">
            <h3 class="h6 mb-0">
              {{ g.name }}
            </h3>
            <span class="badge text-bg-light">
              {{ g.items.length }}
            </span>
            <span
              v-if="g.relevantCount"
              class="badge text-bg-danger"
            >
              Актуальных: {{ g.relevantCount }}
            </span>
          </div>
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th style="width: 6rem">
                    Код
                  </th>
                  <th>Угроза</th>
                  <th class="text-center">
                    Вероятность
                  </th>
                  <th class="text-center">
                    Ущерб
                  </th>
                  <th class="text-center">
                    Актуальность
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="t in g.items"
                  :key="t.catalogId"
                >
                  <td class="font-monospace small">
                    {{ t.catalog?.code ?? '—' }}
                  </td>
                  <td>
                    <div class="fw-semibold small">
                      {{ t.catalog?.name ?? t.catalogId }}
                    </div>
                    <div
                      v-if="t.justification"
                      class="small text-secondary mt-1"
                    >
                      <i class="bi bi-chat-left-text me-1" />
                      {{ t.justification }}
                    </div>
                    <div
                      v-if="t.mitigation"
                      class="small text-secondary mt-1"
                    >
                      <i class="bi bi-shield-check me-1" />
                      {{ t.mitigation }}
                    </div>
                  </td>
                  <td class="text-center">
                    <span :class="['badge', LEVEL_BADGE[t.probability]]">
                      {{ LEVEL_LABEL[t.probability] }}
                    </span>
                  </td>
                  <td class="text-center">
                    <span :class="['badge', LEVEL_BADGE[t.damage]]">
                      {{ LEVEL_LABEL[t.damage] }}
                    </span>
                  </td>
                  <td class="text-center">
                    <span :class="['badge', t.isRelevant ? 'text-bg-danger' : 'text-bg-success']">
                      {{ t.isRelevant ? 'Актуальна' : 'Не актуальна' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        v-if="model.conclusion"
        class="cd-card p-4 mb-3"
      >
        <h2 class="h6 text-secondary text-uppercase mb-3">
          Заключение
        </h2>
        <p class="mb-0 text-prewrap">
          {{ model.conclusion }}
        </p>
      </div>

      <div class="cd-card p-4 text-secondary small">
        Создано: {{ formatDate(model.createdAt) }} ·
        Обновлено: {{ formatDate(model.updatedAt) }}
      </div>
    </template>

    <div
      v-else
      class="cd-card p-4 text-center text-secondary"
    >
      Модель угроз не найдена.
    </div>
  </section>
</template>
