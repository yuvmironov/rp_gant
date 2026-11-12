<script setup>
const props = defineProps({
  user: { type: Object, default: () => ({}) },
  unreadCount: { type: Number, default: 0 },
  activePage: { type: String, default: '' },
});

const emit = defineEmits(['logout']);

const displayName = computed(() => props.user?.displayName || props.user?.email || 'Пользователь');
const initials = computed(() =>
  String(displayName.value)
    .trim()
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'П',
);
</script>

<template>
  <header class="app-header">
    <a class="app-brand" href="/projects" aria-label="RP Gant — проекты">
      <span class="brand-mark" aria-hidden="true">▥</span>
      <span>RP Gant</span>
    </a>
    <nav class="app-nav" aria-label="Основная навигация">
      <a href="/projects" :class="{ active: activePage === 'projects' }" :aria-current="activePage === 'projects' ? 'page' : undefined">Проекты</a>
      <a href="/members" :class="{ active: activePage === 'members' }" :aria-current="activePage === 'members' ? 'page' : undefined">Участники</a>
      <a href="/notifications" :class="{ active: activePage === 'notifications' }" :aria-current="activePage === 'notifications' ? 'page' : undefined">Уведомления</a>
      <a href="/profile" :class="{ active: activePage === 'profile' }" :aria-current="activePage === 'profile' ? 'page' : undefined">Профиль</a>
      <a
        v-if="user?.globalRoles?.includes('app_admin')"
        href="/admin"
        :class="{ active: activePage === 'admin' }"
        :aria-current="activePage === 'admin' ? 'page' : undefined"
      >
        Админка
      </a>
    </nav>
    <div class="app-header-right">
      <slot name="status" />
      <a class="header-icon" href="/notifications" aria-label="Уведомления">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        <span v-if="unreadCount" class="header-notice-count">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
      </a>
      <div class="user-chip">
        <span class="avatar">{{ initials }}</span>
        <span class="user-chip-name">{{ displayName }}</span>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" @click="emit('logout')">Выйти</button>
    </div>
  </header>
</template>

<style scoped>
.header-icon {
  text-decoration: none;
}

.header-icon svg {
  width: 17px;
  height: 17px;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.header-notice-count {
  position: absolute;
  top: -5px;
  right: -6px;
  display: grid;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  place-items: center;
  border: 2px solid var(--color-surface);
  border-radius: var(--radius-pill);
  background: var(--color-danger-600);
  color: #fff;
  font-size: 9px;
  font-weight: 750;
  line-height: 1;
}

.user-chip-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .user-chip-name {
    max-width: 110px;
  }
}

@media (max-width: 720px) {
  .app-header {
    height: auto;
    min-height: var(--header-height);
    flex-wrap: wrap;
    gap: 0 12px;
    padding: 8px var(--page-padding);
  }

  .app-nav {
    order: 3;
    width: 100%;
    height: 36px;
    overflow-x: auto;
  }

  .app-nav a {
    flex: 0 0 auto;
    padding: 0 9px;
  }

  .app-header-right {
    gap: 6px;
  }

  .user-chip {
    padding-right: 5px;
  }

  .user-chip-name {
    display: none;
  }
}
</style>
