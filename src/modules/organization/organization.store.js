import { defineStore } from 'pinia'
import { ref } from 'vue'
import { organizationApi } from './organization.api.js'

export const useOrganizationStore = defineStore('organization', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')
  const loading = ref(false)
  const detailById = ref(new Map())

  async function fetchList() {
    loading.value = true
    try {
      const res = await organizationApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value
      })
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id) {
    if (detailById.value.has(id)) return detailById.value.get(id)
    const res = await organizationApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await organizationApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await organizationApi.update(id, payload)
    detailById.value.set(id, res)
    return res
  }

  async function remove(id) {
    await organizationApi.remove(id)
    detailById.value.delete(id)
    items.value = items.value.filter((o) => o.id !== id)
  }

  function setSearch(value) {
    search.value = value
    page.value = 1
  }

  function setPage(value) {
    page.value = value
  }

  return {
    items,
    total,
    page,
    pageSize,
    search,
    loading,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    setSearch,
    setPage
  }
})
