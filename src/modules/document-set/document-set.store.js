import { defineStore } from 'pinia'
import { ref } from 'vue'
import { documentSetApi } from './document-set.api.js'

export const useDocumentSetStore = defineStore('document-set', () => {
  const templates = ref([])
  const templatesLoaded = ref(false)
  const templatesLoading = ref(false)

  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const organizationId = ref('')
  const infoSystemId = ref('')
  const templateId = ref('')
  const loading = ref(false)

  async function loadTemplates(force = false) {
    if (templatesLoaded.value && !force) return templates.value
    templatesLoading.value = true
    try {
      const res = await documentSetApi.listTemplates()
      templates.value = res.items
      templatesLoaded.value = true
      return res.items
    } finally {
      templatesLoading.value = false
    }
  }

  function getTemplate(id) {
    return templates.value.find((t) => t.id === id) ?? null
  }

  async function fetchList() {
    loading.value = true
    try {
      const res = await documentSetApi.list({
        page: page.value,
        pageSize: pageSize.value,
        organizationId: organizationId.value,
        infoSystemId: infoSystemId.value,
        templateId: templateId.value
      })
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function create(payload) {
    const res = await documentSetApi.create(payload)
    items.value = [res, ...items.value]
    total.value += 1
    return res
  }

  async function remove(id) {
    await documentSetApi.remove(id)
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
  function setTemplateId(v) {
    templateId.value = v
    page.value = 1
  }
  function setPage(v) {
    page.value = v
  }

  return {
    templates,
    templatesLoaded,
    templatesLoading,
    items,
    total,
    page,
    pageSize,
    organizationId,
    infoSystemId,
    templateId,
    loading,
    loadTemplates,
    getTemplate,
    fetchList,
    create,
    remove,
    setOrganizationId,
    setInfoSystemId,
    setTemplateId,
    setPage
  }
})
