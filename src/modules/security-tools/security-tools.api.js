import { http } from '@/lib/http.js'

export const securityToolsApi = {
  list: (params) => http.get('/security-tools', { params }).then((r) => r.data),
  get: (id) => http.get(`/security-tools/${id}`).then((r) => r.data),
  create: (payload) => http.post('/security-tools', payload).then((r) => r.data),
  update: (id, payload) => http.put(`/security-tools/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/security-tools/${id}`).then((r) => r.data)
}
