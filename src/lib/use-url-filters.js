// Двусторонняя синхронизация фильтров Pinia-стора и URL query params.
// Зачем: при возврате на список (после редактирования/перезагрузки страницы /
// расшаривания ссылки) состояние фильтров не теряется.
//
// Соглашения:
// - В URL пишется ТОЛЬКО non-default значение. page=1 / пустая строка /
//   false для boolean → не пишется (чистый URL без шума).
// - На mount: читаем query → ставим store.* напрямую (минуя сеттеры,
//   чтобы не дёргать каскады и не сбрасывать page=1 при восстановлении).
//   Потребитель в onReady сам триггерит fetchList() и любые каскады.
// - На изменение store.* → router.replace (не push: чтобы не плодить
//   history-записи при каждом нажатии на стрелку пагинации).
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export function useUrlFilterSync({ store, fields, numericFields = [], booleanFields = [], onReady }) {
  const route = useRoute()
  const router = useRouter()
  const numericSet = new Set(numericFields)
  const booleanSet = new Set(booleanFields)
  // suppress=true во время чтения URL → запрещаем обратный watch отправлять
  // только что прочитанное обратно (иначе кольцо + лишний router.replace).
  let suppress = false

  onMounted(() => {
    suppress = true
    const q = route.query
    for (const f of fields) {
      const raw = q[f]
      if (raw == null || raw === '') continue
      let parsed
      if (booleanSet.has(f)) {
        parsed = raw === '1' || raw === 'true'
      } else if (numericSet.has(f)) {
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 1) continue
        parsed = Math.floor(n)
      } else {
        parsed = String(raw)
      }
      store[f] = parsed
    }
    suppress = false
    onReady?.()
  })

  watch(
    () => fields.map((f) => store[f]),
    () => {
      if (suppress) return
      const next = { ...route.query }
      for (const f of fields) {
        const v = store[f]
        const isDefault =
          v == null ||
          v === '' ||
          (numericSet.has(f) && v === 1) ||
          (booleanSet.has(f) && v === false)
        if (isDefault) delete next[f]
        else next[f] = String(v)
      }
      // Идемпотентность: не вызываем replace, если query не изменилось
      // (защита от лишних history-операций при no-op обновлениях стора).
      const prev = route.query
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => String(next[k]) === String(prev[k] ?? ''))) return
      router.replace({ query: next }).catch(() => {})
    }
  )
}
