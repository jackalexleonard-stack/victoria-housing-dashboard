import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import siteEdge from './test/fixtures/site.edge.json'
import App from './App'

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  HTMLDialogElement.prototype.close ??= function () { this.open = false }
  Element.prototype.scrollIntoView = vi.fn()
})

const news = { schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
               items: [], top_story_urls: [], digest: null }

function mockFetch(site: unknown = siteEdge) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('news') ? news : site),
  })))
}

test('shows a skeleton, not a spinner, before data loads', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  const main = screen.getByRole('main')
  expect(main.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('renders masthead, sections and a chart finding after load', async () => {
  history.replaceState(null, '', '/')
  mockFetch()
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  expect(await screen.findByText('Victorian Housing')).toBeInTheDocument()
  // The cash-rate finding now also appears in Today (T3 lead/secondary
  // finding cards intentionally repeat hero-pick sentences — same rationale
  // as the "changed this week" chips duplicating hero tiles), so scope this
  // to the Money & credit section's own chart card.
  const money = screen.getByRole('region', { name: 'Money & credit' })
  expect(within(money).getByText(/held at 3.85%/)).toBeInTheDocument()
  expect(screen.queryByText(/data may be stale/i)).not.toBeInTheDocument()
})

test('stale generated_at raises the site-wide banner', async () => {
  mockFetch({ ...siteEdge as object, generated_at: '2026-07-10T04:00:00Z' })
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  expect(await screen.findByText(/data may be stale/i)).toBeInTheDocument()
})

test('fetch failure shows retry with the data link', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500,
    json: async () => ({}) })))
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /github/i })).toBeInTheDocument()
})

test('deep link opens the detail view on load', async () => {
  history.replaceState(null, '', '/?s=cash_rate')
  mockFetch()
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  await waitFor(() =>
    expect(within(screen.getByRole('dialog')).getByRole('heading', { level: 2 }))
      .toHaveTextContent(/held at 3.85%/))
})

test('clicking a chart card opens detail and url gains ?s=', async () => {
  history.replaceState(null, '', '/')
  mockFetch()
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  await screen.findByText('Victorian Housing')
  await userEvent.click(screen.getByRole('button', { name: /RBA cash rate target — open details/i }))
  expect(location.search).toContain('s=cash_rate')
})

test('jump targets carry scroll-margin so a scrolled-to heading clears the sticky bar', async () => {
  history.replaceState(null, '', '/')
  mockFetch()
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  await screen.findByText('Victorian Housing')
  const main = screen.getByRole('main')
  expect(main.querySelector('#today')).toHaveClass('scroll-mt-28')
  document.querySelectorAll('main > section').forEach(section => {
    expect(section).toHaveClass('scroll-mt-28')
  })
})

test('masthead only counts sources that are actually overdue, singular wording', async () => {
  history.replaceState(null, '', '/')
  mockFetch()
  // vic_auctions: failed, no data -> counts.
  // vic_rents: failed, last_data 2026-03-31, cadence 92 -> gap ~109d <= 1.5*92=138 -> quiet, does not count.
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  await screen.findByText('Victorian Housing')
  expect(await screen.findByText('1 source unavailable')).toBeInTheDocument()
  expect(screen.queryByText(/sources unavailable/)).not.toBeInTheDocument()
})

