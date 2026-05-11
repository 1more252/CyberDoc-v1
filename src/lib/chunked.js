import { runWithConcurrency } from './queue.js'

export async function chunkedRequest(items, fetchChunk, opts = {}) {
  const { chunkSize = 50, concurrency = 2, onProgress } = opts
  if (!items.length) return { items: [], errors: [] }

  const chunks = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }

  let processedItems = 0
  const tasks = chunks.map((chunk) => async () => {
    const res = await fetchChunk(chunk)
    processedItems += chunk.length
    onProgress?.(processedItems, items.length)
    return res
  })

  const results = await runWithConcurrency(tasks, concurrency)

  const out = []
  const errors = []
  results.forEach((r, idx) => {
    if (r.ok) out.push(...(r.value ?? []))
    else errors.push({ chunkIndex: idx, error: r.error })
  })
  return { items: out, errors }
}
