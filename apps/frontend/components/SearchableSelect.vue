<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  id: { type: String, required: true },
  label: { type: String, required: true },
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Выберите значение' },
  searchPlaceholder: { type: String, default: 'Поиск…' },
  emptyText: { type: String, default: 'Совпадений нет.' },
  minSearchText: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  remote: { type: Boolean, default: false },
  minSearchLength: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'search', 'select']);
const root = ref(null);
const input = ref(null);
const isOpen = ref(false);
const searchQuery = ref('');
const activeIndex = ref(-1);
const selectedCache = ref(null);

const matchingOption = computed(() =>
  props.options.find((option) => String(option.value) === String(props.modelValue)),
);
const selectedOption = computed(() => {
  if (matchingOption.value) return matchingOption.value;
  if (String(selectedCache.value?.value ?? '') === String(props.modelValue ?? '')) {
    return selectedCache.value;
  }
  return null;
});
const visibleOptions = computed(() => {
  if (props.remote || !searchQuery.value.trim()) return props.options;
  const query = searchQuery.value.trim().toLocaleLowerCase();
  return props.options.filter((option) =>
    `${option.label ?? ''} ${option.description ?? ''}`.toLocaleLowerCase().includes(query),
  );
});
const activeOptionId = computed(() =>
  activeIndex.value >= 0 && activeIndex.value < visibleOptions.value.length
    ? `${props.id}-option-${activeIndex.value}`
    : undefined,
);
const tooShort = computed(
  () => props.remote && searchQuery.value.trim().length < props.minSearchLength,
);

function openDropdown() {
  if (props.disabled || isOpen.value) return;
  searchQuery.value = '';
  activeIndex.value = -1;
  isOpen.value = true;
  emit('search', '');
}

function closeDropdown({ restoreFocus = false } = {}) {
  if (!isOpen.value) return;
  isOpen.value = false;
  searchQuery.value = '';
  activeIndex.value = -1;
  emit('search', '');
  if (restoreFocus) nextTick(() => input.value?.focus());
}

function onInput(event) {
  if (!isOpen.value) isOpen.value = true;
  searchQuery.value = event.target.value;
  activeIndex.value = visibleOptions.value.length ? 0 : -1;
  emit('search', searchQuery.value);
}

function selectOption(option) {
  if (!option) return;
  selectedCache.value = option;
  emit('update:modelValue', option.value);
  emit('select', option);
  isOpen.value = false;
  searchQuery.value = '';
  activeIndex.value = -1;
  emit('search', '');
}

function moveActive(delta) {
  const count = visibleOptions.value.length;
  if (!count) {
    activeIndex.value = -1;
    return;
  }
  if (activeIndex.value < 0) {
    activeIndex.value = delta > 0 ? 0 : count - 1;
    return;
  }
  activeIndex.value = (activeIndex.value + delta + count) % count;
}

function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!isOpen.value) {
      openDropdown();
      moveActive(1);
    } else moveActive(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!isOpen.value) {
      openDropdown();
      moveActive(-1);
    } else moveActive(-1);
  } else if (event.key === 'Home' && isOpen.value) {
    event.preventDefault();
    activeIndex.value = visibleOptions.value.length ? 0 : -1;
  } else if (event.key === 'End' && isOpen.value) {
    event.preventDefault();
    activeIndex.value = visibleOptions.value.length - 1;
  } else if (event.key === 'Enter' && isOpen.value) {
    event.preventDefault();
    selectOption(visibleOptions.value[activeIndex.value]);
  } else if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault();
    closeDropdown();
  } else if (event.key === 'Tab' && isOpen.value) {
    closeDropdown();
  }
}

function onDocumentPointerDown(event) {
  if (isOpen.value && !root.value?.contains(event.target)) closeDropdown();
}

watch(
  () => props.modelValue,
  (value) => {
    if (String(selectedCache.value?.value ?? '') === String(value ?? '')) return;
    selectedCache.value =
      props.options.find((option) => String(option.value) === String(value ?? '')) ?? null;
  },
);
watch(
  () => props.options,
  (options) => {
    const option = options.find((item) => String(item.value) === String(props.modelValue ?? ''));
    if (option) selectedCache.value = option;
    if (activeIndex.value >= visibleOptions.value.length) {
      activeIndex.value = visibleOptions.value.length - 1;
    } else if (isOpen.value && activeIndex.value < 0 && visibleOptions.value.length) {
      activeIndex.value = 0;
    }
  },
);

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown));
</script>

<template>
  <div ref="root" class="searchable-select">
    <label class="searchable-select-label" :for="id">{{ label }}</label>
    <div class="searchable-select-control">
      <input
        :id="id"
        ref="input"
        class="input searchable-select-input"
        type="text"
        role="combobox"
        autocomplete="off"
        :value="isOpen ? searchQuery : (selectedOption?.label ?? '')"
        :placeholder="isOpen ? searchPlaceholder : placeholder"
        :disabled="disabled"
        :aria-expanded="isOpen"
        :aria-controls="`${id}-listbox`"
        :aria-activedescendant="activeOptionId"
        aria-autocomplete="list"
        @focus="openDropdown"
        @click="openDropdown"
        @input="onInput"
        @keydown="onKeydown"
      />
      <span class="searchable-select-chevron" aria-hidden="true">⌄</span>
    </div>
    <div v-show="isOpen" class="searchable-select-popup">
      <p v-if="loading" class="searchable-select-status" role="status">Ищем…</p>
      <p v-else-if="tooShort" class="searchable-select-status">
        {{ minSearchText || `Введите не менее ${minSearchLength} символов.` }}
      </p>
      <p v-else-if="!visibleOptions.length" class="searchable-select-status">{{ emptyText }}</p>
      <ul
        :id="`${id}-listbox`"
        class="searchable-select-list"
        role="listbox"
        :aria-label="label"
        v-show="!loading && !tooShort && visibleOptions.length"
      >
        <li v-for="(option, index) in visibleOptions" :key="option.value" role="presentation">
          <button
            :id="`${id}-option-${index}`"
            class="searchable-select-option"
            :class="{ 'searchable-select-option-active': activeIndex === index }"
            type="button"
            role="option"
            :aria-selected="String(modelValue) === String(option.value)"
            @mouseenter="activeIndex = index"
            @mousedown.prevent
            @click="selectOption(option)"
          >
            <span class="searchable-select-option-label">{{ option.label }}</span>
            <span v-if="option.description" class="searchable-select-option-description">{{
              option.description
            }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.searchable-select {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 6px;
}

.searchable-select-label {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: 650;
}

.searchable-select-control {
  position: relative;
}

.searchable-select-input {
  width: 100%;
  padding-right: 36px;
}

.searchable-select-chevron {
  position: absolute;
  top: 50%;
  right: 12px;
  color: var(--color-text-muted);
  pointer-events: none;
  transform: translateY(-55%);
}

.searchable-select-popup {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.searchable-select-list {
  display: grid;
  max-height: 280px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
}

.searchable-select-option {
  display: grid;
  width: 100%;
  gap: 3px;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
}

.searchable-select-option:hover,
.searchable-select-option-active {
  background: var(--color-surface-muted);
}

.searchable-select-option[aria-selected='true'] {
  color: var(--color-primary-700);
  font-weight: 650;
}

.searchable-select-option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.searchable-select-option-description,
.searchable-select-status {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.searchable-select-option-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.searchable-select-status {
  margin: 0;
  padding: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .searchable-select-popup {
    scroll-behavior: auto;
  }
}
</style>
