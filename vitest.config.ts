import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolve the "tsx" export condition so @backlogger/shared uses its
    // TypeScript source (./src/index.ts) rather than the compiled dist.
    conditions: ['tsx'],
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/web/e2e/**'],
    passWithNoTests: false,
    environmentMatchGlobs: [['packages/web/**', 'jsdom']],
  },
});
