<template>
  <main class="auth-layout confirmation-layout">
    <section class="auth-brand">
      <div class="brand-lockup">
        <span class="brand-mark">▥</span>
        <span>RP Gant</span>
      </div>
      <div class="auth-brand-copy">
        <p class="eyebrow" style="color: #93c5fd">Доступ открыт</p>
        <h1>Теперь вы<br />в команде.</h1>
        <p>Подтверждённый адрес помогает безопасно восстановить доступ и получать важные уведомления.</p>
      </div>
      <div class="auth-points">
        <div class="auth-point"><span class="check">✓</span><span>Ваш email подтверждён</span></div>
        <div class="auth-point"><span class="check">✓</span><span>Войдите, чтобы перейти к проектам</span></div>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card confirmation-card" role="status" aria-live="polite">
        <div class="success-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" />
            <path d="m14 24 7 7 14-15" />
          </svg>
        </div>
        <p class="eyebrow">Проверка завершена</p>
        <h1>Email подтверждён</h1>
        <p class="muted">Адрес электронной почты подтверждён. Теперь вы можете войти в RP Gant.</p>
        <NuxtLink class="btn btn-primary btn-lg btn-block login-link" to="/login">
          Перейти ко входу
          <span aria-hidden="true">→</span>
        </NuxtLink>
        <p class="footnote">Вход не выполнен автоматически — используйте свой пароль на следующем экране.</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.confirmation-layout { min-height: 100vh; }
.confirmation-layout .auth-brand { padding: 64px clamp(32px, 6vw, 96px); }
.auth-brand-copy h1 { margin: 18px 0 20px; }
.auth-brand-copy p { max-width: 560px; }
.auth-panel { padding: 48px clamp(24px, 5vw, 80px); }
.confirmation-card { width: min(460px, 100%); }
.confirmation-card h1 { margin: 0; font-size: clamp(30px, 3.4vw, 40px); line-height: 1.1; letter-spacing: -0.04em; }
.confirmation-card .eyebrow { margin-top: 24px; }
.confirmation-card .muted { max-width: 390px; margin: 12px 0 28px; color: var(--color-text-muted); font-size: var(--text-lg); line-height: 1.55; }
.success-mark { display: grid; width: 64px; height: 64px; place-items: center; border: 1px solid #bbf7d0; border-radius: 20px; background: linear-gradient(145deg, #f0fdf4, #dcfce7); box-shadow: 0 8px 22px rgba(22, 163, 74, 0.12); }
.success-mark svg { width: 42px; height: 42px; }
.success-mark circle { stroke: #86efac; stroke-width: 1.5; }
.success-mark path { stroke: #15803d; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.login-link { display: flex; align-items: center; justify-content: center; gap: 12px; text-decoration: none; }
.login-link span { font-size: 20px; line-height: 1; transition: transform 150ms ease; }
.login-link:hover span { transform: translateX(3px); }
.footnote { margin: 14px 0 0; color: var(--color-text-muted); font-size: var(--text-xs); text-align: center; }
@media (max-width: 900px) {
  .confirmation-layout { grid-template-columns: 1fr; }
  .confirmation-layout .auth-brand, .auth-panel { padding: 32px 24px; }
  .auth-brand-copy h1 { font-size: 38px; }
}
</style>
