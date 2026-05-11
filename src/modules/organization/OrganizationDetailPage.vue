<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useOrganizationStore } from './organization.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'

const store = useOrganizationStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const org = ref(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    org.value = await store.fetchOne(route.params.id)
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
}

async function onDelete() {
  if (!org.value) return
  const ok = await confirm.ask({
    title: 'Удалить организацию?',
    message: `Удалить «${org.value.name}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(org.value.id)
    toast.success('Организация удалена.')
    router.push('/dashboard/organizations')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
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

    <template v-else-if="org">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ org.name }}
          </h1>
          <span class="badge text-bg-secondary">
            {{ org.kind === 'ip' ? 'ИП' : 'Юр. лицо' }}
          </span>
        </div>
        <div class="d-flex gap-2">
          <RouterLink
            :class="['btn btn-outline-primary']"
            :to="`/dashboard/organizations/${org.id}/edit`"
          >
            <i class="bi bi-pencil me-1" /> Редактировать
          </RouterLink>
          <button
            type="button"
            :class="['btn btn-outline-danger']"
            @click="onDelete"
          >
            <i class="bi bi-trash me-1" /> Удалить
          </button>
        </div>
      </div>

      <div :class="['cd-card p-4']">
        <dl class="row mb-0">
          <dt class="col-sm-3">
            ИНН
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ org.inn }}
          </dd>
          <dt class="col-sm-3">
            {{ org.kind === 'ip' ? 'ОГРНИП' : 'ОГРН' }}
          </dt>
          <dd class="col-sm-9 font-monospace">
            {{ org.ogrn }}
          </dd>
          <template v-if="org.kpp">
            <dt class="col-sm-3">
              КПП
            </dt>
            <dd class="col-sm-9 font-monospace">
              {{ org.kpp }}
            </dd>
          </template>
          <dt class="col-sm-3">
            Адрес
          </dt>
          <dd class="col-sm-9">
            {{ org.address }}
          </dd>
          <template v-if="org.phone">
            <dt class="col-sm-3">
              Телефон
            </dt>
            <dd class="col-sm-9">
              {{ org.phone }}
            </dd>
          </template>
          <template v-if="org.email">
            <dt class="col-sm-3">
              E-mail
            </dt>
            <dd class="col-sm-9">
              {{ org.email }}
            </dd>
          </template>
          <template v-if="org.notes">
            <dt class="col-sm-3">
              Заметки
            </dt>
            <dd class="col-sm-9 text-prewrap">
              {{ org.notes }}
            </dd>
          </template>
          <dt class="col-sm-3">
            Создана
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(org.createdAt) }}
          </dd>
        </dl>
      </div>
    </template>

    <div
      v-else
      :class="['cd-card p-4 text-center text-secondary']"
    >
      Организация не найдена.
    </div>
  </section>
</template>
