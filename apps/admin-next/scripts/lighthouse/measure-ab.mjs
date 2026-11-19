#!/usr/bin/env node
/**
 * Measure A/B LCP samples for admin-frontend-closure 6.2.
 *
 * Assumes both production servers are already running:
 *   candidate → http://localhost:4001
 *   baseline  → http://localhost:4002
 *
 * Why this is not a plain `lighthouse <url>` call:
 *   - The app's middleware accepts the `auth_token` cookie, but the client
 *     auth store also requires `localStorage.auth_token`; without it the
 *     hydrated page redirects to /login. Lighthouse's extraHeaders cannot set
 *     localStorage.
 *   - Each sample therefore gets a fresh Chrome. Before measuring we seed the
 *     cookie + localStorage, then clear the HTTP cache so LCP is still a
 *     cold-cache first screen.
 *
 * Runs are interleaved (A,B per page, order flips each round).
 *
 * Usage:
 *   AB_TOKEN=<jwt> node scripts/lighthouse/measure-ab.mjs \
 *     --out reports/performance-ab/<run-id> \
 *     [--rounds 5] [--runs 3] [--pages /,/users/,/orders/,/finance/]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'chrome-launcher';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const lighthouseModule = require('lighthouse');
const lighthouse = lighthouseModule.default ?? lighthouseModule;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const chromePath =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const token = process.env.AB_TOKEN;
if (!token) {
  console.error('AB_TOKEN is required');
  process.exit(1);
}

const outRoot = resolve(
  appRoot,
  arg('out', `reports/performance-ab/${new Date().toISOString().replace(/[:.]/g, '-')}`),
);
const rounds = Number(arg('rounds', '5'));
const runsPerPage = Number(arg('runs', '3'));
const pages = arg('pages', '/,/users/,/orders/,/finance/')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const BUILDS = {
  baseline: 'http://localhost:4002',
  candidate: 'http://localhost:4001',
};

const slug = (path) => (path === '/' ? 'dashboard' : path.replaceAll('/', ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function warm(url) {
  const r = await fetch(url, {
    headers: { cookie: `auth_token=${token}` },
    redirect: 'follow',
  });
  if (r.status !== 200) throw new Error(`warmup ${url} -> ${r.status}`);
  await r.text();
}

/**
 * One Lighthouse sample with a fresh Chrome profile.
 * Returns the parsed LHR.
 */
async function measureOnce(base, targetPath, outputBase) {
  const chrome = await launch({
    chromePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${chrome.port}`);
    const context = browser.contexts()[0];
    await context.addCookies([
      { name: 'auth_token', value: token, domain: 'localhost', path: '/' },
    ]);

    const seed = await context.newPage();
    await seed.goto(new URL('/login/', `${base}/`).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await seed.evaluate((t) => localStorage.setItem('auth_token', t), token);

    // Cold-cache first screen: drop HTTP cache, keep storage (auth).
    const cdp = await context.newCDPSession(seed);
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    await seed.close();

    const result = await lighthouse(
      new URL(targetPath, `${base}/`).toString(),
      {
        port: chrome.port,
        output: ['json', 'html'],
        onlyCategories: ['performance'],
        formFactor: 'desktop',
        throttlingMethod: 'provided',
        disableStorageReset: true,
        screenEmulation: {
          mobile: false,
          width: 1365,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
        logLevel: 'error',
      },
    );

    if (!result?.lhr) throw new Error('Lighthouse returned no LHR');
    const reports = Array.isArray(result.report)
      ? result.report
      : [result.report];
    writeFileSync(`${outputBase}.report.json`, reports[0]);
    if (reports[1]) writeFileSync(`${outputBase}.report.html`, reports[1]);

    return result.lhr;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // CDP connection may already be gone
      }
    }
    try {
      await chrome.kill();
    } catch {
      // chrome may have exited with the last tab
    }
  }
}

async function measure(label, path, round, run) {
  const dir = join(
    outRoot,
    label,
    `session-${String(round).padStart(2, '0')}`,
    slug(path),
  );
  mkdirSync(dir, { recursive: true });
  const base = BUILDS[label];
  await warm(new URL(path, `${base}/`).toString());
  const lhr = await measureOnce(base, path, join(dir, `run-${run}`));
  console.log(
    `  ${label} ${path} round=${round} run=${run} LCP=${Math.round(
      lhr.audits['largest-contentful-paint'].numericValue,
    )}ms url=${lhr.finalDisplayedUrl}`,
  );
  if (new URL(lhr.finalDisplayedUrl).pathname.includes('/login')) {
    throw new Error(`sample redirected to login: ${label} ${path}`);
  }
}

async function main() {
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(
    join(outRoot, 'meta.json'),
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        rounds,
        runsPerPage,
        pages,
        builds: BUILDS,
        lighthouse: require('lighthouse/package.json').version,
        chrome: `${process.env.CHROME_PATH ?? chromePath}`,
        node: process.version,
      },
      null,
      2,
    )}\n`,
  );

  for (let round = 1; round <= rounds; round += 1) {
    const order =
      round % 2 === 1 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    console.log(`\n== round ${round} (${order.join(' → ')}) ==`);
    for (const path of pages) {
      for (const label of order) {
        for (let run = 1; run <= runsPerPage; run += 1) {
          try {
            await measure(label, path, round, run);
          } catch (err) {
            console.error(
              `FAILED ${label} ${path} round=${round} run=${run}: ${err.message}`,
            );
            throw err;
          }
          await sleep(2000);
        }
      }
    }
  }

  console.log(`\nSamples written under ${outRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
