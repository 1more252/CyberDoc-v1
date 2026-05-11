import { http } from '@/lib/http.js'

export const documentSetApi = {
  listTemplates: () => http.get('/document-set-templates').then((r) => r.data),
  getTemplate: (id) => http.get(`/document-set-templates/${id}`).then((r) => r.data),
  list: (params) => http.get('/document-sets', { params }).then((r) => r.data),
  get: (id) => http.get(`/document-sets/${id}`).then((r) => r.data),
  create: (payload) => http.post('/document-sets', payload).then((r) => r.data),
  remove: (id) => http.delete(`/document-sets/${id}`).then((r) => r.data)
}
