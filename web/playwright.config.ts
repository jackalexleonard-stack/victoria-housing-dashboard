import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], reducedMotion: 'reduce' } },
  ],
  webServer: {
    command: 'npm run e2e:serve',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
