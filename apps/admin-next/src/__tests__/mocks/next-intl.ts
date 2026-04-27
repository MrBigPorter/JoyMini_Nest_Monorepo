/**
 * Mock for next-intl used in Vitest (jsdom environment).
 * Provides useTranslations and useLocale so that components using
 * useTranslation() don't fail with "NextIntlClientProvider was not found".
 *
 * The mockT function returns human-readable text for translation keys.
 * It uses a comprehensive key-to-text mapping for all keys used in tests,
 * and falls back to keyToReadable() for any unmapped keys.
 *
 * Examples:
 *   t('common.username')        → 'Username'
 *   t('common.signIn')          → 'Sign In'
 *   t('common.password')        → 'Password'
 *   t('common.articleCount', { count: 5 }) → '5'
 */
import { vi } from 'vitest';

/**
 * Convert a camelCase/PascalCase key segment to human-readable text.
 * e.g. 'signIn' → 'Sign In', 'username' → 'Username', 'articleCount' → 'Article Count'
 */
function keyToReadable(key: string): string {
  if (!key) return '';
  // Insert space before uppercase letters (camelCase → Camel Case)
  const withSpaces = key.replace(/([A-Z])/g, ' $1');
  // Capitalize first letter and trim
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).trim();
}

/**
 * Comprehensive mapping of translation keys to expected text values.
 * This ensures tests get the exact text they expect.
 */
const TRANSLATION_MAP: Record<string, string> = {
  // Login
  'login.usernamePlaceholder': 'Username',
  'login.passwordPlaceholder': 'Password',
  'login.signIn': 'Sign In',
  'login.applyAccess': 'Apply for access',
  'login.title': 'Sign In',
  'login.subtitle': 'Welcome back',
  'login.noAccount': "Don't have an account?",
  'login.usernameRequired': 'Username is required',
  'login.passwordMinLength': 'At least 6 characters',
  'login.welcomeBack': 'Welcome back!',
  'login.loginFailedNoToken': 'No access token returned',
  'login.loginFailedGeneric': 'Login failed',
  'login.copyright': '© {year} JoyMini Admin. All rights reserved.',
  'login.usernameLabel': 'Username',
  'login.passwordLabel': 'Password',
  'login.usernameTooLong': 'Username is too long',
  'login.passwordTooLong': 'Password is too long',

  // System Config
  'systemConfig.pageTitle': 'System Config',
  'systemConfig.pageDescription': 'Manage system configuration',
  'systemConfig.configCount': '{count} config item',
  'systemConfig.configCount_plural': '{count} config items',
  'systemConfig.emptyState': 'No config items found',
  'systemConfig.loading': 'Loading...',
  'systemConfig.tabGeneral': 'General',
  'systemConfig.tabLocales': 'Locales',
  'systemConfig.tabTranslation': 'Translation',
  'systemConfig.keyboardHint': 'Press {enterKey} to save, {escKey} to cancel',

  // Finance
  'finance.tabs.transactions': 'Transactions Flow',
  'finance.tabs.deposits': 'Deposit Records',
  'finance.tabs.withdrawals': 'Withdrawal Audits',

  // Ads
  'ads.pageTitle': 'Advertisements',
  'ads.pageDescription': 'Manage advertisements',
  'ads.newAd': '+ New Ad',
  'ads.allStatus': 'All Status',
  'ads.enabled': 'Enabled',
  'ads.disabled': 'Disabled',
  'ads.allPositions': 'All Positions',
  'ads.noAds': 'No ads found',

  // Login Logs
  'loginLogs.pageTitle': 'Login Logs',
  'loginLogs.pageDescription': 'View login history',
  'loginLogs.userId': 'User ID',
  'loginLogs.userIdPlaceholder': 'User ID…',
  'loginLogs.ipAddress': 'IP Address',
  'loginLogs.ipAddressPlaceholder': 'IP…',
  'loginLogs.search': 'Search',
  'loginLogs.noLogsFound': 'No login logs found',
  'loginLogs.success': 'Success',
  'loginLogs.failed': 'Failed',
  'loginLogs.loading': 'Loading...',

  // Support Channels
  'supportChannels.pageTitle': 'Support Channels',
  'supportChannels.pageDescription': 'Manage support channels',
  'supportChannels.newChannel': '+ New Channel',
  'supportChannels.createChannel': 'Create Channel',
  'supportChannels.displayNamePlaceholder': 'Display name (English)',
  'supportChannels.customBusinessIdPlaceholder':
    'Custom businessId (e.g. my_support_v1)',
  'supportChannels.builtinBusinessId': 'Built-in Business ID',
  'supportChannels.customBusinessId': 'Custom Business ID',
  'supportChannels.pause': 'Pause',
  'supportChannels.resume': 'Resume',
  'supportChannels.searchPlaceholder': 'Search channels...',
  'supportChannels.validationRequired': 'Business ID and name are required',
  'supportChannels.created': 'Channel created successfully',
  'supportChannels.createFailed': 'Failed to create channel',
  'supportChannels.filterAll': 'All',
  'supportChannels.filterActive': 'Active',
  'supportChannels.filterPaused': 'Paused',
  'supportChannels.cancel': 'Cancel',
  'supportChannels.page': 'Page',

  // Operation Logs
  'operationLogs.pageTitle': 'Operation Logs',
  'operationLogs.pageDescription': 'View operation history',
  'operationLogs.auditTrail': 'Audit Trail',

  // Admin Users
  'adminUsers.pageTitle': 'Admin Users',
  'adminUsers.pageDescription': 'Manage admin users',

  // Lucky Draw
  'luckyDraw.pageTitle': 'Lucky Draw',
  'luckyDraw.pageDescription': 'Manage lucky draw activities',
  'luckyDraw.activitiesTab': 'Activities',
  'luckyDraw.resultsTab': 'Results',
  'luckyDraw.drawResults': 'Draw Results',
  'luckyDraw.createActivityFirst': 'Create an activity first to view results.',
  'luckyDraw.noResults': 'No draw results yet.',
  'luckyDraw.prizes': 'Prizes',
  'luckyDraw.addPrize': '+ Add Prize',
  'luckyDraw.loading': 'Loading...',
  'luckyDraw.noPrizes': 'No prizes yet',
  'luckyDraw.active': 'Active',
  'luckyDraw.inactive': 'Inactive',
  'luckyDraw.activityCount': '{count} activity',
  'luckyDraw.activityCount_plural': '{count} activities',

  // Categories (underscore-separated keys)
  categories_pageTitle: 'Categories',
  categories_pageDescription: 'Manage blog categories',
  categories_addCategory: 'Add Category',
  categories_createNew: 'Create New',
  categories_deleteTitle: 'Delete Category',
  categories_deleteContent: 'Are you sure you want to delete this category?',
  categories_confirm: 'Confirm',
  categories_cancel: 'Cancel',
};

