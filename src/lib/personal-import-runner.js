
let workerInstance = null
let nextRequestId = 1
const pending = new Map()

function getWorker() {
  if (workerInstance) return workerInstance
  workerInstance = new Worker(
    new URL('@/workers/personal-import.worker.js', import.meta.url),
    { type: 'module' }
  )
  workerInstance.onmessage = (event) => {
    const { type, requestId, ...rest } = event.data || {}
    const handler = pending.get(requestId)
    if (!handler) return
    if (type === 'progress') {
      handler.onProgress?.(rest.done, rest.total)
    } else if (type === 'done') {
      pending.delete(requestId)
      handler.resolve({ items: rest.items, errors: rest.errors })
    } else if (type === 'error') {
      pending.delete(requestId)
      handler.reject(new Error(rest.error))
    }
  }
  workerInstance.onerror = (err) => {
    for (const [id, h] of pending) {
      h.reject(err)
      pending.delete(id)
    }
  }
  return workerInstance
}

export function disposePersonalImportWorker() {
  workerInstance?.terminate()
  workerInstance = null
  pending.clear()
}

export async function parsePersonalFile(file, onProgress) {
  const text = await file.text()
  const w = getWorker()
  const requestId = nextRequestId++
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress })
    w.postMessage({ type: 'parse', payload: { text }, requestId })
  })
}
