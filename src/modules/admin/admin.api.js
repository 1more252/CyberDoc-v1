import { http } from '@/lib/http.js'

export const adminApi = {
  listUsers: (params) => http.get('/admin/users', { params }).then((r) => r.data),

  setVerified: (username, verified) =>
    http.post(`/admin/users/${encodeURIComponent(username)}/verify`, { verified }).then((r) => r.data),
  setBlocked: (username, blocked) =>
    http.post(`/admin/users/${encodeURIComponent(username)}/block`, { blocked }).then((r) => r.data),
  setRole: (username, role) =>
    http.post(`/admin/users/${encodeURIComponent(username)}/role`, { role }).then((r) => r.data),
  setPassword: (username, password) =>
    http.post(`/admin/users/${encodeURIComponent(username)}/password`, { password }).then((r) => r.data),
  removeUser: (username) =>
    http.delete(`/admin/users/${encodeURIComponent(username)}`).then((r) => r.data),

  listAudit: (params) => http.get('/audit', { params }).then((r) => r.data),
  statistics: () => http.get('/statistics').then((r) => r.data)
}
