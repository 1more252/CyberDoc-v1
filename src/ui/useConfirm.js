import { reactive } from 'vue'

const state = reactive({
  open: false,
  title: 'Подтверждение',
  message: '',
  okText: 'OK',
  cancelText: 'Отмена',
  variant: 'primary'
})

let resolver = null

export function useConfirm() {
  function ask(options) {
    state.title = options.title ?? 'Подтверждение'
    state.message = options.message
    state.okText = options.okText ?? 'OK'
    state.cancelText = options.cancelText ?? 'Отмена'
    state.variant = options.variant ?? 'primary'
    state.open = true
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  function settle(result) {
    state.open = false
    if (resolver) {
      resolver(result)
      resolver = null
    }
  }

  return {
    state,
    ask,
    accept: () => settle(true),
    reject: () => settle(false)
  }
}
