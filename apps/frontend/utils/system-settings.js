export const SYSTEM_SETTING_GROUPS = [
  {
    id: 'password',
    number: '01',
    title: 'Парольная политика',
    description: 'Требования применяются при регистрации, смене и сбросе пароля.',
    fields: [
      {
        key: 'password_min_length',
        label: 'Минимальная длина пароля',
        type: 'number',
        min: 1,
        max: 1024,
        unit: 'символов',
        description: 'Нижняя граница для новых паролей.',
      },
      {
        key: 'password_max_length',
        label: 'Максимальная длина пароля',
        type: 'number',
        min: 1,
        max: 1024,
        unit: 'символов',
        description: 'Верхняя граница для новых паролей.',
      },
      {
        key: 'password_require_complexity',
        label: 'Требовать спецсимвол',
        type: 'boolean',
        description: 'В пароле должен быть хотя бы один символ, который не является буквой или цифрой.',
      },
    ],
  },
  {
    id: 'lockout',
    number: '02',
    title: 'Защита входа',
    description: 'Порог попыток и длительность последовательных блокировок.',
    fields: [
      {
        key: 'max_failed_attempts',
        label: 'Неудачных попыток до блокировки',
        type: 'number',
        min: 1,
        max: 100,
        unit: 'попыток',
        description: 'Счётчик сбрасывается после успешного входа.',
      },
      {
        key: 'first_lockout_minutes',
        label: 'Первая блокировка',
        type: 'number',
        min: 1,
        max: 10080,
        unit: 'минут',
        description: 'Время ожидания после первого достижения порога.',
      },
      {
        key: 'second_lockout_minutes',
        label: 'Последующие блокировки',
        type: 'number',
        min: 1,
        max: 10080,
        unit: 'минут',
        description: 'Используется со второй блокировки и для третьей, если постоянная блокировка выключена.',
      },
      {
        key: 'third_lockout_permanent',
        label: 'Постоянная блокировка после третьего нарушения',
        type: 'boolean',
        description: 'Если выключено, после третьего достижения порога применяется срок последующих блокировок.',
      },
    ],
  },
  {
    id: 'sessions',
    number: '03',
    title: 'Сессии и «Запомнить меня»',
    description: 'Абсолютный срок задаётся при создании сессии; новый срок бездействия применяется при следующем запросе.',
    fields: [
      {
        key: 'session_absolute_minutes',
        label: 'Абсолютный срок сессии',
        type: 'number',
        min: 1,
        max: 525600,
        unit: 'минут',
        description: 'Максимальное время жизни обычной сессии.',
      },
      {
        key: 'session_idle_minutes',
        label: 'Срок бездействия сессии',
        type: 'number',
        min: 1,
        max: 525600,
        unit: 'минут',
        description: 'Должен быть не больше абсолютного срока.',
      },
      {
        key: 'max_sessions',
        label: 'Одновременных сессий на пользователя',
        type: 'number',
        min: 1,
        max: 20,
        unit: 'сессий',
        description: 'Лимит применяется при создании новой сессии.',
      },
      {
        key: 'remember_me_absolute_days',
        label: 'Абсолютный срок «Запомнить меня»',
        type: 'number',
        min: 1,
        max: 3650,
        unit: 'дней',
      },
      {
        key: 'remember_me_idle_days',
        label: 'Срок бездействия «Запомнить меня»',
        type: 'number',
        min: 1,
        max: 3650,
        unit: 'дней',
        description: 'Должен быть не больше абсолютного срока.',
      },
    ],
  },
  {
    id: 'tokens',
    number: '04',
    title: 'Ссылки и коды подтверждения',
    description: 'Новые значения применяются к токенам и приглашениям, созданным после сохранения.',
    fields: [
      {
        key: 'email_verification_hours',
        label: 'Подтверждение email',
        type: 'number',
        min: 1,
        max: 720,
        unit: 'часов',
      },
      {
        key: 'password_reset_hours',
        label: 'Сброс пароля',
        type: 'number',
        min: 1,
        max: 168,
        unit: 'часов',
      },
      {
        key: 'invitation_days',
        label: 'Приглашение в проект',
        type: 'number',
        min: 1,
        max: 365,
        unit: 'дней',
      },
      {
        key: 'telegram_link_code_minutes',
        label: 'Код привязки Telegram',
        type: 'number',
        min: 1,
        max: 1440,
        unit: 'минут',
      },
    ],
  },
];

