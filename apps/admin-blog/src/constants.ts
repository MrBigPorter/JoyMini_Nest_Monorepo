// Lightweight constants file.

/**
 * Map a Role enum value to its corresponding i18n translation key.
 *
 * Example:
 *   getRoleI18nKey('SUPER_ADMIN') → 'roleSuperAdmin'
 *   getRoleI18nKey('ADMIN')      → 'roleAdmin'
 */
export function getRoleI18nKey(role: string): string {
  // SUPER_ADMIN → super_admin → superAdmin
  const camelCase = role
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return `role${camelCase.charAt(0).toUpperCase()}${camelCase.slice(1)}`;
}
