import { http } from '@/lib/http.js'

export const softwareApi = {
  list: (params) => http.get('/software', { params }).then((r) => r.data),
  get: (id) => http.get(`/software/${id}`).then((r) => r.data),
  create: (payload) => http.post('/software', payload).then((r) => r.data),
  update: (id, payload) => http.put(`/software/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/software/${id}`).then((r) => r.data)
}