describe('collapsible sections', () => {
  beforeEach(() => localStorage.clear())

  test('toggling a section header hides its body and flips aria-expanded', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    // Sections have an accessible name via aria-label, so a plain <section>
    // gets the implicit 'region' role — scope through that rather than a raw
    // CSS attribute selector (jsdom's attribute-selector matcher chokes on a
    // literal '&' in the value, e.g. "Money & credit", and always returns null).
    const section = screen.getByRole('region', { name: 'Money & credit' })
    const toggle = within(section).getByRole('button', { name: 'Money & credit' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // Scoped to the section: Today's own lead/secondary finding cards
    // legitimately repeat this same sentence and aren't affected by this
    // section's collapse state.
    expect(within(section).getByText(/held at 3.85%/)).toBeInTheDocument()

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(section).queryByText(/held at 3.85%/)).not.toBeInTheDocument()
  })

  test('collapsed state persists in localStorage across remounts', async () => {
    history.replaceState(null, '', '/')
    localStorage.setItem('vh.collapsed', JSON.stringify(['money']))
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = screen.getByRole('region', { name: 'Money & credit' })
    const toggle = within(section).getByRole('button', { name: 'Money & credit' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(section).queryByText(/held at 3.85%/)).not.toBeInTheDocument()
  })

  test('jumping to a collapsed section expands it and then scrolls', async () => {
    history.replaceState(null, '', '/')
    localStorage.setItem('vh.collapsed', JSON.stringify(['money']))
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const nav = screen.getByRole('navigation', { name: /filters and sections/i })
    const chip = within(nav).getByRole('button', { name: 'Jump to Money & credit' })
    // The chip and the section's own disclosure toggle used to share the same
    // accessible name ("Money & credit"), so a screen reader couldn't tell
    // them apart. The chip's aria-label now disambiguates it: only the
    // disclosure toggle answers to the plain label.
    expect(screen.getAllByRole('button', { name: 'Money & credit' })).toHaveLength(1)

    await userEvent.click(chip)

    const section = screen.getByRole('region', { name: 'Money & credit' })
    const toggle = within(section).getByRole('button', { name: 'Money & credit' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await within(section).findByText(/held at 3.85%/)).toBeInTheDocument()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  test('a localStorage read failure degrades to all sections expanded, no crash', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = screen.getByRole('region', { name: 'Money & credit' })
    expect(within(section).getByText(/held at 3.85%/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Money & credit' }))
      .toHaveAttribute('aria-expanded', 'true')
    spy.mockRestore()
  })

  test('migrates the old vh.collapsed array into vh.sections overrides, then removes the old key', async () => {
    history.replaceState(null, '', '/')
    localStorage.setItem('vh.collapsed', JSON.stringify(['money']))
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(JSON.parse(localStorage.getItem('vh.sections')!)).toEqual({ money: 'closed' })
    expect(localStorage.getItem('vh.collapsed')).toBeNull()
    // The migrated override actually took effect, not just the storage shape.
    const section = screen.getByRole('region', { name: 'Money & credit' })
    expect(within(section).getByRole('button', { name: 'Money & credit' }))
      .toHaveAttribute('aria-expanded', 'false')
  })
})

// --- P0-3: viewport-aware collapse defaults ---

function stubPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion') || (coarse && q.includes('pointer: coarse')),
    media: q, addEventListener: () => {}, removeEventListener: () => {},
  }))
}

describe('viewport-aware collapse defaults', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => stubPointer(false))   // restore the fine-pointer default for later tests

  test('desktop (fine pointer): only World starts collapsed — News stays open', async () => {
    stubPointer(false)
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const world = screen.getByRole('region', { name: 'World' })
    expect(within(world).getByRole('button', { name: 'World' })).toHaveAttribute('aria-expanded', 'false')
    const news = screen.getByRole('region', { name: 'News' })
    expect(within(news).getByRole('button', { name: 'News' })).toHaveAttribute('aria-expanded', 'true')
    const prices = screen.getByRole('region', { name: 'Prices' })
    expect(within(prices).getByRole('button', { name: 'Prices' })).toHaveAttribute('aria-expanded', 'true')
  })

  test('mobile (coarse pointer): every section after Today starts collapsed, World and News included', async () => {
    stubPointer(true)
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    for (const name of ['World', 'News', 'Prices', 'Money & credit']) {
      const section = screen.getByRole('region', { name })
      expect(within(section).getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false')
    }
    // Today itself is never collapsible, regardless of viewport.
    expect(screen.getByText(/held at 3.85%/)).toBeInTheDocument()
  })

  test('an explicit override beats the viewport default in either direction', async () => {
    stubPointer(true)   // mobile default would close World
    localStorage.setItem('vh.sections', JSON.stringify({ world: 'open' }))
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const world = screen.getByRole('region', { name: 'World' })
    expect(within(world).getByRole('button', { name: 'World' })).toHaveAttribute('aria-expanded', 'true')
  })

  // T6 item 4: a coverage gap — every prior jump test drove the section
  // closed via an explicit vh.collapsed/vh.sections override, never via the
  // viewport (coarse-pointer) DEFAULT alone. Proves the jump chip's
  // "expand, then scroll" path also fires when defaultSectionOpen (not a
  // stored override) is the only reason the section starts closed.
  test('jumping to a section that is closed only by the mobile viewport default expands it and scrolls', async () => {
    stubPointer(true)
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = screen.getByRole('region', { name: 'Money & credit' })
    const toggle = within(section).getByRole('button', { name: 'Money & credit' })
    // No localStorage override at all — closed purely via the coarse-pointer
    // viewport default (confirmed by the 'mobile (coarse pointer)' test above).
    expect(localStorage.getItem('vh.sections')).toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    const nav = screen.getByRole('navigation', { name: /filters and sections/i })
    const chip = within(nav).getByRole('button', { name: 'Jump to Money & credit' })
    await userEvent.click(chip)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await within(section).findByText(/held at 3.85%/)).toBeInTheDocument()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
})

// --- P0-3: collapsed-row summary line + worst status chip ---

describe('collapsed section rows', () => {
  beforeEach(() => localStorage.clear())

  test('a collapsed row shows the section summary and its worst status chip', async () => {
    history.replaceState(null, '', '/')
    mockFetch()   // au_cash_rate is fresh -> Money's summary shows with a plain (non-chip) status
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = screen.getByRole('region', { name: 'Money & credit' })
    await userEvent.click(within(section).getByRole('button', { name: 'Money & credit' }))
    expect(within(section).getByText('The cash rate held steady this week.')).toBeInTheDocument()
  })

  test('honesty override: a quiet-sentinel summary is replaced when the section is actually stale/failed',
    async () => {
      history.replaceState(null, '', '/')
      // vic_rents (the fixture's only Rents series) is 'failed' status but reads
      // as 'fresh' at the fixture's usual NOW — push `now` far enough past its
      // 92-day cadence that its real outage actually trips the staleness gate.
      const mutated = { ...siteEdge as object,
        section_summaries: { ...(siteEdge as { section_summaries: object }).section_summaries,
          rents: 'No notable moves in Rents & vacancy this week.' },
        section_summary_quiet: { ...(siteEdge as { section_summary_quiet: object }).section_summary_quiet,
          rents: true } }
      mockFetch(mutated)
      const stale = new Date('2027-01-01T00:00:00Z')
      render(<App now={stale} />)
      await screen.findByText('Victorian Housing')
      const section = screen.getByRole('region', { name: 'Rents & vacancy' })
      await userEvent.click(within(section).getByRole('button', { name: 'Rents & vacancy' }))
      expect(within(section).queryByText('No notable moves in Rents & vacancy this week.'))
        .not.toBeInTheDocument()
      expect(within(section).getByText(/Data to Mar qtr 2026 — source unavailable/)).toBeInTheDocument()
    })

  test('a genuine finding survives even when some series in the section is stale (not suppressed)',
    async () => {
      history.replaceState(null, '', '/')
      mockFetch()
      render(<App now={new Date('2026-07-18T10:00:00Z')} />)
      await screen.findByText('Victorian Housing')
      const section = screen.getByRole('region', { name: 'Prices' })
      await userEvent.click(within(section).getByRole('button', { name: 'Prices' }))
      // vic_auctions is failed with no vintage at all, yet Prices' real
      // summary sentence still shows, with the failure surfaced via the
      // worst-status chip alongside it rather than by suppressing the news.
      expect(within(section).getByText('Prices were broadly steady this week.')).toBeInTheDocument()
      expect(within(section).getByText(/source unavailable/i)).toBeInTheDocument()
    })
})

// --- P1-outage: hoisted section notice + quiet per-card chips ---

describe('shared-outage section notice', () => {
  beforeEach(() => localStorage.clear())

  test('hoists one notice under the h2 when every series in the section shares one source + vintage',
    async () => {
      history.replaceState(null, '', '/')
      mockFetch()
      const stale = new Date('2027-01-01T00:00:00Z')   // trips vic_rents' failed gate
      render(<App now={stale} />)
      await screen.findByText('Victorian Housing')
      const section = screen.getByRole('region', { name: 'Rents & vacancy' })
      expect(within(section).getByText(/DFFH source unavailable — data to Mar qtr 2026/))
        .toBeInTheDocument()
      // The per-card chip drops to the quiet form instead of repeating the
      // full staleness sentence at full strength (two cards share vic_rents
      // in the fixture, so both carry the quiet chip).
      expect(within(section).getAllByText(/Mar qtr 2026 · unavailable/).length).toBeGreaterThan(0)
    })

  test('no shared-outage notice when the section is not uniformly stale/failed (e.g. Money, at the default NOW)',
    async () => {
      history.replaceState(null, '', '/')
      mockFetch()
      render(<App now={new Date('2026-07-18T10:00:00Z')} />)
      await screen.findByText('Victorian Housing')
      const section = screen.getByRole('region', { name: 'Money & credit' })
      expect(within(section).queryByText(/source unavailable — data to/)).not.toBeInTheDocument()
    })
})
