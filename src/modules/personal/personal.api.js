import { http } from '@/lib/http.js'

export const personalApi = {
  list: (params) => http.get('/personal', { params }).then((r) => r.data),
  get: (id) => http.get(`/personal/${id}`).then((r) => r.data),
  create: (payload) => http.post('/personal', payload).then((r) => r.data),
  update: (id, payload) => http.put(`/personal/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/personal/${id}`).then((r) => r.data),
  bulkUpsert: (organizationId, items) =>
    http.post('/personal/bulk-upsert', { organizationId, items }).then((r) => r.data)
}
