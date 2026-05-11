import { http } from '@/lib/http.js'

export const equipmentApi = {
  list: (params) => http.get('/equipment', { params }).then((r) => r.data),
  get: (id) => http.get(`/equipment/${id}`).then((r) => r.data),
  create: (payload) => http.post('/equipment', payload).then((r) => r.data),
  update: (id, payload) => http.put(`/equipment/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/equipment/${id}`).then((r) => r.data)
}
