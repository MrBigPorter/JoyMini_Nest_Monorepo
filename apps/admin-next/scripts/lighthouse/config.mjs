/**
 * Default admin frontend base URL.
 * 默认的 Admin 前端基准地址。
 */
export const DEFAULT_BASE_URL = 'https://admin.joyminis.com';

/**
 * API base URL used for the login request.
 * In this project the admin frontend is on Cloudflare (admin.joyminis.com)
 * while the backend lives at api.joyminis.com — they are separate origins.
 * Override with LIGHTHOUSE_API_BASE_URL env var when needed.
 *
 * 登录请求使用的 API 基准地址。
 * 本项目中 Admin 前端在 Cloudflare（admin.joyminis.com），
 * 后端在 api.joyminis.com，二者是不同源。
 * 需要时可通过环境变量 LIGHTHOUSE_API_BASE_URL 覆盖。
 */
export const DEFAULT_API_BASE_URL = 'https://api.joyminis.com';

/**
 * How many runs to execute per page. Final metrics use median.
 * 每个页面默认执行次数，最终指标取中位数。
 */
export const DEFAULT_RUNS_PER_PAGE = 3;

/**
 * Target pages for the acceptance audit.
 * 验收脚本的目标页面列表。
 */
export const PAGES = [
  { label: '/login', path: '/login' },
  { label: '/ (Dashboard)', path: '/' },
  { label: '/analytics', path: '/analytics' },
  { label: '/finance', path: '/finance' },
  { label: '/orders', path: '/orders' },
];

/**
 * Performance thresholds used by summary rating and strict mode.
 * 用于汇总评级与 strict 模式判定的性能阈值。
 */
export const THRESHOLDS = {
  /** LCP excellent threshold (ms) / LCP 优秀阈值（毫秒） */
  lcpExcellentMs: 500,
  /** LCP warning upper bound (ms) / LCP 待优化上限（毫秒） */
  lcpWarnMs: 1500,
  /** FCP threshold (ms) / FCP 阈值（毫秒） */
  fcpMs: 200,
  /** TBT threshold (ms) / TBT 阈值（毫秒） */
  tbtMs: 200,
  /** CLS threshold / CLS 阈值 */
  cls: 0.1,
};
