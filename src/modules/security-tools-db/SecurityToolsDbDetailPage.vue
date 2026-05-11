<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useSecurityToolsDbStore } from './security-tools-db.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'

const store = useSecurityToolsDbStore()
const dicts = useDictionariesStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const item = ref(null)
const loading = ref(false)

const isAdmin = computed(() => auth.role === 'admin')
const kindLabel = computed(() => (item.value ? dicts.labelOf('typeSzi', item.value.kindId) : ''))

async function load() {
  loading.value = true
  try {
    item.value = await store.fetchOne(route.params.id)
  } catch (err) {
    toast.error(err?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
}

async function onDelete() {
  if (!item.value) return
  const ok = await confirm.ask({
    title: 'Удалить запись каталога?',
    message: `Удалить «${item.value.name}»? Запрещено, если на запись есть ссылки в моих СЗИ.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(item.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/security-tools-db')
  } catch (err) {
    if (err?.message?.includes('catalog_in_use'))
      toast.error('Нельзя удалить: на запись есть ссылки в моих СЗИ.')
    else toast.error(err?.message || 'Не удалось удалить.')
  }
}

onMounted(async () => {
  dicts.load('typeSzi')
  await load()
})
</script>

<template>
  <section>
    <div
      v-if="loading"
      class="text-center text-secondary py-5"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <template v-else-if="item">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ item.name }}
          </h1>
          <span class="text-secondary small">{{ kindLabel || '—' }}</span>
        </div>
        <div
          v-if="isAdmin"
          class="d-flex gap-2 flex-wrap"
        >
          <RouterLink
            class="btn btn-outline-primary"
            :to="`/dashboard/security-tools-db/${item.id}/edit`"
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

      <div class="cd-card p-4">
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Вендор
          </dt>
          <dd class="col-sm-9">
            {{ item.vendor || '—' }}
          </dd>
          <dt class="col-sm-3">
            Категория СЗИ
          </dt>
          <dd class="col-sm-9">
            {{ kindLabel || '—' }}
          </dd>
          <dt class="col-sm-3">
            Номер сертификата
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ item.certNumber || '—' }}
          </dd>
          <dt class="col-sm-3">
            Класс защиты
          </dt>
          <dd class="col-sm-9">
            {{ item.certClass || '—' }}
          </dd>
          <dt class="col-sm-3">
            Дата выдачи
          </dt>
          <dd class="col-sm-9">
            {{ item.certDate || '—' }}
          </dd>
          <dt class="col-sm-3">
            Срок действия до
          </dt>
          <dd class="col-sm-9">
            {{ item.certExpiry || '—' }}
          </dd>
          <template v-if="item.description">
            <dt class="col-sm-3">
              Описание
            </dt>
            <dd class="col-sm-9 text-prewrap">
              {{ item.description }}
            </dd>
          </template>
          <dt class="col-sm-3">
            Создано
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(item.createdAt) }}
          </dd>
          <dt class="col-sm-3">
            Обновлено
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(item.updatedAt) }}
          </dd>
        </dl>
      </div>
    </template>

    <div
      v-else
      class="cd-card p-4 text-center text-secondary"
    >
      Запись не найдена.
    </div>
  </section>
</template>
