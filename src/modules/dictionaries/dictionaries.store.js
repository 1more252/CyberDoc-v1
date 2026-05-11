import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { dictionariesApi } from './dictionaries.api.js'

const STORAGE_PREFIX = 'cyberdoc:dict:'
const TTL_MS = 24 * 60 * 60 * 1000

export const DICTIONARY_NAMES = [
  'infoSysType',
  'answers',
  'inet_answers',
  'cod_answers',
  'regimIS',
  'strukIS',
  'typeArm',
  'vidArm',
  'netType',
  'typeSzi',
  'typeArch',
  'typeApp',
  'typeKomis'
]

function readFromStorage(name) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + name)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return null
    if (Date.now() - parsed.savedAt > TTL_MS) return null
    return parsed.items
  } catch {
    return null
  }
}

function writeToStorage(name, items) {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + name,
      JSON.stringify({ items, savedAt: Date.now() })
    )
  } catch {
    void 0
  }
}

export const useDictionariesStore = defineStore('dictionaries', () => {
  const cache = reactive({})
  const pending = new Map()
  const loading = ref({})

  
  async function load(name) {
    if (cache[name]) return cache[name]

    const fromStorage = readFromStorage(name)
    if (fromStorage) {
      cache[name] = fromStorage
      return fromStorage
    }

    if (pending.has(name)) return pending.get(name)

    loading.value = { ...loading.value, [name]: true }
    const promise = dictionariesApi
      .get(name)
      .then((res) => {
        const items = Array.isArray(res?.items) ? res.items : []
        cache[name] = items
        writeToStorage(name, items)
        return items
      })
      .finally(() => {
        pending.delete(name)
        loading.value = { ...loading.value, [name]: false }
      })

    pending.set(name, promise)
    return promise
  }

  
  async function loadMany(names) {
    return Promise.all(names.map((n) => load(n)))
  }

  
  function labelOf(name, id) {
    if (!id) return ''
    const items = cache[name]
    if (!items) return String(id)
    const found = items.find((x) => x.id === id)
    return found ? found.name : String(id)
  }

  function items(name) {
    return cache[name] ?? []
  }

  
  async function refresh(name) {
    delete cache[name]
    try {
      localStorage.removeItem(STORAGE_PREFIX + name)
    } catch {
      void 0
    }
    return load(name)
  }

  function refreshAll() {
    return Promise.all(DICTIONARY_NAMES.map((n) => refresh(n)))
  }

  return {
    cache,
    loading,
    load,
    loadMany,
    labelOf,
    items,
    refresh,
    refreshAll
  }
})
