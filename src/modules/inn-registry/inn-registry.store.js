import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { chunkedRequest } from '@/lib/chunked.js'
import { isInnValid } from '@/lib/inn-validate.js'
import { innRegistryApi } from './inn-registry.api.js'

export const useInnRegistryStore = defineStore('inn-registry', () => {
  const saved = ref([])
  const search = ref('')
  const loading = ref(false)

  const entries = ref([])
  const lookupRunning = ref(false)
  const lookupProgress = ref({ done: 0, total: 0 })

  const completedCount = computed(
    () => entries.value.filter((e) => e.status === 'done').length
  )
  const errorCount = computed(
    () => entries.value.filter((e) => e.status === 'error').length
  )

  async function fetchSaved() {
    loading.value = true
    try {
      const res = await innRegistryApi.list({ search: search.value })
      saved.value = res.items
    } finally {
      loading.value = false
    }
  }

  
  async function runLookup(rawInput, opts = {}) {
    if (lookupRunning.value) return
    const { chunkSize = 50, concurrency = 2 } = opts

    const seen = new Set()
    const all = String(rawInput || '')
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => {
        if (!s || seen.has(s)) return false
        seen.add(s)
        return true
      })

    const valid = []
    const invalid = []
    for (const inn of all) {
      if (isInnValid(inn)) valid.push(inn)
      else invalid.push(inn)
    }

    entries.value = [
      ...invalid.map((inn) => ({ inn, status: 'error', error: 'invalid_inn' })),
      ...valid.map((inn) => ({ inn, status: 'pending' }))
    ]

    if (!valid.length) return

    lookupRunning.value = true
    lookupProgress.value = { done: 0, total: valid.length }

    try {
      const { items: results } = await chunkedRequest(
        valid,
        async (chunk) => {
          const res = await innRegistryApi.lookupChunk(chunk)
          for (const item of res.items) {
            const idx = entries.value.findIndex((e) => e.inn === item.inn)
            if (idx >= 0) entries.value[idx] = { ...entries.value[idx], ...item }
          }
          return res.items
        },
        {
          chunkSize,
          concurrency,
          onProgress: (done, total) => {
            lookupProgress.value = { done, total }
          }
        }
      )

      const successful = results.filter((r) => r.status === 'done')
      if (successful.length) {
        await chunkedRequest(
          successful,
          (chunk) => innRegistryApi.bulkUpsert(chunk).then((r) => r.items),
          { chunkSize: 100, concurrency: 1 }
        )
        await fetchSaved()
      }
    } finally {
      lookupRunning.value = false
    }
  }

  function setSearch(v) {
    search.value = v
  }

  async function removeOne(id) {
    await innRegistryApi.remove(id)
    saved.value = saved.value.filter((x) => x.id !== id)
  }

  async function clearAll() {
    await innRegistryApi.clear()
    saved.value = []
  }

  function clearEntries() {
    entries.value = []
    lookupProgress.value = { done: 0, total: 0 }
  }

  return {
    saved,
    entries,
    search,
    loading,
    lookupRunning,
    lookupProgress,
    completedCount,
    errorCount,
    fetchSaved,
    runLookup,
    setSearch,
    removeOne,
    clearAll,
    clearEntries
  }
})
