
function base64UrlEncode(input) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function signMockJwt(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'mock', typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${header}.${body}.cyberdoc-mock`
}

export function makeAccessToken({ username, role, verified, blocked, ttlSeconds = 3600 }) {
  const now = Math.floor(Date.now() / 1000)
  return signMockJwt({
    sub: username,
    role,
    verified,
    blocked,
    iat: now,
    exp: now + ttlSeconds
  })
}

export function makeRefreshToken(username) {
  const random = Math.random().toString(36).slice(2)
  return base64UrlEncode(`${username}.${Date.now()}.${random}`)
}
