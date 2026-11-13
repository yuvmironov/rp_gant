<script setup>
const route = useRoute();
const token = ref(typeof route.query.token === 'string' ? route.query.token : '');
const email = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const isChecking = ref(true);
const error = ref('');
const toast = useToast();

function clearResetTokenFromAddressBar() {
  window.history.replaceState(window.history.state, '', '/reset-password');
}

async function api(path, body) {
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.detail ?? response.statusText);
  }
  return response.status === 204 ? null : response.json();
}

function invalidLinkMessage(reason) {
  return String(reason).includes('invalid_token') || String(reason).includes('token_required')
    ? 'Ссылка недействительна, истекла или уже использована. Запросите новую ссылку для сброса пароля.'
    : reason;
}

async function resetPassword() {
  error.value = '';
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Пароли не совпадают.';
    return;
  }

  try {
    await api('/auth/password/reset', {
      token: token.value,
      newPassword: newPassword.value,
    });
    toast.success('Пароль сохранён. Войдите с новым паролем.');
    await navigateTo('/login', { replace: true });
  } catch (reason) {
    error.value = invalidLinkMessage(reason.message);
  }
}

onMounted(async () => {
  if (!token.value) {
    error.value = 'В ссылке отсутствует токен сброса пароля. Запросите новую ссылку.';
    isChecking.value = false;
    return;
  }

  try {
    const result = await api('/auth/password/reset/validate', { token: token.value });
    email.value = result.email;
  } catch (reason) {
    error.value = invalidLinkMessage(reason.message);
  } finally {
    clearResetTokenFromAddressBar();
    isChecking.value = false;
  }
});
</script>

<template>
  <main class="auth-layout reset-layout">
    <section class="auth-brand">
      <div class="brand-lockup">
        <span class="brand-mark">▥</span>
        <span>RP Gant</span>
      </div>
      <div class="auth-brand-copy">
        <p class="eyebrow" style="color:#93c5fd">Защита рабочего пространства</p>
        <h1>Новый пароль.<br />Ваш доступ.</h1>
        <p>Установите надёжный пароль, чтобы продолжить работу с проектами и планами команды.</p>
      </div>
      <div class="auth-points">
        <div class="auth-point"><span class="check">✓</span><span>Ссылка одноразовая и ограничена по времени</span></div>
        <div class="auth-point"><span class="check">✓</span><span>После обновления прежние сессии завершатся</span></div>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card reset-card">
        <p class="eyebrow">Восстановление доступа</p>
        <h2>Задать новый пароль</h2>
        <p class="muted">Укажите пароль для учётной записи, связанной с письмом.</p>

        <div v-if="isChecking" class="checking-state" role="status">
          <span class="checking-mark" aria-hidden="true">↻</span>
          Проверяем ссылку…
        </div>

        <template v-else-if="email">
          <div class="account-callout">
            <span class="account-icon" aria-hidden="true">@</span>
            <span><span class="account-label">Пароль будет установлен для</span><strong>{{ email }}</strong></span>
          </div>

          <form class="form-stack reset-form" @submit.prevent="resetPassword">
            <div class="field">
              <label for="reset-token">Токен восстановления</label>
              <input id="reset-token" class="input token-input" :value="token" readonly aria-readonly="true" autocomplete="off" />
              <span class="field-hint">Токен из письма только для просмотра и изменить его нельзя.</span>
            </div>
            <div class="field">
              <label for="reset-password">Новый пароль</label>
              <div class="password-control">
                <input id="reset-password" v-model="newPassword" class="input" name="newPassword" :type="showPassword ? 'text' : 'password'" minlength="8" maxlength="128" autocomplete="new-password" required />
                <button class="password-toggle" type="button" :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'" @click="showPassword = !showPassword">{{ showPassword ? 'Скрыть' : 'Показать' }}</button>
              </div>
              <span class="field-hint">Не менее 8 символов</span>
            </div>
            <div class="field">
              <label for="reset-confirm-password">Подтверждение пароля</label>
              <div class="password-control">
                <input id="reset-confirm-password" v-model="confirmPassword" class="input" name="confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" minlength="8" maxlength="128" autocomplete="new-password" required />
                <button class="password-toggle" type="button" :aria-label="showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'" @click="showConfirmPassword = !showConfirmPassword">{{ showConfirmPassword ? 'Скрыть' : 'Показать' }}</button>
              </div>
            </div>
            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
            <button class="btn btn-primary btn-lg btn-block auth-submit" type="submit">Сохранить новый пароль</button>
          </form>
        </template>

        <div v-else class="invalid-state" role="alert">
          <span class="invalid-mark" aria-hidden="true">!</span>
          <p>{{ error }}</p>
          <NuxtLink class="btn btn-primary btn-lg btn-block" to="/login">Вернуться ко входу</NuxtLink>
        </div>

        <NuxtLink v-if="email" class="back-link" to="/login">Вернуться ко входу</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.reset-layout { min-height: 100vh; }