export const SYSTEM_SETTING_FIELDS = SYSTEM_SETTING_GROUPS.flatMap((group) => group.fields);
export const SYSTEM_SETTING_KEYS = new Set(SYSTEM_SETTING_FIELDS.map((field) => field.key));
export const SYSTEM_SETTING_DEFAULTS = {
  password_min_length: 8,
  password_max_length: 128,
  password_require_complexity: false,
  max_failed_attempts: 5,
  first_lockout_minutes: 10,
  second_lockout_minutes: 60,
  third_lockout_permanent: true,
  session_absolute_minutes: 60,
  session_idle_minutes: 10,
  max_sessions: 2,
  remember_me_absolute_days: 30,
  remember_me_idle_days: 7,
  email_verification_hours: 24,
  password_reset_hours: 1,
  invitation_days: 7,
  telegram_link_code_minutes: 10,
};

export function unwrapSystemSettingValue(value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, 'value')
  ) {
    return value.value;
  }
  return value;
}

export function settingsDraftFromItems(items) {
  const received = new Map((items ?? []).map((item) => [item.key, unwrapSystemSettingValue(item.value)]));
  return Object.fromEntries(
    SYSTEM_SETTING_FIELDS.map((field) => {
      const value = received.has(field.key)
        ? received.get(field.key)
        : SYSTEM_SETTING_DEFAULTS[field.key];
      return [
        field.key,
        field.type === 'boolean' ? Boolean(value) : Number(value),
      ];
    }),
  );
}

export function validateSystemSettings(draft) {
  const errors = {};
  for (const field of SYSTEM_SETTING_FIELDS) {
    const value = draft[field.key];
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') errors[field.key] = 'Выберите значение.';
      continue;
    }
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      errors[field.key] = `Укажите целое число от ${field.min} до ${field.max}.`;
    }
  }
  if (
    Number.isInteger(draft.password_min_length) &&
    Number.isInteger(draft.password_max_length) &&
    draft.password_min_length > draft.password_max_length
  ) {
    errors.password_min_length = 'Минимум не может быть больше максимума.';
    errors.password_max_length = 'Максимум должен быть не меньше минимума.';
  }
  if (
    Number.isInteger(draft.first_lockout_minutes) &&
    Number.isInteger(draft.second_lockout_minutes) &&
    draft.first_lockout_minutes > draft.second_lockout_minutes
  ) {
    errors.first_lockout_minutes = 'Первая блокировка должна быть короче последующих.';
    errors.second_lockout_minutes = 'Последующие блокировки должны быть не короче первой.';
  }
  if (
    Number.isInteger(draft.session_idle_minutes) &&
    Number.isInteger(draft.session_absolute_minutes) &&
    draft.session_idle_minutes > draft.session_absolute_minutes
  ) {
    errors.session_idle_minutes = 'Срок бездействия не может превышать абсолютный срок.';
  }
  if (
    Number.isInteger(draft.remember_me_idle_days) &&
    Number.isInteger(draft.remember_me_absolute_days) &&
    draft.remember_me_idle_days > draft.remember_me_absolute_days
  ) {
    errors.remember_me_idle_days = 'Срок бездействия не может превышать абсолютный срок.';
  }
  return errors;
}

export function changedSystemSettingItems(items, draft, baseline) {
  const itemByKey = new Map((items ?? []).map((item) => [item.key, item]));
  return SYSTEM_SETTING_FIELDS.filter((field) => !Object.is(draft[field.key], baseline[field.key])).map(
    (field) => {
      const existing = itemByKey.get(field.key);
      return {
        key: field.key,
        value: { value: draft[field.key] },
        description: existing?.description ?? field.description ?? field.label,
      };
    },
  );
}
