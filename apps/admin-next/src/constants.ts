// Lightweight constants file. Translation payloads are centralized under `src/i18n`.
import type { Locale } from '@lucky/shared';
import * as I18n from '@/i18n';

// Re-export the centralized translations so existing imports (`@/constants`) keep working
// during the ongoing migration. Keep this file minimal to avoid duplication.
export const TRANSLATIONS: Record<Locale, Record<string, string>> =
  (I18n as any).TRANSLATIONS || {};

export const BLOG_TRANSLATION_CARD_TRANSLATIONS: Record<
  Locale,
  Record<string, string>
> = (I18n as any).BLOG_TRANSLATION_CARD_TRANSLATIONS || {};

export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
  FINANCE: 'Finance',
};
