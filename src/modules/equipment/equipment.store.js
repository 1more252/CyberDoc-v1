import { defineStore } from 'pinia'
import { ref } from 'vue'
import { equipmentApi } from './equipment.api.js'

export const useEquipmentStore = defineStore('equipment', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')
  const organizationId = ref('')
  const infoSystemId = ref('')
  const status = ref('')
  const loading = ref(false)
  const detailById = ref(new Map())

  async function fetchList() {
    loading.value = true
    try {
      const res = await equipmentApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        organizationId: organizationId.value,
        infoSystemId: infoSystemId.value,
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
    const res = await equipmentApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await equipmentApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await equipmentApi.update(id, payload)
    detailById.value.set(id, res)
    return res
  }

  async function remove(id) {
    await equipmentApi.remove(id)
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
    infoSystemId.value = ''
    page.value = 1
  }

  function setInfoSystemId(v) {
    infoSystemId.value = v
    page.value = 1
  }

  function setStatus(v) {
    status.value = v
    page.value = 1
  }

  function setPage(v) {
    page.value = v
  }

  
  async function fetchAllForExport(onProgress) {
    const out = []
    const CHUNK = 200
    let p = 1
    while (true) {
      const res = await equipmentApi.list({
        page: p,
        pageSize: CHUNK,
        search: search.value,
        organizationId: organizationId.value,
        infoSystemId: infoSystemId.value,
        status: status.value
      })
      out.push(...res.items)
      onProgress?.(out.length, res.total)
      if (res.items.length < CHUNK || out.length >= res.total) break
      p += 1
    }
    return out
  }

  return {
    items,
    total,
    page,
    pageSize,
    search,
    organizationId,
    infoSystemId,
    status,
    loading,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    setSearch,
    setOrganizationId,
    setInfoSystemId,
    setStatus,
    setPage,
    fetchAllForExport
  }
})
