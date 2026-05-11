import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { configureHttp } from '@/lib/http.js'
import { useToast } from '@/ui/useToast.js'
import { isTokenExpired, parseJwt } from '@/lib/jwt.js'
import { lsGet, lsRemove, lsSet } from '@/lib/storage.js'
import { authApi } from './auth.api.js'

const TOKEN_KEY = 'cyberdoc.token'
const REFRESH_KEY = 'cyberdoc.refresh'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(null)
  const refreshToken = ref(null)
  const user = ref(null)

  const isAuthenticated = computed(() => !!token.value && !!user.value)
  const role = computed(() => user.value?.role ?? null)

  function applyToken(newToken, newRefresh) {
    const payload = parseJwt(newToken)
    if (!payload) throw new Error('invalid token')
    token.value = newToken
    if (newRefresh) refreshToken.value = newRefresh
    user.value = {
      username: payload.sub,
      role: payload.role,
      verified: payload.verified,
      blocked: payload.blocked
    }
    lsSet(TOKEN_KEY, newToken)
    if (newRefresh) lsSet(REFRESH_KEY, newRefresh)
  }

  function clear() {
    token.value = null
    refreshToken.value = null
    user.value = null
    lsRemove(TOKEN_KEY)
    lsRemove(REFRESH_KEY)
  }

  async function login(payload) {
    const res = await authApi.login(payload)
    const parsed = parseJwt(res.token)
    if (!parsed) throw new Error('invalid token')
    if (parsed.blocked) throw new Error('blocked')
    if (!parsed.verified) throw new Error('not_verified')
    applyToken(res.token, res.refreshToken)
  }

  async function logout() {
    try {
      await authApi.logout()
    } catch {
      void 0
    } finally {
      clear()
    }
  }

  async function tryRefresh() {
    if (!refreshToken.value) {
      clear()
      return null
    }
    try {
      const res = await authApi.refresh(refreshToken.value)
      applyToken(res.token, res.refreshToken)
      return res.token
    } catch {
      clear()
      return null
    }
  }

  function hydrate() {
    const stored = lsGet(TOKEN_KEY)
    const storedRefresh = lsGet(REFRESH_KEY)
    if (stored && !isTokenExpired(stored)) {
      try {
        applyToken(stored, storedRefresh ?? undefined)
      } catch {
        clear()
      }
    } else {
      clear()
    }

    const toast = useToast()
    configureHttp({
      getToken: () => token.value,
      onUnauthorized: () => tryRefresh(),
      onForbidden: () => toast.error('Доступ запрещён.'),
      onServerError: (msg) => toast.error(msg),
      onNetworkError: () => toast.error('Нет соединения с сервером.')
    })
  }

  return {
    token,
    user,
    isAuthenticated,
    role,
    login,
    logout,
    tryRefresh,
    hydrate,
    clear
  }
})
