
export function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1]
    if (!base64Url) return null
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function isTokenExpired(token) {
  const p = parseJwt(token)
  if (!p?.exp) return true
  return p.exp * 1000 < Date.now()
}

export function tokenExpiresInMs(token) {
  const p = parseJwt(token)
  if (!p?.exp) return 0
  return Math.max(0, p.exp * 1000 - Date.now())
}