// A simple key → value translator that returns human-readable text
const mockT = vi.fn((key: string, params?: Record<string, string | number>) => {
  if (!key) return '';

  // Handle ICU plural selection: if params.count is provided and a _plural variant exists,
  // use the plural form when count !== 1
  if (params && typeof params.count === 'number' && params.count !== 1) {
    const pluralKey = `${key}_plural`;
    if (pluralKey in TRANSLATION_MAP) {
      let result = TRANSLATION_MAP[pluralKey];
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v));
      }
      return result;
    }
  }

  // Check explicit mapping first
  if (key in TRANSLATION_MAP) {
    let result = TRANSLATION_MAP[key];
    // Apply parameter interpolation
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v));
      }
    }
    return result;
  }

  // If params exist, try simple interpolation on the key itself
  if (params) {
    let result = key;
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(`{${k}}`, String(v));
    }
    return result;
  }

  // Fallback: take the last segment after the last dot or underscore
  const lastSegment = key.includes('.')
    ? key.split('.').pop()!
    : key.includes('_')
      ? key.split('_').pop()!
      : key;
  return keyToReadable(lastSegment);
});

// Add raw() support for useTranslation's safety check
(mockT as any).raw = vi.fn((key: string) => {
  // Return the key as a string so the safety check in useTranslation passes
  return key;
});

export const useTranslations = vi.fn(() => mockT);

export const useLocale = vi.fn(() => 'en');

export const NextIntlClientProvider = ({
  children,
}: {
  children: React.ReactNode;
  locale?: string;
  messages?: Record<string, unknown>;
}) => children;
