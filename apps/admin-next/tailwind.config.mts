import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [typography()],
} satisfies Config;
