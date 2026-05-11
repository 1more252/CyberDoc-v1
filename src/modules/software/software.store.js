import { defineStore } from 'pinia'
import { ref } from 'vue'
import { softwareApi } from './software.api.js'

export const useSoftwareStore = defineStore('software', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')
  const organizationId = ref('')
  const infoSystemId = ref('')
  const category = ref('')
  const kindId = ref('')
  const loading = ref(false)
  const detailById = ref(new Map())

  async function fetchList() {
    loading.value = true
    try {
      const res = await softwareApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        organizationId: organizationId.value,
        infoSystemId: infoSystemId.value,
        category: category.value,
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
    const res = await softwareApi.get(id)
    detailById.value.set(id, res)
    return res
  }

  async function create(payload) {
    const res = await softwareApi.create(payload)
    detailById.value.set(res.id, res)
    return res
  }

  async function update(id, payload) {
    const res = await softwareApi.update(id, payload)
    detailById.value.set(id, res)
    return res
  }

  async function remove(id) {
    await softwareApi.remove(id)
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
  function setCategory(v) {
    category.value = v
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
    organizationId,
    infoSystemId,
    category,
    kindId,
    loading,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    setSearch,
    setOrganizationId,
    setInfoSystemId,
    setCategory,
    setKindId,
    setPage
  }
})
