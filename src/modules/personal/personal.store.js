import { defineStore } from 'pinia'
import { ref } from 'vue'
import { chunkedRequest } from '@/lib/chunked.js'
import { personalApi } from './personal.api.js'

export const usePersonalStore = defineStore('personal', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')
  const organizationId = ref('')
  const loading = ref(false)
  const detailById = ref(new Map())

  const importing = ref(false)
  const importProgress = ref({ done: 0, total: 0 })
  const importErrors = ref([])

  async function fetchList() {
    loading.value = true
    try {
      const res = await personalApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        organizationId: organizationId.value
      })
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id) {
    if (detailById.value.has(id)) return detailById.value.get(id)
    const res = await personalApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await personalApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await personalApi.update(id, payload)
    detailById.value.set(id, res)
    return res
  }

  async function remove(id) {
    await personalApi.remove(id)
    detailById.value.delete(id)
    items.value = items.value.filter((x) => x.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  
  async function bulkImport(orgId, parsed) {
    if (!orgId) throw new Error('Не выбрана организация')
    if (!Array.isArray(parsed) || !parsed.length)
      return { saved: [], errors: [] }

    importing.value = true
    importErrors.value = []
    importProgress.value = { done: 0, total: parsed.length }

    try {
      const { items: saved } = await chunkedRequest(
        parsed,
        async (chunk) => {
          const res = await personalApi.bulkUpsert(orgId, chunk)
          if (Array.isArray(res?.errors) && res.errors.length) {
            importErrors.value = [...importErrors.value, ...res.errors]
          }
          return res.items
        },
        {
          chunkSize: 100,
          concurrency: 2,
          onProgress: (done, total) => {
            importProgress.value = { done, total }
          }
        }
      )
      return { saved, errors: importErrors.value }
    } finally {
      importing.value = false
    }
  }

  function setSearch(v) {
    search.value = v
    page.value = 1
  }
  function setOrganizationId(v) {
    organizationId.value = v
    page.value = 1
  }
  function setPage(v) {
    page.value = v
  }

  return {
    items,
    total,
    page,
    pageSize,
    search,
    organizationId,
    loading,
    importing,
    importProgress,
    importErrors,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    bulkImport,
    setSearch,
    setOrganizationId,
    setPage
  }
})
