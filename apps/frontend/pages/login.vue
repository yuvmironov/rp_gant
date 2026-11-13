<script setup>
const tab = ref('login');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const showLoginPassword = ref(false);
const showRegistrationPassword = ref(false);
const showConfirmPassword = ref(false);
const rememberMe = ref(true);
const lastName = ref('');
const firstName = ref('');
const error = ref('');
const message = ref('');
const toast = useToast();
watch(error, (value) => {
  if (value) toast.error(value);
});
watch(message, (value) => {
  if (value) toast.success(value);
});

function friendlyError(message) {
  if (String(message).includes('session_limit_reached')) return 'Достигнут лимит двух активных сессий';
  if (String(message).includes('email_not_verified')) {
    return 'Email не подтверждён. Проверьте почту или запросите письмо ещё раз.';
  }
  if (String(message).includes('invalid_token') || String(message).includes('token_required')) {
    return 'Ссылка подтверждения недействительна или истекла. Запросите новое письмо.';
  }
  return message;
}

function csrfToken() {
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('__Host-csrf='))
    ?.slice('__Host-csrf='.length);
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if ((options.method ?? 'GET') !== 'GET') headers['X-CSRF-Token'] = csrfToken() ?? '';
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const error = new Error(problem.detail ?? response.statusText);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function finishLogin() {
  const invitation = window.localStorage.getItem('pendingInvitation');
  if (invitation) {
    await api('/invitations/accept', { method: 'POST', body: { token: invitation } }).catch(
      () => {},
    );
    window.localStorage.removeItem('pendingInvitation');
  }
  window.location.href = '/projects';
}

async function submitLogin() {
  error.value = '';
  try {
    await api('/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value, rememberMe: rememberMe.value },
    });
    await finishLogin();
  } catch (reason) {
    error.value = friendlyError(reason.message);
  }
}

async function submitRegister() {
  error.value = '';
  message.value = '';
  if (password.value !== confirmPassword.value) {
    error.value = 'Пароли не совпадают.';
    return;
  }
  try {
    const result = await api('/auth/register', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
        lastName: lastName.value,
        firstName: firstName.value,
        displayName: `${lastName.value} ${firstName.value}`.trim(),
      },
    });
    if (result.requiresEmailVerification) {
      tab.value = 'login';
      confirmPassword.value = '';
      message.value = 'Аккаунт создан. Подтвердите email по ссылке из письма, чтобы войти.';
      return;
    }
    await api('/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    });
    await finishLogin();
  } catch (reason) {
    error.value = friendlyError(reason.message);
  }
}

async function requestReset() {
  error.value = '';
  message.value = '';
  if (!email.value.trim()) {
    error.value = 'Укажите email.';
    return;
  }
  try {
    await api('/auth/password/forgot', { method: 'POST', body: { email: email.value } });
    message.value = 'Если адрес зарегистрирован, инструкция по сбросу пароля будет отправлена на него.';
  } catch (reason) {
    error.value = reason.message;
  }
}

async function resendVerification() {
  error.value = '';
  message.value = '';
  if (!email.value.trim()) {
    error.value = 'Укажите email.';
    return;
  }
  try {
    await api('/auth/email/resend', { method: 'POST', body: { email: email.value } });
    message.value = 'Письмо отправлено, если регистрация не завершена.';
  } catch (reason) {
    error.value = reason.message;
  }
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const verify = params.get('verify');
  const reset = params.get('reset');
  const invitation = params.get('invitation');
  if (invitation) window.localStorage.setItem('pendingInvitation', invitation);
  if (verify) {
    try {
      const result = await api('/auth/email/verify', { method: 'POST', body: { token: verify } });
      if (result?.verified !== true) throw new Error('email_verification_failed');
      window.history.replaceState({}, '', '/login');
      await navigateTo('/email-confirmed', { replace: true });
    } catch (reason) {
      window.history.replaceState({}, '', '/login');
      error.value = friendlyError(reason.message);
    }
    return;
  }
  if (reset) {
    await navigateTo({ path: '/reset-password', query: { token: reset } }, { replace: true });
    return;
  }
  if (verify || invitation) window.history.replaceState({}, '', '/login');
  try {
    await api('/auth/session');
    await finishLogin();
    return;
  } catch (reason) {
    if (reason.status !== 401) return;
  }

  try {
    await api('/auth/restore', { method: 'POST' });
    await finishLogin();
  } catch {
    // No valid access or remember session; stay on the login page.
  }
});
</script>

