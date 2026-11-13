-- User & Access DB seed: system settings; keep administrator changes on subsequent bootstraps.

INSERT INTO settings.system_settings (key, value, description) VALUES
  ('password_min_length', '8'::jsonb, 'Минимальная длина пароля'),
  ('password_max_length', '128'::jsonb, 'Максимальная длина пароля'),
  ('password_require_complexity', 'false'::jsonb, 'Требовать обязательные спецсимволы'),
  ('max_failed_attempts', '5'::jsonb, 'Неудачных попыток до блокировки'),
  ('first_lockout_minutes', '10'::jsonb, 'Первая блокировка, минут'),
  ('second_lockout_minutes', '60'::jsonb, 'Вторая блокировка, минут'),
  ('third_lockout_permanent', 'true'::jsonb, 'Третья блокировка постоянная'),
  ('session_absolute_minutes', '60'::jsonb, 'Абсолютный срок обычной сессии'),
  ('session_idle_minutes', '10'::jsonb, 'Idle-срок обычной сессии'),
  ('max_sessions', '2'::jsonb, 'Максимум слотов сессий'),
  ('remember_me_absolute_days', '30'::jsonb, 'Абсолютный срок remember-токена'),
  ('remember_me_idle_days', '7'::jsonb, 'Idle-срок remember-токена'),
  ('email_verification_hours', '24'::jsonb, 'Срок токена подтверждения email'),
  ('password_reset_hours', '1'::jsonb, 'Срок токена сброса пароля'),
  ('invitation_days', '7'::jsonb, 'Срок приглашения'),
  ('telegram_link_code_minutes', '10'::jsonb, 'Срок кода привязки Telegram')
ON CONFLICT (key) DO NOTHING;
