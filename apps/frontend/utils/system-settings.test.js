import { describe, expect, it } from 'vitest';
import {
  changedSystemSettingItems,
  settingsDraftFromItems,
  validateSystemSettings,
} from './system-settings.js';

const settings = [
  { key: 'password_min_length', value: { value: 8 }, description: 'Minimum length' },
  { key: 'password_max_length', value: { value: 128 }, description: 'Maximum length' },
  { key: 'password_require_complexity', value: { value: false }, description: 'Complexity' },
  { key: 'max_failed_attempts', value: { value: 5 }, description: 'Attempts' },
  { key: 'first_lockout_minutes', value: { value: 10 }, description: 'First lockout' },
  { key: 'second_lockout_minutes', value: { value: 60 }, description: 'Second lockout' },
  { key: 'third_lockout_permanent', value: { value: true }, description: 'Permanent lockout' },
  { key: 'session_absolute_minutes', value: { value: 60 }, description: 'Absolute session' },
  { key: 'session_idle_minutes', value: { value: 10 }, description: 'Idle session' },
  { key: 'max_sessions', value: { value: 2 }, description: 'Session limit' },
  { key: 'remember_me_absolute_days', value: { value: 30 }, description: 'Remember absolute' },
  { key: 'remember_me_idle_days', value: { value: 7 }, description: 'Remember idle' },
  { key: 'email_verification_hours', value: { value: 24 }, description: 'Email verification' },
  { key: 'password_reset_hours', value: { value: 1 }, description: 'Password reset' },
  { key: 'invitation_days', value: { value: 7 }, description: 'Invitation' },
  { key: 'telegram_link_code_minutes', value: { value: 10 }, description: 'Telegram code' },
  { key: 'future_setting', value: { value: 'keep' }, description: 'Future key' },
];

describe('system settings editor model', () => {
  it('unwraps protobuf scalar values into typed form values', () => {
    const draft = settingsDraftFromItems(settings);

    expect(draft.password_min_length).toBe(8);
    expect(draft.password_require_complexity).toBe(false);
    expect(draft.third_lockout_permanent).toBe(true);
    expect(validateSystemSettings(draft)).toEqual({});
  });

  it('reports bounds and cross-field validation errors', () => {
    const draft = settingsDraftFromItems(settings);
    draft.password_min_length = 200;
    draft.password_max_length = 100;
    draft.session_idle_minutes = 90;
    draft.session_absolute_minutes = 60;

    expect(validateSystemSettings(draft)).toMatchObject({
      password_min_length: expect.any(String),
      password_max_length: expect.any(String),
      session_idle_minutes: expect.any(String),
    });
  });

  it('serializes only changed known settings and leaves unknown server keys alone', () => {
    const baseline = settingsDraftFromItems(settings);
    const next = { ...baseline, max_sessions: 4 };

    expect(changedSystemSettingItems(settings, next, baseline)).toEqual([
      {
        key: 'max_sessions',
        value: { value: 4 },
        description: 'Session limit',
      },
    ]);
  });
});
