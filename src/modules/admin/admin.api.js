import { http } from '@/lib/http.js'

// /health и /metrics висят на root (не /api/), потому что они «инфраструктурные»
// и обычно мониторятся отдельной системой (k8s probe, Prometheus). Чтобы дёрнуть
// их через тот же axios-клиент, надо обойти baseURL='/api' — отсюда абсолютные
// пути, начинающиеся с '../', либо отдельный fetch. Используем fetch с базовым
// origin'ом (window.location.origin) — это и проще, и не зависит от axios-конфига.
async function fetchRootJson(path) {
  const r = await fetch(path, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

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
  statistics: () => http.get('/statistics').then((r) => r.data),

  // --- ops endpoints (server-side maintenance) -------------------------
  // /health публичный (root-mounted, без /api) — axios-baseURL='/api' не
  // подходит, идём через fetch напрямую.
  health: () => fetchRootJson('/health'),
  // /admin/* под /api — авторизация через axios-interceptor (Bearer header).
  // Все возвращают 403 без admin-роли.
  dbStats: () => http.get('/admin/db-stats').then((r) => r.data),
  walCheckpoint: () => http.post('/admin/wal-checkpoint').then((r) => r.data),
  backup: () => http.post('/admin/backup').then((r) => r.data),
  maintenance: () => http.post('/admin/maintenance').then((r) => r.data)
}
