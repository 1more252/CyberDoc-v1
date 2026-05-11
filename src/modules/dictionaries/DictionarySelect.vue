<script setup>
import { computed, onMounted, useId } from 'vue'
import { useDictionariesStore } from './dictionaries.store.js'

const props = defineProps({
  modelValue: { type: [String, Number, null], default: '' },
  dict: { type: String, required: true },
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '— выберите —' },
  allowEmpty: { type: Boolean, default: true }
})

defineEmits(['update:modelValue'])

const store = useDictionariesStore()
const fid = useId()

const items = computed(() => store.items(props.dict))
const isLoading = computed(() => !!store.loading[props.dict])

const selectClass = computed(() => ['form-select', { 'is-invalid': !!props.error }])

onMounted(() => {
  store.load(props.dict)
})
</script>

<template>
  <div class="mb-3">
    <label
      v-if="label"
      :for="fid"
      class="form-label"
    >
      {{ label }}<span
        v-if="required"
        class="text-danger"
      >&nbsp;*</span>
    </label>
    <select
      :id="fid"
      :class="selectClass"
      :disabled="disabled || (isLoading && !items.length)"
      :value="modelValue ?? ''"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option
        v-if="allowEmpty"
        value=""
      >
        {{ isLoading && !items.length ? 'Загрузка…' : placeholder }}
      </option>
      <option
        v-for="opt in items"
        :key="opt.id"
        :value="opt.id"
      >
        {{ opt.name }}
      </option>
    </select>

    <div
      v-if="error"
      class="invalid-feedback d-block"
    >
      {{ error }}
    </div>
    <div
      v-else-if="hint"
      class="form-text"
    >
      {{ hint }}
    </div>
  </div>
</template>
