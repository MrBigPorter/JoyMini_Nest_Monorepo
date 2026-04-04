/**
 * Lighthouse CI 配置文件 (CommonJS)
 *
 * NOTE:
 * - lhci CLI 对 --config 的 JS 配置最稳定的是 .js (CJS)
 * - .mjs 在部分版本会被当 JSON 解析，导致 "Unexpected token '/'"
 */

module.exports = {
  ci: {
    collect: {
      url: [
        'https://admin.joyminis.com/login',
        'https://admin.joyminis.com/',
        'https://admin.joyminis.com/analytics',
        'https://admin.joyminis.com/finance',
        'https://admin.joyminis.com/orders',
      ],
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        throttling: {
          rttMs: 0,
          throughputKbps: 0,
          cpuSlowdownMultiplier: 1,
        },
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
        formFactor: 'desktop',
        extraHeaders: {
          Cookie: process.env.LHCI_COOKIE || '',
        },
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
    assert: {
      assertions: {
        'largest-contentful-paint': [
          'warn',
          { maxNumericValue: 2500, aggregationMethod: 'optimistic' },
        ],
        'total-blocking-time': [
          'warn',
          { maxNumericValue: 200, aggregationMethod: 'optimistic' },
        ],
        'cumulative-layout-shift': [
          'error',
          { maxNumericValue: 0.1, aggregationMethod: 'optimistic' },
        ],
        'categories:performance': ['error', { minScore: 0.7 }],
      },
    },
  },
};
