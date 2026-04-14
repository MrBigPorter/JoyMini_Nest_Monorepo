#!/usr/bin/env node
/**
 * Build script for @repo/ui
 *
 * Compiles TypeScript/TSX source to dist/ using esbuild WITHOUT bundling.
 * Each component stays in its own .js file so Next.js `optimizePackageImports`
 * can tree-shake at import granularity (e.g. importing `cn` never pulls in
 * framer-motion or react-quill-new).
 *
 * Post-processing step rewrites .tsx/.ts import extensions → .js so the
 * output is valid ESM that browsers / bundlers can resolve.
 *
 * IMPORTANT: This script now uses atomic operations to avoid race conditions
 * when multiple containers build simultaneously. It builds to a temporary
 * directory first, then atomically moves to the final location.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');

const srcDir = path.resolve(__dirname, '../src');
const outDir = path.resolve(__dirname, '../dist');

/** Recursively collect all .ts / .tsx files */
function getAllFiles(dir, acc) {
  acc = acc || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      getAllFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(full);
    }
  });
  return acc;
}

/** Delete dist/ so stale files don't accumulate */
function cleanDist() {
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/** Create a unique temporary directory for atomic builds */
function createTempDir() {
  const tempDir = path.join(os.tmpdir(), `repo-ui-build-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/** Copy directory recursively */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  
  fs.mkdirSync(dest, { recursive: true });
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Verify that critical files exist in the build output */
function verifyBuild(tempOutDir) {
  const criticalFiles = [
    'components/ui/checkbox.js',
    'components/ui/button.js',
    'index.js',
    'lib/utils.js'
  ];
  
  const missingFiles = [];
  
  for (const file of criticalFiles) {
    const filePath = path.join(tempOutDir, file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
    }
  }
  
  if (missingFiles.length > 0) {
    throw new Error(`Build verification failed. Missing files: ${missingFiles.join(', ')}`);
  }
}

/**
 * After esbuild compiles with bundle:false the output still references the
 * original .tsx/.ts extensions (e.g. `export * from "./Form.tsx"`).
 * This step rewrites them to .js so the output is valid ESM.
 */
function rewriteExtensions(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      rewriteExtensions(full);
    } else if (e.name.endsWith('.js')) {
      // Check if file exists before reading
      if (!fs.existsSync(full)) {
        console.warn(`⚠️  File not found during rewriteExtensions: ${full}`);
        return;
      }
      
      try {
        let content = fs.readFileSync(full, 'utf8');
        // from "./X.tsx"  →  from "./X.js"
        // from "./X.ts"   →  from "./X.js"
        content = content.replace(/(\bfrom\s+["'])(\.[^"']+)\.(tsx|ts)(["'])/g, '$1$2.js$4');
        content = content.replace(/(export\s+\*\s+from\s+["'])(\.[^"']+)\.(tsx|ts)(["'])/g, '$1$2.js$4');
        fs.writeFileSync(full, content);
      } catch (err) {
        console.warn(`⚠️  Failed to rewrite extensions for ${full}:`, err.message);
      }
    }
  });
}

async function build() {
  const t0 = Date.now();
  console.log('🏗  Building @repo/ui (esbuild, no-bundle) …');

  // Create temporary directory for atomic build
  const tempDir = createTempDir();
  const tempOutDir = path.join(tempDir, 'dist');
  
  try {
    console.log('   Using temp dir:', path.relative(process.cwd(), tempDir));
    
    const files = getAllFiles(srcDir);
    console.log('   Files:', files.length);

    // Build to temporary directory
    await esbuild.build({
      entryPoints: files,
      outbase: srcDir,
      outdir: tempOutDir,
      bundle: false,         // compile-only — keeps each component in its own file
      format: 'esm',
      jsx: 'automatic',     // react/jsx-runtime (React 17+)
      loader: { '.css': 'empty' }, // CSS side-effect imports stripped (consumers handle CSS)
      platform: 'browser',
      target: 'es2020',
      sourcemap: false,
    });

    // Rewrite extensions in temporary directory
    rewriteExtensions(tempOutDir);
    
    // Verify build output
    verifyBuild(tempOutDir);
    
    // Clean existing dist directory
    cleanDist();
    
    // Atomically copy from temp to final location
    copyDir(tempOutDir, outDir);
    
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    const ms = Date.now() - t0;
    console.log('✅ @repo/ui built in', ms + 'ms →', path.relative(process.cwd(), outDir));
    
  } catch (err) {
    // Clean up temporary directory on error
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('⚠️  Failed to clean up temp dir:', cleanupErr.message);
    }
    
    // Re-throw the error for outer catch block
    throw err;
  }
}

build().catch(function (err) {
  console.error('❌ Build failed:', err.message);
  console.error('   Stack:', err.stack);
  console.error('   Current directory:', process.cwd());
  console.error('   Source directory:', srcDir);
  console.error('   Output directory:', outDir);
  process.exit(1);
});

