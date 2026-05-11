import { http } from '@/lib/http.js'

export const organizationApi = {
  list: (params) =>
    http.get('/organizations', { params }).then((r) => r.data),
  get: (id) => http.get(`/organizations/${id}`).then((r) => r.data),
  create: (payload) => http.post('/organizations', payload).then((r) => r.data),
  update: (id, payload) =>
    http.put(`/organizations/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/organizations/${id}`).then((r) => r.data)
}
