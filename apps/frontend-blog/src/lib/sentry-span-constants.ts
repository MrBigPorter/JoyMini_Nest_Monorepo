// Centralized Sentry span names/attribute keys to avoid magic strings across pages.
export const SENTRY_SPAN_NAME = {
  DASHBOARD_STATS_FETCH: 'admin.ssr.fetch.dashboard_stats',
  SERVER_FETCH_REQUEST: 'admin.ssr.fetch.server_request',
  HTTP_CLIENT_REQUEST: 'admin.http.client.request',
  SUPPORT_CHANNEL_CREATE: 'admin.ui.action.support_channel_create',
} as const;

export const SENTRY_SPAN_OP = {
  HTTP_SERVER: 'http.server',
  HTTP_CLIENT: 'http.client',
  UI_ACTION: 'ui.action',
} as const;

export const SENTRY_SPAN_ATTR_KEY = {
  APP_SECTION: 'app.section',
  HTTP_METHOD: 'http.method',
  HTTP_ROUTE: 'http.route',
  FETCH_REVALIDATE: 'fetch.revalidate',
  SUPPORT_BUSINESS_ID_MODE: 'support.business_id_mode',
  SUPPORT_BUSINESS_ID: 'support.business_id',
} as const;
