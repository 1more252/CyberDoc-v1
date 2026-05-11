import { http } from '@/lib/http.js'

export const authApi = {
  login: (payload) => http.post('/auth/login', payload).then((r) => r.data),
  register: (payload) => http.post('/auth/register', payload).then((r) => r.data),
  refresh: (refreshToken) => http.post('/auth/refresh', { refreshToken }).then((r) => r.data),
  logout: () => http.post('/auth/logout').then((r) => r.data),
  me: () => http.get('/auth/me').then((r) => r.data),
  changePassword: (payload) => http.post('/auth/password', payload).then((r) => r.data)
}
