import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_BASE_URL,
  DEFAULT_RUNS_PER_PAGE,
  PAGES,
  THRESHOLDS,
} from './config.mjs';

/**
 * Script map (learning-oriented) / 学习导图：
 * 1) Read runtime config from env / 读取环境变量配置
 * 2) Resolve auth cookie (env cookie or login API) / 解析鉴权 Cookie
 * 3) Launch headless Chrome / 启动无头 Chrome
 * 4) Run Lighthouse for each target page (N runs) / 按页面执行 N 次采集
 * 5) Aggregate median metrics and write summary files / 用中位数汇总并写报告
 * 6) Exit with optional strict gate / strict 模式下做门禁退出
 */

const cwd = process.cwd();
const strictMode = process.argv.includes('--strict');
const baseUrl = normalizeBaseUrl(
  process.env.LIGHTHOUSE_BASE_URL || DEFAULT_BASE_URL,
);
/**
 * Separate origin for login API.
 * 登录 API 与前端可能是不同域名（不同源）。
 */
const apiBaseUrl = normalizeBaseUrl(
  process.env.LIGHTHOUSE_API_BASE_URL || DEFAULT_API_BASE_URL,
);
const runsPerPage = Number.parseInt(
  process.env.LIGHTHOUSE_RUNS_PER_PAGE || String(DEFAULT_RUNS_PER_PAGE),
  10,
);
const runTimeoutSeconds = Number.parseInt(
  process.env.LIGHTHOUSE_MAX_SECONDS_PER_RUN || '180',
  10,
);
const runTimeoutMs = runTimeoutSeconds * 1000;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = path.join(cwd, 'reports', 'lighthouse', timestamp);

const stopState = {
  requested: false,
  signal: null,
};

