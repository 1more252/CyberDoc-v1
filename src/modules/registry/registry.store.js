import { defineStore } from 'pinia'
import { ref } from 'vue'
import { registryApi } from './registry.api.js'

export const useRegistryStore = defineStore('registry', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')
  const organizationId = ref('')
  const status = ref('')
  const mine = ref(false)
  const loading = ref(false)
  const detailById = ref(new Map())

  async function fetchList() {
    loading.value = true
    try {
      const res = await registryApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        organizationId: organizationId.value,
        status: status.value,
        mine: mine.value ? '1' : ''
      })
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id) {
    if (detailById.value.has(id)) return detailById.value.get(id)
    const res = await registryApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await registryApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await registryApi.update(id, payload)
    detailById.value.set(id, res)
    syncListItem(res)
    return res
  }

  async function remove(id) {
    await registryApi.remove(id)
    detailById.value.delete(id)
    items.value = items.value.filter((x) => x.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  async function submit(id) {
    const res = await registryApi.submit(id)
    detailById.value.set(id, res)
    syncListItem(res)
    return res
  }

  async function approve(id, comment = '') {
    const res = await registryApi.approve(id, comment)
    detailById.value.set(id, res)
    syncListItem(res)
    return res
  }

  async function reject(id, comment) {
    const res = await registryApi.reject(id, comment)
    detailById.value.set(id, res)
    syncListItem(res)
    return res
  }

  function syncListItem(res) {
    const i = items.value.findIndex((x) => x.id === res.id)
    if (i >= 0) items.value.splice(i, 1, res)
  }

  function setSearch(v) {
    search.value = v
    page.value = 1
  }
  function setOrganizationId(v) {
    organizationId.value = v
    page.value = 1
  }
  function setStatus(v) {
    status.value = v
    page.value = 1
  }
  function setMine(v) {
    mine.value = !!v
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
      const res = await registryApi.list({
        page: p,
        pageSize: CHUNK,
        search: search.value,
        organizationId: organizationId.value,
        status: status.value,
        mine: mine.value ? '1' : ''
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
    status,
    mine,
    loading,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    submit,
    approve,
    reject,
    setSearch,
    setOrganizationId,
    setStatus,
    setMine,
    setPage,
    fetchAllForExport
  }
})
