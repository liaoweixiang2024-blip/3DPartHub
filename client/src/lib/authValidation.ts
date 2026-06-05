import type { TFunction } from 'i18next';
import type { SystemSettings } from '../api/settings';

export const USERNAME_PATTERN = /^[\p{L}\p{N}_\-.]+$/u;

export function getUsernamePolicy(settings?: Partial<SystemSettings> | null) {
  const min = Math.max(1, Math.floor(Number(settings?.security_username_min_length) || 2));
  const max = Math.max(min, Math.floor(Number(settings?.security_username_max_length) || 32));
  return { min, max };
}

export function validateRegisterUsername(
  username: string,
  settings: Partial<SystemSettings> | null | undefined,
  t: TFunction,
) {
  const { min, max } = getUsernamePolicy(settings);
  if (!username) return t('auth.errors.usernameRequired');
  if (username.length < min || username.length > max) {
    return t('auth.errors.usernameLength', { min, max });
  }
  if (!USERNAME_PATTERN.test(username)) {
    return t('auth.errors.usernamePattern');
  }
  return '';
}
