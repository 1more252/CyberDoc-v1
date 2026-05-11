import { http } from '@/lib/http.js'

export const securityToolsDbApi = {
  list: (params) => http.get('/security-tools-catalog', { params }).then((r) => r.data),
  get: (id) => http.get(`/security-tools-catalog/${id}`).then((r) => r.data),
  create: (payload) => http.post('/security-tools-catalog', payload).then((r) => r.data),
  update: (id, payload) =>
    http.put(`/security-tools-catalog/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/security-tools-catalog/${id}`).then((r) => r.data)
}
