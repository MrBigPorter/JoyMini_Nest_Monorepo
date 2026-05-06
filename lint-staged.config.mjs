export default {
  '*.{ts,tsx,js,jsx,json,md,yaml,yml}': ['prettier --write'],
  '*.{ts,tsx,js,jsx}': ['eslint --fix'],
  'apps/admin-next/src/**/*.{test,spec}.{ts,tsx}': [
    () => 'yarn workspace @lucky/admin-next vitest related --run',
  ],
};
