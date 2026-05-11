<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { Modal } from 'bootstrap'
import { useConfirm } from './useConfirm.js'

const { state, accept, reject } = useConfirm()

const root = ref(null)
let modal = null

watch(
  () => state.open,
  (open) => {
    if (!root.value) return
    if (!modal) {
      modal = new Modal(root.value, { backdrop: 'static', keyboard: true })
      root.value.addEventListener('hidden.bs.modal', () => {
        if (state.open) reject()
      })
    }
    if (open) modal.show()
    else modal.hide()
  }
)

onBeforeUnmount(() => modal?.dispose())
</script>

<template>
  <div
    ref="root"
    class="modal fade"
    tabindex="-1"
    aria-hidden="true"
  >
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            {{ state.title }}
          </h5>
          <button
            type="button"
            class="btn-close"
            aria-label="Закрыть"
            @click="reject"
          />
        </div>
        <div class="modal-body">
          <p class="mb-0">
            {{ state.message }}
          </p>
        </div>
        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            @click="reject"
          >
            {{ state.cancelText }}
          </button>
          <button
            type="button"
            :class="['btn', `btn-${state.variant}`]"
            @click="accept"
          >
            {{ state.okText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
