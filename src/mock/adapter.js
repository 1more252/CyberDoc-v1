import { AxiosError, AxiosHeaders } from 'axios'
import { handleMockRequest } from './handlers.js'

export const mockAdapter = async (config) => {
  const method = (config.method ?? 'get').toUpperCase()
  const url = config.url ?? ''

  let body = config.data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      void 0
    }
  }

  const headers = {}
  if (config.headers) {
    const h = config.headers
    headers.authorization =
      (typeof h.get === 'function' ? h.get('Authorization') : undefined) ??
      h['Authorization'] ??
      h['authorization']
  }

  const result = await handleMockRequest({ method, url, body, headers })

  const responseHeaders = new AxiosHeaders({ 'content-type': 'application/json' })
  const response = {
    data: result.data,
    status: result.status,
    statusText: result.status >= 200 && result.status < 300 ? 'OK' : 'Error',
    headers: responseHeaders,
    config,
    request: null
  }

  if (result.status >= 200 && result.status < 300) return response

  throw new AxiosError(
    `Request failed with status code ${result.status}`,
    String(result.status),
    config,
    null,
    response
  )
}
