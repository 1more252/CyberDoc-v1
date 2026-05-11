import { http } from '@/lib/http.js'

export const infoSystemsApi = {
  list: (params) => http.get('/info-systems', { params }).then((r) => r.data),
  get: (id) => http.get(`/info-systems/${id}`).then((r) => r.data),
  create: (payload) => http.post('/info-systems', payload).then((r) => r.data),
  update: (id, payload) => http.put(`/info-systems/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/info-systems/${id}`).then((r) => r.data)
}
