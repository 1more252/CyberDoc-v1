import { defineStore } from 'pinia'
import { ref } from 'vue'
import { infoSystemsApi } from './info-systems.api.js'

export const useInfoSystemsStore = defineStore('info-systems', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')
  const organizationId = ref('')
  const typeId = ref('')
  const status = ref('')
  const loading = ref(false)
  const detailById = ref(new Map())

  async function fetchList() {
    loading.value = true
    try {
      const res = await infoSystemsApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        organizationId: organizationId.value,
        typeId: typeId.value,
        status: status.value
      })
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id) {
    if (detailById.value.has(id)) return detailById.value.get(id)
    const res = await infoSystemsApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await infoSystemsApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await infoSystemsApi.update(id, payload)
    detailById.value.set(id, res)
    return res
  }

  async function remove(id) {
    await infoSystemsApi.remove(id)
    detailById.value.delete(id)
    items.value = items.value.filter((x) => x.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  function setSearch(v) {
    search.value = v
    page.value = 1
  }
  function setOrganizationId(v) {
    organizationId.value = v
    page.value = 1
  }
  function setTypeId(v) {
    typeId.value = v
    page.value = 1
  }
  function setStatus(v) {
    status.value = v
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
    typeId,
    status,
    loading,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    setSearch,
    setOrganizationId,
    setTypeId,
    setStatus,
    setPage
  }
})
