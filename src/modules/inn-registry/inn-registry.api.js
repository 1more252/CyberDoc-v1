import { http } from '@/lib/http.js'

export const innRegistryApi = {
  list: (params) => http.get('/inn-registry', { params }).then((r) => r.data),
  lookupChunk: (inns) => http.post('/fns/lookup', { inns }).then((r) => r.data),
  bulkUpsert: (items) => http.post('/inn-registry/bulk-upsert', { items }).then((r) => r.data),
  remove: (id) => http.delete(`/inn-registry/${id}`).then((r) => r.data),
  clear: () => http.delete('/inn-registry').then((r) => r.data)
}
