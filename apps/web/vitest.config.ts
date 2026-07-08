import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next's tsconfig uses jsx:preserve — tell esbuild to compile JSX itself.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
});
