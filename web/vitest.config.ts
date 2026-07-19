import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], globals: true,
    // e2e/ holds Playwright specs (run via `npm run e2e`, not Vitest) —
    // exclude it so Vitest doesn't try to import @playwright/test's test().
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
