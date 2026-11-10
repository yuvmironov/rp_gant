<script setup>
const tab = ref('login');
const email = ref('');
const password = ref('');
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

const resetToken = ref('');
const newPassword = ref('');
const showReset = ref(false);

function friendlyError(message) {
  return String(message).includes('session_limit_reached')
    ? 'Достигнут лимит двух активных сессий'
    : message;
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
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? response.statusText);
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
      body: { email: email.value, password: password.value },
    });
    await finishLogin();
  } catch (reason) {
    error.value = friendlyError(reason.message);
  }
}

async function submitRegister() {
  error.value = '';
  try {
    await api('/auth/register', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
        lastName: lastName.value,
        firstName: firstName.value,
        displayName: `${lastName.value} ${firstName.value}`.trim(),
      },
    });
    await api('/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    });
    await finishLogin();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function requestReset() {
  error.value = '';
  message.value = '';
  try {
    await api('/auth/password/forgot', { method: 'POST', body: { email: email.value } });
    showReset.value = true;
    message.value = 'Если адрес зарегистрирован, инструкция по сбросу пароля будет отправлена на него.';
  } catch (reason) {
    error.value = reason.message;
  }
}

async function resetPassword() {
  error.value = '';
  try {
    await api('/auth/password/reset', {
      method: 'POST',
      body: { token: resetToken.value, newPassword: newPassword.value },
    });
    showReset.value = false;
    message.value = 'Пароль сброшен. Войдите с новым паролем.';
  } catch (reason) {
    error.value = reason.message;
  }
}

async function resendVerification() {
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
      await api('/auth/email/verify', { method: 'POST', body: { token: verify } });
      message.value = 'Email подтверждён. Войдите.';
    } catch (reason) {
      error.value = reason.message;
    }
  }
  if (reset) {
    resetToken.value = reset;
    showReset.value = true;
  }
  if (verify || reset || invitation) window.history.replaceState({}, '', '/login');
  try {
    await api('/auth/session');
    window.location.href = '/projects';
  } catch {
    // Stay on the login page.
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
            <input id="login-password" v-model="password" class="input" name="password" type="password" autocomplete="current-password" required />
          </div>
          <div class="auth-row">
            <label class="checkbox-line"><input type="checkbox" checked /> Запомнить меня</label>
            <button class="link-button" type="button" @click="requestReset">Забыли пароль?</button>
          </div>
          <button class="btn btn-primary btn-lg btn-block auth-submit" type="submit">Войти</button>
          <button class="link-button centered" type="button" @click="resendVerification">Отправить письмо для подтверждения email</button>
        </form>

        <form v-else id="register-form" class="form-stack" @submit.prevent="submitRegister">
          <div class="field">
            <label>Email</label>
            <input v-model="email" class="input" name="email" type="email" required />
          </div>
          <div class="field-row">
            <div class="field"><label>Фамилия</label><input v-model="lastName" class="input" name="lastName" required /></div>
            <div class="field"><label>Имя</label><input v-model="firstName" class="input" name="firstName" required /></div>
          </div>
          <div class="field">
            <label>Пароль</label>
            <input v-model="password" class="input" name="password" type="password" minlength="8" required />
          </div>
          <button class="btn btn-primary btn-lg btn-block auth-submit" type="submit">Создать аккаунт</button>
        </form>

        <form v-if="showReset" class="form-stack reset-form" @submit.prevent="resetPassword">
          <div class="field"><label>Токен</label><input v-model="resetToken" class="input" required /></div>
          <div class="field"><label>Новый пароль</label><input v-model="newPassword" class="input" type="password" minlength="8" required /></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Обновить пароль</button>
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
.reset-form { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--color-border); }
.check:before { content: none; }
.auth-point .check { color: #fff; font-weight: 700; }
.message, .error { margin-top: 16px; }
@media (max-width: 900px) {
  .auth-layout { grid-template-columns: 1fr; }
  .auth-layout .auth-brand, .auth-panel { padding: 32px 24px; }
  .auth-brand-copy h1 { font-size: 38px; }
}
</style>
