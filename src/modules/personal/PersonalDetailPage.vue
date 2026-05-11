<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { usePersonalStore } from './personal.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'

const store = usePersonalStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const person = ref(null)
const org = ref(null)
const loading = ref(false)

const fullName = computed(() => {
  if (!person.value) return ''
  return [person.value.lastName, person.value.firstName, person.value.middleName]
    .filter(Boolean)
    .join(' ')
})

async function load() {
  loading.value = true
  try {
    const x = await store.fetchOne(route.params.id)
    person.value = x
    if (x?.organizationId) {
      org.value = await organizationApi.get(x.organizationId).catch(() => null)
    }
  } catch (err) {
    toast.error(err?.message || 'Не удалось загрузить.')
  } finally {
    loading.value = false
  }
}

async function onDelete() {
  if (!person.value) return
  const ok = await confirm.ask({
    title: 'Удалить сотрудника?',
    message: `Удалить «${fullName.value}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(person.value.id)
    toast.success('Удалено.')
    router.push('/dashboard/personal')
  } catch (err) {
    toast.error(err?.message || 'Не удалось удалить.')
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

    <template v-else-if="person">
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h1 class="h3 mb-1">
            {{ fullName }}
          </h1>
          <span
            v-if="person.position"
            class="text-secondary"
          >{{ person.position }}</span>
          <span
            v-if="person.hasAdminRights"
            class="badge text-bg-warning ms-2"
          >Админ. права</span>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <RouterLink
            class="btn btn-outline-primary"
            :to="`/dashboard/personal/${person.id}/edit`"
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
        <dl class="row mb-0">
          <dt class="col-sm-3">
            Организация
          </dt>
          <dd class="col-sm-9">
            <RouterLink
              v-if="org"
              :to="`/dashboard/organizations/${org.id}`"
            >
              {{ org.name }}
            </RouterLink>
            <span
              v-else
              class="text-secondary"
            >—</span>
          </dd>
          <dt class="col-sm-3">
            Подразделение
          </dt>
          <dd class="col-sm-9">
            {{ person.department || '—' }}
          </dd>
          <dt class="col-sm-3">
            Должность
          </dt>
          <dd class="col-sm-9">
            {{ person.position || '—' }}
          </dd>
          <dt class="col-sm-3">
            Телефон
          </dt>
          <dd class="col-sm-9">
            {{ person.phone || '—' }}
          </dd>
          <dt class="col-sm-3">
            Email
          </dt>
          <dd class="col-sm-9">
            {{ person.email || '—' }}
          </dd>
          <dt class="col-sm-3">
            Админ. права
          </dt>
          <dd class="col-sm-9">
            <span :class="['badge', person.hasAdminRights ? 'text-bg-warning' : 'text-bg-light']">
              {{ person.hasAdminRights ? 'Есть' : 'Нет' }}
            </span>
          </dd>
          <template v-if="person.notes">
            <dt class="col-sm-3">
              Примечания
            </dt>
            <dd class="col-sm-9 text-prewrap">
              {{ person.notes }}
            </dd>
          </template>
          <dt class="col-sm-3">
            Создано
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(person.createdAt) }}
          </dd>
          <dt class="col-sm-3">
            Обновлено
          </dt>
          <dd class="col-sm-9 text-secondary small">
            {{ formatDate(person.updatedAt) }}
          </dd>
        </dl>
      </div>
    </template>

    <div
      v-else
      class="cd-card p-4 text-center text-secondary"
    >
      Сотрудник не найден.
    </div>
  </section>
</template>