<template>
  <main id="auth-view" class="auth-layout">
    <section class="auth-brand">
      <div class="brand-lockup">
        <span class="brand-mark">▥</span>
        <span>RP Gant</span>
      </div>
      <div class="auth-brand-copy">
        <p class="eyebrow" style="color:#93c5fd">Планирование без хаоса</p>
        <h1>Один план.<br />Одна команда.<br />Полная ясность.</h1>
        <p>Диаграмма Ганта, сроки и зависимости в одном рабочем пространстве с ролями, уведомлениями и аудитом.</p>
      </div>
      <div class="auth-points">
        <div class="auth-point"><span class="check">✓</span><span>Актуальный план для всей команды</span></div>
        <div class="auth-point"><span class="check">✓</span><span>Контроль сроков и критического пути</span></div>
        <div class="auth-point"><span class="check">✓</span><span>Безопасный доступ по ролям</span></div>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <p class="eyebrow">С возвращением</p>
        <h2>Войти в систему</h2>
        <p class="muted">Введите рабочий email и пароль, чтобы продолжить.</p>

        <div class="auth-tabs">
          <button id="login-tab" type="button" :class="{ active: tab === 'login' }" @click="tab = 'login'">Вход</button>
          <button id="register-tab" type="button" :class="{ active: tab === 'register' }" @click="tab = 'register'">Регистрация</button>
        </div>

        <form v-if="tab === 'login'" id="login-form" class="form-stack" @submit.prevent="submitLogin">
          <div class="field">
            <label for="login-email">Email</label>
            <input id="login-email" v-model="email" class="input" name="email" type="email" autocomplete="email" placeholder="name@company.ru" required />
          </div>
          <div class="field">
            <label for="login-password">Пароль</label>
            <div class="password-control">
              <input id="login-password" v-model="password" class="input" name="password" :type="showLoginPassword ? 'text' : 'password'" autocomplete="current-password" required />
              <button class="password-toggle" type="button" :aria-label="showLoginPassword ? 'Скрыть пароль' : 'Показать пароль'" @click="showLoginPassword = !showLoginPassword">{{ showLoginPassword ? 'Скрыть' : 'Показать' }}</button>
            </div>
          </div>
          <div class="auth-row">
            <label class="checkbox-line" for="remember-me">
              <input id="remember-me" v-model="rememberMe" name="rememberMe" type="checkbox" />
              Запомнить меня
            </label>
            <button class="link-button" type="button" @click="requestReset">Забыли пароль?</button>
          </div>
          <button class="btn btn-primary btn-lg btn-block auth-submit" type="submit">Войти</button>
          <button class="link-button centered" type="button" @click="resendVerification">Отправить письмо для подтверждения email</button>
        </form>

        <form v-else id="register-form" class="form-stack" @submit.prevent="submitRegister">
          <div class="field">
            <label for="register-email">Email</label>
            <input id="register-email" v-model="email" class="input" name="email" type="email" autocomplete="email" required />
          </div>
          <div class="field-row">
            <div class="field"><label>Фамилия</label><input v-model="lastName" class="input" name="lastName" required /></div>
            <div class="field"><label>Имя</label><input v-model="firstName" class="input" name="firstName" required /></div>
          </div>
          <div class="field">
            <label for="register-password">Пароль</label>
            <div class="password-control">
              <input id="register-password" v-model="password" class="input" name="password" :type="showRegistrationPassword ? 'text' : 'password'" minlength="8" maxlength="128" autocomplete="new-password" required />
              <button class="password-toggle" type="button" :aria-label="showRegistrationPassword ? 'Скрыть пароль' : 'Показать пароль'" @click="showRegistrationPassword = !showRegistrationPassword">{{ showRegistrationPassword ? 'Скрыть' : 'Показать' }}</button>
            </div>
            <span class="field-hint">Не менее 8 символов</span>
          </div>
          <div class="field">
            <label for="register-confirm-password">Подтверждение пароля</label>
            <div class="password-control">
              <input id="register-confirm-password" v-model="confirmPassword" class="input" name="confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" minlength="8" maxlength="128" autocomplete="new-password" required />
              <button class="password-toggle" type="button" :aria-label="showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'" @click="showConfirmPassword = !showConfirmPassword">{{ showConfirmPassword ? 'Скрыть' : 'Показать' }}</button>
            </div>
          </div>
          <button class="btn btn-primary btn-lg btn-block auth-submit" type="submit">Создать аккаунт</button>
        </form>

      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-layout { min-height: 100vh; }
.auth-layout .auth-brand { padding: 64px clamp(32px, 6vw, 96px); }
.auth-brand-copy h1 { margin: 18px 0 20px; }
.auth-brand-copy p { max-width: 560px; }
.brand-mark { display: inline-grid; place-items: center; }
.auth-panel { padding: 64px clamp(32px, 6vw, 96px); }
.auth-card { width: min(460px, 100%); }
.auth-tabs { display: inline-flex; gap: 4px; padding: 4px; margin: 22px 0 18px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); background: var(--color-surface-subtle); }
.auth-tabs button { border: 0; border-radius: var(--radius-pill); background: transparent; color: var(--color-text-muted); padding: 7px 14px; }
.auth-tabs button.active { background: var(--color-primary); color: #fff; }
.auth-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.link-button { border: 0; background: transparent; color: var(--color-primary); padding: 0; font-size: var(--text-sm); }
.link-button.centered { justify-self: center; }
.password-control { display: flex; align-items: stretch; }
.password-control .input { min-width: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; }
.password-toggle { flex: 0 0 auto; padding: 0 12px; border: 1px solid var(--color-border-strong); border-left: 0; border-radius: 0 var(--radius-md) var(--radius-md) 0; background: var(--color-surface-muted); color: var(--color-primary-700); font-size: var(--text-sm); font-weight: 650; }
.password-toggle:hover { background: var(--color-primary-50); }
.password-toggle:focus-visible { position: relative; z-index: 1; outline: none; box-shadow: var(--focus-ring); }
.check:before { content: none; }
.auth-point .check { color: #fff; font-weight: 700; }
.message, .error { margin-top: 16px; }
@media (max-width: 900px) {
  .auth-layout { grid-template-columns: 1fr; }
  .auth-layout .auth-brand, .auth-panel { padding: 32px 24px; }
  .auth-brand-copy h1 { font-size: 38px; }
}
</style>
