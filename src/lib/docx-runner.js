import { saveAs } from 'file-saver'

let workerInstance = null
let nextRequestId = 1
const pending = new Map()

function getWorker() {
  if (workerInstance) return workerInstance
  workerInstance = new Worker(new URL('@/workers/docx.worker.js', import.meta.url), {
    type: 'module'
  })
  workerInstance.onmessage = (event) => {
    const { type, requestId, ...rest } = event.data
    const handler = pending.get(requestId)
    if (!handler) return
    if (type === 'progress') {
      handler.onProgress?.(rest.done, rest.total)
    } else if (type === 'done') {
      pending.delete(requestId)
      handler.resolve(rest.blob)
    } else if (type === 'error') {
      pending.delete(requestId)
      handler.reject(new Error(rest.message))
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

export function disposeDocxWorker() {
  workerInstance?.terminate()
  workerInstance = null
  pending.clear()
}

export function runDocxTask(type, payload, onProgress) {
  const w = getWorker()
  const requestId = nextRequestId++
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress })
    w.postMessage({ type, payload, requestId })
  })
}

export async function saveDocx(type, payload, filename, onProgress) {
  const blob = await runDocxTask(type, payload, onProgress)
  saveAs(blob, filename)
}