function normalizeBaseUrl(url) {
  // Keep URL join behavior stable / 保持 URL 拼接稳定，避免双斜杠
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function median(values) {
  // [重点] Use median to reduce outlier noise / 用中位数降低冷启动离群值影响
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function ratingByLcp(lcpMs) {
  // Human-friendly severity for reports / 报告中的人类可读评级
  if (lcpMs < THRESHOLDS.lcpExcellentMs) return 'excellent';
  if (lcpMs <= THRESHOLDS.lcpWarnMs) return 'warn';
  return 'critical';
}

function scorePass(metric) {
  // [重点] Strict mode requires ALL metrics pass / strict 模式要求所有指标都过阈值
  return (
    metric.lcpMs < THRESHOLDS.lcpExcellentMs &&
    metric.fcpMs < THRESHOLDS.fcpMs &&
    metric.tbtMs < THRESHOLDS.tbtMs &&
    metric.cls < THRESHOLDS.cls
  );
}

function extractMetrics(lhr) {
  // Extract only accepted metrics / 只提取本项目验收使用的核心指标
  const lcpElementAudit = lhr.audits['largest-contentful-paint-element'];
  const lcpElementSnippet =
    lcpElementAudit?.details?.items?.[0]?.node?.snippet || 'N/A';

  return {
    performanceScore: Math.round(
      (lhr.categories.performance?.score || 0) * 100,
    ),
    lcpMs: lhr.audits['largest-contentful-paint']?.numericValue || 0,
    fcpMs: lhr.audits['first-contentful-paint']?.numericValue || 0,
    tbtMs: lhr.audits['total-blocking-time']?.numericValue || 0,
    cls: lhr.audits['cumulative-layout-shift']?.numericValue || 0,
    lcpElement: lcpElementSnippet,
  };
}

function toCookieHeader(setCookieValues) {
  // Merge multiple Set-Cookie values / 合并多个 Set-Cookie 为单个 Cookie 请求头
  return setCookieValues
    .map((item) => item.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function getAuthCookieHeader() {
  // [重点] Priority 1: explicit env cookie / 最高优先级：直接使用环境变量传入 Cookie
  if (process.env.LIGHTHOUSE_COOKIE) {
    return process.env.LIGHTHOUSE_COOKIE;
  }

  const username =
    process.env.LIGHTHOUSE_ADMIN_USERNAME || process.env.E2E_ADMIN_USERNAME;
  const password =
    process.env.LIGHTHOUSE_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD;

  if (!username || !password) {
    // No credentials => anonymous mode / 无账号密码时退化为匿名模式（仅公开页）
    return null;
  }

  const loginPayload = process.env.LIGHTHOUSE_LOGIN_PAYLOAD_JSON
    ? JSON.parse(process.env.LIGHTHOUSE_LOGIN_PAYLOAD_JSON)
    : { username, password };

  const loginUrl = `${apiBaseUrl}/api/v1/auth/admin/login`;
  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: baseUrl,
      referer: `${baseUrl}/login`,
    },
    body: JSON.stringify(loginPayload),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Login failed (${response.status}) at ${loginUrl}: ${bodyText.slice(0, 300)}`,
    );
  }

  // [重点] 1) Prefer Set-Cookie from login response / 优先使用响应头下发的 Cookie
  const setCookieValues = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : response.headers.get('set-cookie')
      ? [response.headers.get('set-cookie')]
      : [];

  const cookieHeader = toCookieHeader(setCookieValues);
  if (cookieHeader) {
    return cookieHeader;
  }

  // [重点] 2) Fallback to accessToken in JSON and synthesize auth_token cookie
  //         兜底：从 JSON 里取 accessToken，组装 auth_token 供 middleware 做 SSR 鉴权
  const json = await response.json();
  const accessToken =
    json?.data?.tokens?.accessToken ||
    json?.data?.accessToken ||
    json?.accessToken;

  if (accessToken) {
    console.log('Auth mode: JSON token → auth_token cookie');
    return `auth_token=${accessToken}`;
  }

  throw new Error(
    'Login succeeded but no Set-Cookie header or accessToken found in response. ' +
      'Set LIGHTHOUSE_COOKIE manually.',
  );
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function withTimeout(promise, timeoutMs, description) {
  // [重点] Hard timeout guard / 为单次采集增加硬超时，防止长时间卡住
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${description} exceeded ${Math.round(timeoutMs / 1000)}s. ` +
            'You can lower LIGHTHOUSE_RUNS_PER_PAGE or set LIGHTHOUSE_MAX_SECONDS_PER_RUN.',
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function setupSignalHandlers() {
  // [重点] Two-stage stop strategy / 两段式停止策略
  // First Ctrl+C: graceful stop after current run / 第一次 Ctrl+C：优雅停止
  // Second Ctrl+C: immediate force exit / 第二次 Ctrl+C：立即强退
  const onStopSignal = (signal) => {
    if (!stopState.requested) {
      stopState.requested = true;
      stopState.signal = signal;
      console.warn(
        `\nReceived ${signal}. Graceful stop requested: finish current run, then write partial summary and exit.`,
      );
      return;
    }

    console.error(`\nReceived ${signal} again. Force exiting now.`);
    process.exit(130);
  };

  process.on('SIGINT', onStopSignal);
  process.on('SIGTERM', onStopSignal);

  return () => {
    process.off('SIGINT', onStopSignal);
    process.off('SIGTERM', onStopSignal);
  };
}

async function run() {
  // ---- Step 1 / 步骤1: Validate inputs / 校验输入参数 ----
  if (!Number.isFinite(runsPerPage) || runsPerPage <= 0) {
    throw new Error(
      `LIGHTHOUSE_RUNS_PER_PAGE must be a positive integer. Got: ${runsPerPage}`,
    );
  }
  if (!Number.isFinite(runTimeoutSeconds) || runTimeoutSeconds <= 0) {
    throw new Error(
      `LIGHTHOUSE_MAX_SECONDS_PER_RUN must be a positive integer. Got: ${runTimeoutSeconds}`,
    );
  }

  // ---- Step 2 / 步骤2: Prepare output folder / 准备输出目录 ----
  await ensureDir(outputRoot);

  // ---- Step 3 / 步骤3: Print runtime configuration / 打印运行配置 ----
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Runs per page: ${runsPerPage}`);
  console.log(`Timeout per run: ${runTimeoutSeconds}s`);
  console.log(`Output: ${outputRoot}`);
  console.log(
    'Stop hint: press Ctrl+C once for graceful stop, twice for force stop.',
  );

  const cleanupSignals = setupSignalHandlers();

  // ---- Step 4 / 步骤4: Resolve auth mode / 解析鉴权模式 ----
  const cookieHeader = await getAuthCookieHeader();
  console.log(
    cookieHeader
      ? `Auth mode: ${cookieHeader.startsWith('auth_token=') && !process.env.LIGHTHOUSE_COOKIE ? 'JSON token → auth_token cookie' : 'Cookie header (from env or login API)'}`
      : 'Auth mode: Anonymous (only public pages are measurable)',
  );

  const chrome = await launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  const pageSummaries = [];

  try {
    // ---- Step 5 / 步骤5: Iterate target pages / 逐页采集 ----
    for (const page of PAGES) {
      if (stopState.requested) {
        console.warn('Stop requested. Skip remaining pages.');
        break;
      }

      const targetUrl = new URL(page.path, `${baseUrl}/`).toString();
      const pageSlug = page.path === '/' ? 'dashboard' : page.path.slice(1);
      const pageDir = path.join(outputRoot, pageSlug);
      await ensureDir(pageDir);

      console.log(`\n== ${page.label} (${targetUrl}) ==`);

      const runs = [];

      for (let i = 1; i <= runsPerPage; i += 1) {
        if (stopState.requested) {
          console.warn(
            `  stop requested before run ${i}; keep completed runs only.`,
          );
          break;
        }

        // ---- Step 6 / 步骤6: Execute one run / 执行单次采集（含超时保护） ----
        const result = await withTimeout(
          lighthouse(targetUrl, {
            port: chrome.port,
            logLevel: 'error',
            output: ['json', 'html'],
            onlyCategories: ['performance'],
            formFactor: 'desktop',
            emulatedFormFactor: 'desktop',
            screenEmulation: {
              mobile: false,
              width: 1365,
              height: 940,
              deviceScaleFactor: 1,
              disabled: false,
            },
            throttlingMethod: 'provided',
            disableStorageReset: true,
            extraHeaders: cookieHeader ? { Cookie: cookieHeader } : undefined,
          }),
          runTimeoutMs,
          `Lighthouse run for ${targetUrl}`,
        );

        if (!result?.lhr || !result.report) {
          throw new Error(`Lighthouse returned empty result for ${targetUrl}`);
        }

        const reportArray = Array.isArray(result.report)
          ? result.report
          : [result.report];

        const [jsonReport, htmlReport] = reportArray;
        await fs.writeFile(path.join(pageDir, `run-${i}.json`), jsonReport);
        if (htmlReport) {
          await fs.writeFile(path.join(pageDir, `run-${i}.html`), htmlReport);
        }

        const metrics = extractMetrics(result.lhr);
        runs.push(metrics);

        console.log(
          `  run ${i}: LCP ${Math.round(metrics.lcpMs)}ms | FCP ${Math.round(metrics.fcpMs)}ms | TBT ${Math.round(metrics.tbtMs)}ms | CLS ${metrics.cls.toFixed(3)} | score ${metrics.performanceScore}`,
        );
      }

      // If no completed run, skip this page summary / 当前页无完成 run 时跳过汇总
      if (runs.length === 0) {
        continue;
      }

      // ---- Step 7 / 步骤7: Aggregate by median / 按中位数聚合 ----
      const medianMetrics = {
        lcpMs: median(runs.map((r) => r.lcpMs)),
        fcpMs: median(runs.map((r) => r.fcpMs)),
        tbtMs: median(runs.map((r) => r.tbtMs)),
        cls: median(runs.map((r) => r.cls)),
        performanceScore: Math.round(
          median(runs.map((r) => r.performanceScore)),
        ),
      };

      const summary = {
        page: page.label,
        path: page.path,
        url: targetUrl,
        rating: ratingByLcp(medianMetrics.lcpMs),
        pass: scorePass(medianMetrics),
        median: medianMetrics,
        lcpElement: runs[0]?.lcpElement || 'N/A',
      };

      pageSummaries.push(summary);
    }
  } finally {
    // [重点] Always kill Chrome / 无论成功失败都回收 Chrome，避免僵尸进程
    await chrome.kill();
    cleanupSignals();
  }

  // ---- Step 8 / 步骤8: Write machine-readable summary / 写 JSON 汇总 ----
  const summaryJson = {
    baseUrl,
    timestamp,
    runsPerPage,
    strictMode,
    thresholds: THRESHOLDS,
    pages: pageSummaries,
  };

  const summaryPath = path.join(outputRoot, 'summary.json');
  await fs.writeFile(summaryPath, `${JSON.stringify(summaryJson, null, 2)}\n`);

  // ---- Step 9 / 步骤9: Write human-readable markdown summary / 写 Markdown 汇总 ----
  const markdownLines = [
    `# Lighthouse Summary (${timestamp})`,
    '',
    `- Base URL: \`${baseUrl}\``,
    `- Runs per page: ${runsPerPage}`,
    `- Strict mode: ${strictMode ? 'ON' : 'OFF'}`,
    '',
    '| Page | LCP (ms) | FCP (ms) | TBT (ms) | CLS | Score | Rating | Pass |',
    '|---|---:|---:|---:|---:|---:|---|---|',
  ];

  for (const item of pageSummaries) {
    markdownLines.push(
      `| ${item.page} | ${Math.round(item.median.lcpMs)} | ${Math.round(item.median.fcpMs)} | ${Math.round(item.median.tbtMs)} | ${item.median.cls.toFixed(3)} | ${item.median.performanceScore} | ${item.rating} | ${item.pass ? 'YES' : 'NO'} |`,
    );
  }

  markdownLines.push('', '## LCP Elements', '');
  for (const item of pageSummaries) {
    markdownLines.push(`- ${item.page}: ${item.lcpElement}`);
  }

  const summaryMdPath = path.join(outputRoot, 'summary.md');
  await fs.writeFile(summaryMdPath, `${markdownLines.join('\n')}\n`);

  console.log(`\nSummary written:`);
  console.log(`- ${summaryPath}`);
  console.log(`- ${summaryMdPath}`);

  if (stopState.requested) {
    console.warn(
      `\nStopped by ${stopState.signal}. Partial summary saved for completed pages.`,
    );
    process.exitCode = 130;
  }

  // ---- Step 10 / 步骤10: Optional CI gate in strict mode / strict 门禁退出 ----
  const hasFailure = pageSummaries.some((item) => !item.pass);
  if (strictMode && hasFailure) {
    console.error(
      '\nStrict mode failed: at least one page exceeds thresholds.',
    );
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('\nLighthouse audit failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
