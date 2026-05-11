
export async function runWithConcurrency(tasks, concurrency = 2, onProgress) {
  const total = tasks.length
  const results = new Array(total)
  let nextIndex = 0
  let done = 0

  async function worker() {
    while (true) {
      const i = nextIndex++
      if (i >= total) return
      try {
        results[i] = { ok: true, value: await tasks[i]() }
      } catch (e) {
        results[i] = { ok: false, error: e }
      }
      done++
      onProgress?.(done, total)
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, total)) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}
