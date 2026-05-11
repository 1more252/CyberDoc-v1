import { http } from '@/lib/http.js'

export const registryApi = {
  list: (params) => http.get('/registry', { params }).then((r) => r.data),
  get: (id) => http.get(`/registry/${id}`).then((r) => r.data),
  create: (payload) => http.post('/registry', payload).then((r) => r.data),
  update: (id, payload) => http.put(`/registry/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/registry/${id}`).then((r) => r.data),
  submit: (id) => http.post(`/registry/${id}/submit`).then((r) => r.data),
  approve: (id, comment = '') =>
    http.post(`/registry/${id}/approve`, { comment }).then((r) => r.data),
  reject: (id, comment) =>
    http.post(`/registry/${id}/reject`, { comment }).then((r) => r.data)
}
