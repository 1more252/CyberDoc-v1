import { defineStore } from 'pinia'
import { ref } from 'vue'
import { threatModelsApi, threatsCatalogApi } from './threat-models.api.js'

export const useThreatModelsStore = defineStore('threat-models', () => {
  const catalog = ref([])
  const catalogLoaded = ref(false)
  const catalogLoading = ref(false)

  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const organizationId = ref('')
  const infoSystemId = ref('')
  const status = ref('')
  const loading = ref(false)
  const detailById = ref(new Map())

  async function loadCatalog(force = false) {
    if (catalogLoaded.value && !force) return catalog.value
    catalogLoading.value = true
    try {
      const res = await threatsCatalogApi.list()
      catalog.value = res.items
      catalogLoaded.value = true
      return res.items
    } finally {
      catalogLoading.value = false
    }
  }

  function catalogById(id) {
    return catalog.value.find((c) => c.id === id) ?? null
  }

  async function fetchList() {
    loading.value = true
    try {
      const res = await threatModelsApi.list({
        page: page.value,
        pageSize: pageSize.value,
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

  async function fetchOne(id, { force = false } = {}) {
    if (!force && detailById.value.has(id)) return detailById.value.get(id)
    const res = await threatModelsApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await threatModelsApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await threatModelsApi.update(id, payload)
    detailById.value.set(id, res)
    return res
  }

  async function remove(id) {
    await threatModelsApi.remove(id)
    detailById.value.delete(id)
    items.value = items.value.filter((x) => x.id !== id)
    total.value = Math.max(0, total.value - 1)
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

  return {
    catalog,
    catalogLoaded,
    catalogLoading,
    items,
    total,
    page,
    pageSize,
    organizationId,
    infoSystemId,
    status,
    loading,
    loadCatalog,
    catalogById,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    setOrganizationId,
    setInfoSystemId,
    setStatus,
    setPage
  }
})
