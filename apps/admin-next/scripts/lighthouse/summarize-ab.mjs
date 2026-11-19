#!/usr/bin/env node
/**
 * Analyse A/B Lighthouse samples produced by measure-ab.mjs.
 *
 * Usage:
 *   node scripts/lighthouse/summarize-ab.mjs --dir reports/performance-ab/<run-id>
 *
 * Pass rules (per changed page):
 *   1. median Δ ≤ max(100ms, 10%)
 *   2. bootstrap 95% CI upper bound of Δ ≤ max(150ms, 15%)
 *   3. candidate median LCP < 1500ms
 *
 * Exits 1 if any changed page fails or sample counts are insufficient.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

const args = process.argv.slice(2);
const i = args.indexOf('--dir');
if (i < 0 || !args[i + 1]) {
  console.error('usage: summarize-ab.mjs --dir <reports/performance-ab/run-id>');
  process.exit(1);
}
const root = resolve(appRoot, args[i + 1]);
const CHANGED_PAGES = new Set(['users', 'orders', 'finance']);
const MIN_SAMPLES = 9;

const BUILDS = ['baseline', 'candidate'];
const METRICS = {
  lcpMs: (l) => l.audits['largest-contentful-paint'].numericValue,
  fcpMs: (l) => l.audits['first-contentful-paint'].numericValue,
  tbtMs: (l) => l.audits['total-blocking-time'].numericValue,
  cls: (l) => l.audits['cumulative-layout-shift'].numericValue,
  score: (l) => l.categories.performance.score * 100,
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapDeltaCI(a, b, n = 10000, seed = 42) {
  const rand = mulberry32(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const deltas = [];
  for (let k = 0; k < n; k += 1) {
    const sa = Array.from({ length: a.length }, () => pick(a));
    const sb = Array.from({ length: b.length }, () => pick(b));
    deltas.push(median(sb) - median(sa));
  }
  deltas.sort((x, y) => x - y);
  return [
    Math.round(deltas[Math.floor(0.025 * n)]),
    Math.round(deltas[Math.floor(0.975 * n)]),
  ];
}

function loadSamples() {
  const samples = {};
  for (const build of BUILDS) {
    const buildDir = join(root, build);
    let sessions = [];
    try {
      sessions = readdirSync(buildDir).filter((d) => d.startsWith('session-'));
    } catch {
      continue;
    }
    for (const session of sessions) {
      for (const slug of readdirSync(join(buildDir, session))) {
        const pageDir = join(buildDir, session, slug);
        const files = readdirSync(pageDir).filter((f) =>
          f.endsWith('.report.json'),
        );
        for (const file of files) {
          const lhr = JSON.parse(readFileSync(join(pageDir, file), 'utf8'));
          if (lhr.runtimeError) continue;
          const finalPath = new URL(lhr.finalDisplayedUrl).pathname;
          const expected = slug === 'dashboard' ? '/' : `/${slug}/`;
          if (finalPath !== expected && finalPath !== expected.replace(/\/$/, '')) {
            continue;
          }
          samples[build] ??= {};
          samples[build][slug] ??= [];
          samples[build][slug].push({
            file: join(buildDir, session, slug, file),
            lcpElement:
              lhr.audits['largest-contentful-paint-element']?.details?.items?.[0]
                ?.node?.snippet ?? 'n/a',
            ...Object.fromEntries(
              Object.entries(METRICS).map(([k, fn]) => [k, fn(lhr)]),
            ),
          });
        }
      }
    }
  }
  return samples;
}

const samples = loadSamples();
const slugs = [...new Set(BUILDS.flatMap((b) => Object.keys(samples[b] ?? {})))].sort();

const rows = [];
let failures = 0;
for (const slug of slugs) {
  const a = samples.baseline?.[slug] ?? [];
  const b = samples.candidate?.[slug] ?? [];
  const lcpA = a.map((s) => s.lcpMs);
  const lcpB = b.map((s) => s.lcpMs);
  const nA = lcpA.length;
  const nB = lcpB.length;

  if (nA < MIN_SAMPLES || nB < MIN_SAMPLES) {
    rows.push({ slug, verdict: 'INSUFFICIENT', nA, nB });
    if (CHANGED_PAGES.has(slug)) failures += 1;
    continue;
  }

  const medA = median(lcpA);
  const medB = median(lcpB);
  const delta = medB - medA;
  const pct = delta / medA;
  const ci = bootstrapDeltaCI(lcpA, lcpB);

  const pass =
    delta <= Math.max(100, medA * 0.1) &&
    ci[1] <= Math.max(150, medA * 0.15) &&
    medB < 1500;

  rows.push({
    slug,
    nA,
    nB,
    medA: Math.round(medA),
    iqrA: [Math.round(quantile(lcpA, 0.25)), Math.round(quantile(lcpA, 0.75))],
    medB: Math.round(medB),
    iqrB: [Math.round(quantile(lcpB, 0.25)), Math.round(quantile(lcpB, 0.75))],
    delta: Math.round(delta),
    pct: Number((pct * 100).toFixed(1)),
    ci,
    verdict: pass ? 'PASS' : 'FAIL',
    secondary: Object.fromEntries(
      ['fcpMs', 'tbtMs', 'cls', 'score'].map((k) => [
        k,
        Number((median(b.map((s) => s[k])) - median(a.map((s) => s[k]))).toFixed(3)),
      ]),
    ),
    lcpElementA: a[0]?.lcpElement ?? 'n/a',
    lcpElementB: b[0]?.lcpElement ?? 'n/a',
  });

  if (CHANGED_PAGES.has(slug) && !pass) failures += 1;
}

const result = {
  generatedAt: new Date().toISOString(),
  root,
  minSamples: MIN_SAMPLES,
  changedPages: [...CHANGED_PAGES],
  rows,
};

writeFileSync(join(root, 'comparison.json'), `${JSON.stringify(result, null, 2)}\n`);

const md = [
  '# A/B LCP comparison',
  '',
  `- samples: \`${root}\``,
  `- rule: median Δ ≤ max(100ms, 10%), CI95 upper ≤ max(150ms, 15%), candidate median < 1500ms`,
  '',
  '| Page | n(A/B) | baseline LCP | baseline IQR | candidate LCP | candidate IQR | Δ ms | Δ % | Δ 95% CI | Verdict |',
  '|---|---:|---:|---|---:|---|---:|---:|---|---|',
  ...rows.map((r) =>
    r.verdict === 'INSUFFICIENT'
      ? `| /${r.slug} | ${r.nA}/${r.nB} | - | - | - | - | - | - | - | INSUFFICIENT |`
      : `| ${r.slug === 'dashboard' ? '/' : `/${r.slug}/`} | ${r.nA}/${r.nB} | ${r.medA} | ${r.iqrA.join('–')} | ${r.medB} | ${r.iqrB.join('–')} | ${r.delta >= 0 ? '+' : ''}${r.delta} | ${r.pct >= 0 ? '+' : ''}${r.pct}% | ${r.ci[0]} … ${r.ci[1]} | ${r.verdict} |`,
  ),
  '',
  '## Secondary (median Δ)',
  '',
  '| Page | FCP Δ ms | TBT Δ ms | CLS Δ | Score Δ | LCP element A → B |',
  '|---|---:|---:|---:|---:|---|',
  ...rows
    .filter((r) => r.verdict !== 'INSUFFICIENT')
    .map(
      (r) =>
        `| ${r.slug} | ${r.secondary.fcpMs} | ${r.secondary.tbtMs} | ${r.secondary.cls} | ${r.secondary.score} | ${String(r.lcpElementA).slice(0, 60)} → ${String(r.lcpElementB).slice(0, 60)} |`,
    ),
  '',
  `Conclusion: ${failures === 0 ? 'PASS' : `FAIL (${failures} changed page(s))`}`,
  '',
].join('\n');

writeFileSync(join(root, 'comparison.md'), md);
console.log(md);

process.exitCode = failures === 0 ? 0 : 1;