.reset-layout .auth-brand { padding: 64px clamp(32px, 6vw, 96px); }
.auth-brand-copy h1 { margin: 18px 0 20px; }
.auth-brand-copy p { max-width: 560px; }
.auth-panel { padding: 48px clamp(24px, 5vw, 80px); }
.reset-card { width: min(500px, 100%); }
.reset-card h2 { margin: 0; font-size: clamp(26px, 3vw, 34px); letter-spacing: -0.035em; }
.reset-card > .muted { margin: 10px 0 24px; }
.account-callout { display: flex; align-items: center; gap: 13px; margin-bottom: 22px; padding: 14px 16px; border: 1px solid #bfdbfe; border-radius: var(--radius-lg); background: linear-gradient(110deg, #eff6ff 0%, #f8fbff 76%); }
.account-icon { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 11px; background: #dbeafe; color: #1d4ed8; font-weight: 800; }
.account-callout > span:last-child { display: grid; gap: 2px; min-width: 0; }
.account-label { color: var(--color-text-muted); font-size: var(--text-xs); }
.account-callout strong { overflow-wrap: anywhere; font-size: var(--text-md); }
.token-input { color: #52647c; background: #f8fafc; font-family: var(--font-mono); font-size: var(--text-xs); }
.password-control { display: flex; align-items: stretch; }
.password-control .input { min-width: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; }
.password-toggle { flex: 0 0 auto; padding: 0 12px; border: 1px solid var(--color-border-strong); border-left: 0; border-radius: 0 var(--radius-md) var(--radius-md) 0; background: var(--color-surface-muted); color: var(--color-primary-700); font-size: var(--text-sm); font-weight: 650; }
.password-toggle:hover { background: var(--color-primary-50); }
.password-toggle:focus-visible { position: relative; z-index: 1; outline: none; box-shadow: var(--focus-ring); }
.form-error { margin: 0; padding: 10px 12px; border-left: 3px solid var(--color-danger-500); background: var(--color-danger-50); color: var(--color-danger-700); font-size: var(--text-sm); }
.back-link { display: inline-block; margin-top: 20px; color: var(--color-text-muted); font-size: var(--text-sm); }
.back-link:hover { color: var(--color-primary); }
.checking-state { display: flex; align-items: center; gap: 10px; padding: 18px 0; color: var(--color-text-secondary); }
.checking-mark { display: inline-grid; width: 24px; height: 24px; place-items: center; border: 1px solid var(--color-border); border-radius: 50%; color: var(--color-primary); animation: turn 1.2s linear infinite; }
.invalid-state { display: grid; justify-items: start; gap: 12px; margin-top: 22px; }
.invalid-state p { margin: 0; color: var(--color-danger-700); line-height: 1.55; }
.invalid-mark { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 50%; background: var(--color-danger-50); color: var(--color-danger-700); font-size: 20px; font-weight: 800; }
@keyframes turn { to { transform: rotate(360deg); } }
@media (max-width: 900px) {
  .reset-layout { grid-template-columns: 1fr; }
  .reset-layout .auth-brand, .auth-panel { padding: 32px 24px; }
  .auth-brand-copy h1 { font-size: 38px; }
}
@media (max-width: 480px) {
  .password-toggle { padding: 0 9px; }
  .reset-card { width: 100%; }
}
</style>
