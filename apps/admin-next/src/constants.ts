// Lightweight constants file.
// Translation payloads are now handled by next-intl (see src/i18n/request.ts).

/**
 * Map a Role enum value to its corresponding i18n translation key under `adminUsers.*`.
 *
 * Example:
 *   getRoleI18nKey('SUPER_ADMIN') → 'adminUsers.roleSuperAdmin'
 *   getRoleI18nKey('ADMIN')      → 'adminUsers.roleAdmin'
 */
export function getRoleI18nKey(role: string): string {
  // SUPER_ADMIN → super_admin → superAdmin
  const camelCase = role
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return `adminUsers.role${camelCase.charAt(0).toUpperCase()}${camelCase.slice(1)}`;
}
