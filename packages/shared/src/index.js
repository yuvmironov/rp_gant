export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export { signSyncToken, verifySyncToken } from './sync-token.js';
export { calculateCriticalPath, countScheduleDays } from './critical-path.js';
