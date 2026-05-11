import { http } from '@/lib/http.js'

export const dictionariesApi = {
  get: (name) => http.get(`/dictionaries/${name}`).then((r) => r.data)
}
