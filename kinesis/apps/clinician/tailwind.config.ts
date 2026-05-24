import type { Config } from 'tailwindcss';
import { tailwindPreset } from '@kinesis/ui/theme';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: { extend: tailwindPreset.theme.extend },
  plugins: [],
};

export default config;
