import { reactive } from 'vue'

const state = reactive({ items: [] })
let nextId = 1

function push({ message, variant = 'primary', timeout = 4000 }) {
  const id = nextId++
  state.items.push({ id, message, variant, timeout })
  if (timeout > 0) setTimeout(() => dismiss(id), timeout)
  return id
}

function dismiss(id) {
  const i = state.items.findIndex((t) => t.id === id)
  if (i >= 0) state.items.splice(i, 1)
}

function clear() {
  state.items.splice(0)
}

export function useToast() {
  return {
    items: state.items,
    success: (message, timeout) => push({ message, variant: 'success', timeout }),
    error: (message, timeout) => push({ message, variant: 'danger', timeout: timeout ?? 6000 }),
    warning: (message, timeout) => push({ message, variant: 'warning', timeout }),
    info: (message, timeout) => push({ message, variant: 'info', timeout }),
    show: push,
    dismiss,
    clear
  }
}
