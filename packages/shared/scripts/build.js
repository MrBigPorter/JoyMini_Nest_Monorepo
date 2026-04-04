#!/usr/bin/env node
/**
 * Build script for @lucky/shared
 *
 * Step 1 — esbuild: fast JS compile (CJS, no bundle)
 * Step 2 — tsc --emitDeclarationOnly: generate .d.ts for TypeScript consumers (api, admin-next)
 */

const esbuild = require('esbuild');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../src');
const outDir = path.resolve(__dirname, '../dist');
const pkgRoot = path.resolve(__dirname, '..');

/** Recursively collect all .ts files (skip .d.ts) */
function getAllFiles(dir, acc) {
  acc = acc || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      getAllFiles(full, acc);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  });
  return acc;
}

function cleanDist() {
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

async function build() {
  const t0 = Date.now();
  console.log('🏗  Building @lucky/shared …');

  cleanDist();

  // Step 1: esbuild — fast JS output
  const files = getAllFiles(srcDir);
  console.log('   Files:', files.length);

  await esbuild.build({
    entryPoints: files,
    outbase: srcDir,
    outdir: outDir,
    bundle: false,       // compile-only — keeps each module in its own file
    format: 'cjs',       // CommonJS — safe for both Next.js and Node.js consumers
    platform: 'neutral', // works in both browser (admin-next) and node (api) contexts
    target: 'es2020',
    sourcemap: false,
  });
  console.log('   ✓ JS compiled (esbuild)');

  // Step 2: tsc — emit .d.ts declaration files only
  // Use tsc from root node_modules (monorepo setup)
  execSync('npx tsc -p tsconfig.json --emitDeclarationOnly --noEmit false', {
    cwd: pkgRoot,
    stdio: 'inherit',
  });
  console.log('   ✓ .d.ts generated (tsc)');

  const ms = Date.now() - t0;
  console.log('✅ @lucky/shared built in', ms + 'ms');
}

build().catch(function (err) {
  console.error('❌ Build failed:', err.message);
  process.exit(1);
});
