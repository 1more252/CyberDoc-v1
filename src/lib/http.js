import axios from 'axios'

const useMock = import.meta.env.VITE_USE_MOCK_API === 'true'

let getToken = null
let onUnauthorized = null
let onForbidden = null
let onServerError = null
let onNetworkError = null

let adapterPromise = null
async function ensureMockAdapter() {
  if (!useMock) return undefined
  if (!adapterPromise) {
    adapterPromise = import('@/mock/adapter.js').then((m) => m.mockAdapter)
  }
  return adapterPromise
}

export function configureHttp(opts) {
  getToken = opts.getToken
  onUnauthorized = opts.onUnauthorized
  onForbidden = opts.onForbidden
  onServerError = opts.onServerError ?? null
  onNetworkError = opts.onNetworkError ?? null
}

export const http = axios.create({
  baseURL: useMock ? '' : import.meta.env.VITE_API_URL,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' }
})

if (useMock) {
  http.defaults.adapter = async (config) => {
    const adapter = await ensureMockAdapter()
    return adapter(config)
  }
}

export const isMockApi = useMock

http.interceptors.request.use((config) => {
  const token = getToken?.()
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    const status = error.response?.status

    if (status === 401 && original && !original._retry && onUnauthorized) {
      original._retry = true
      const newToken = await onUnauthorized()
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`)
        return http(original)
      }
    }

    if (status === 403) onForbidden?.()
    else if (status && status >= 500) onServerError?.(`Ошибка сервера ${status}. Попробуйте позже.`)
    else if (!error.response && error.code !== 'ERR_CANCELED') onNetworkError?.()

    return Promise.reject(toApiError(error))
  }
)

export function toApiError(err) {
  if (axios.isAxiosError(err)) {
    return {
      status: err.response?.status ?? 0,
      message:
        err.response?.data?.error ?? err.response?.data?.message ?? err.message,
      details: err.response?.data
    }
  }
  return { status: 0, message: err?.message ?? 'Unknown error' }
}
