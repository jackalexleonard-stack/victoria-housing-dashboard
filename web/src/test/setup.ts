import '@testing-library/jest-dom/vitest'

// jsdom has no matchMedia. Report reduced-motion as ON in unit tests so
// count-ups render final values and draw-ins are skipped (deterministic DOM).
vi.stubGlobal('matchMedia', (q: string) => ({
  matches: q.includes('prefers-reduced-motion'),
  media: q, addEventListener: () => {}, removeEventListener: () => {},
}))
