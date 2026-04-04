import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Deprecated shim: keep for local scripts that may still import .mjs.
// Canonical config is apps/admin-next/lighthouserc.js (CJS), which LHCI CLI reads reliably.
const config = require('./lighthouserc.js');

export default config;
