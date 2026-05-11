<script setup>
import { computed, useId } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number, Boolean, null], default: '' },
  label: { type: String, default: '' },
  name: { type: String, default: '' },
  type: { type: String, default: 'text' },
  as: { type: String, default: 'input' },
  placeholder: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  autocomplete: { type: String, default: '' },
  rows: { type: Number, default: 3 }
})

defineEmits(['update:modelValue'])

const fid = useId()

const inputClass = computed(() => [
  props.as === 'select' ? 'form-select' : 'form-control',
  { 'is-invalid': !!props.error }
])
</script>

<template>
  <div class="mb-3">
    <label
      v-if="label"
      :for="fid"
      :class="['form-label']"
    >
      {{ label }}<span
        v-if="required"
        class="text-danger"
      >&nbsp;*</span>
    </label>

    <slot
      :id="fid"
      :class="inputClass"
      :value="modelValue"
      :on-input="(e) => $emit('update:modelValue', e.target.value)"
    >
      <textarea
        v-if="as === 'textarea'"
        :id="fid"
        :class="inputClass"
        :name="name"
        :rows="rows"
        :placeholder="placeholder"
        :required="required"
        :disabled="disabled"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <input
        v-else
        :id="fid"
        :class="inputClass"
        :type="type"
        :name="name"
        :placeholder="placeholder"
        :required="required"
        :disabled="disabled"
        :autocomplete="autocomplete"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
      >
    </slot>

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
