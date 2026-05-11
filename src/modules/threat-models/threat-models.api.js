import { http } from '@/lib/http.js'

export const threatsCatalogApi = {
  list: (params) => http.get('/threats-catalog', { params }).then((r) => r.data)
}

export const threatModelsApi = {
  list: (params) => http.get('/threat-models', { params }).then((r) => r.data),
  get: (id) => http.get(`/threat-models/${id}`).then((r) => r.data),
  create: (payload) => http.post('/threat-models', payload).then((r) => r.data),
  update: (id, payload) => http.put(`/threat-models/${id}`, payload).then((r) => r.data),
  remove: (id) => http.delete(`/threat-models/${id}`).then((r) => r.data)
}
