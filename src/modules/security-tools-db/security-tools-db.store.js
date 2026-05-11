import { defineStore } from 'pinia'
import { ref } from 'vue'
import { securityToolsDbApi } from './security-tools-db.api.js'

export const useSecurityToolsDbStore = defineStore('security-tools-db', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(50)
  const search = ref('')
  const kindId = ref('')
  const loading = ref(false)
  const detailById = ref(new Map())

  async function fetchList() {
    loading.value = true
    try {
      const res = await securityToolsDbApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        kindId: kindId.value
      })
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id) {
    if (detailById.value.has(id)) return detailById.value.get(id)
    const res = await securityToolsDbApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await securityToolsDbApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await securityToolsDbApi.update(id, payload)
    detailById.value.set(id, res)
    return res
  }

  async function remove(id) {
    await securityToolsDbApi.remove(id)
    detailById.value.delete(id)
    items.value = items.value.filter((x) => x.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  function setSearch(v) {
    search.value = v
    page.value = 1
  }
  function setKindId(v) {
    kindId.value = v
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
    kindId,
    loading,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    setSearch,
    setKindId,
    setPage
  }
})
