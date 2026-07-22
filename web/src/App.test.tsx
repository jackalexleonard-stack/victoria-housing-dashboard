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

// The first-run modal blocks a cold load; every test that drives the
// dashboard directly seeds the "already onboarded" flag so the modal is
// suppressed. The modal's own describe clears it (see below) to see it.
beforeEach(() => { try { localStorage.setItem('vh.welcomeSeen', '1') } catch { /* ignore */ } })

const news = { schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
               items: [], top_story_urls: [], digest: null }

function mockFetch(site: unknown = siteEdge) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('news') ? news : site),
  })))
}

// 2.5: every themed section defaults closed, so tests that inspect section
// BODIES must open the section first, exactly like a reader would.
async function openSection(name: string) {
  const section = screen.getByRole('region', { name })
  const toggle = within(section).getByRole('button', { name })
  if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle)
  return section
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
  const money = await openSection('Money & credit')
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
  await openSection('Money & credit')
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
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

  test('toggling a section header mounts its body and flips aria-expanded', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = screen.getByRole('region', { name: 'Money & credit' })
    const toggle = within(section).getByRole('button', { name: 'Money & credit' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(section).queryByText(/held at 3.85%/)).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(section).getByText(/held at 3.85%/)).toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(section).queryByText(/held at 3.85%/)).not.toBeInTheDocument()
  })

  test('collapsed state persists in localStorage across remounts', async () => {
    history.replaceState(null, '', '/')
    localStorage.setItem('vh.sections', JSON.stringify({ money: 'open' }))
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = screen.getByRole('region', { name: 'Money & credit' })
    const toggle = within(section).getByRole('button', { name: 'Money & credit' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(section).getByText(/held at 3.85%/)).toBeInTheDocument()
  })

  test('jumping to a collapsed section expands it and then scrolls', async () => {
    history.replaceState(null, '', '/')
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

  test('a localStorage read failure degrades to the closed defaults, no crash', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    expect(await screen.findByText('Victorian Housing')).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'Money & credit' })
    expect(within(section).getByRole('button', { name: 'Money & credit' }))
      .toHaveAttribute('aria-expanded', 'false')
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

describe('default-closed sections (2.5)', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

  test('every themed section starts closed — no pointer-type dependence', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    for (const name of ['Prices', 'Rents & vacancy', 'Supply & construction',
                        'Money & credit', 'People', 'Social housing', 'World', 'News']) {
      const section = screen.getByRole('region', { name })
      expect(within(section).getByRole('button', { name }))
        .toHaveAttribute('aria-expanded', 'false')
    }
    // Today is not part of the system and stays rendered.
    expect(screen.getByTestId('hero-strip')).toBeInTheDocument()
  })

  test('a stored open override still opens a section', async () => {
    localStorage.setItem('vh.sections', JSON.stringify({ world: 'open' }))
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const world = screen.getByRole('region', { name: 'World' })
    expect(within(world).getByRole('button', { name: 'World' }))
      .toHaveAttribute('aria-expanded', 'true')
  })

  test('a closed section renders its heading and nothing else (truly bare)', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const money = screen.getByRole('region', { name: 'Money & credit' })
    expect(money.children).toHaveLength(1)
    expect(money.children[0].tagName).toBe('H2')
  })
})

// --- D1(f): World KPI tile row when expanded ---

function worldChart(id: string, title: string, seriesId: string, metric: string, percent = false) {
  return { id, section: 'world', title, series_id: seriesId, metrics: [metric],
           region_mode: 'fixed:global', percent, markers: false, annotate: false }
}

function withWorldTiles(base: object) {
  const mutated = JSON.parse(JSON.stringify(base))
  mutated.charts.push(
    worldChart('brent', 'Brent crude', 'intl_fred', 'brent_crude'),
    worldChart('aud_usd', 'AUD/USD', 'intl_fred', 'aud_usd'),
    worldChart('ust10', 'US 10-year Treasury', 'intl_fred', 'us_10y_treasury', true),
    worldChart('iron_ore', 'Iron ore', 'intl_commodities', 'iron_ore'),
    worldChart('copper', 'Copper', 'intl_commodities', 'copper'),
    worldChart('sawnwood', 'Sawnwood', 'intl_commodities', 'sawnwood'),
  )
  mutated.series.intl_fred = {
    status: 'ok',
    meta: { source_name: 'FRED', source_url: 'https://fred.stlouisfed.org', frequency: 'daily',
            last_fetched: '2026-07-18T00:00:00Z', last_changed: null,
            last_data_date: '2026-07-17', error: null, cadence_days: 1 },
    units: { brent_crude: 'usd_per_barrel', aud_usd: 'usd_per_aud', us_10y_treasury: 'percent' },
    points: [
      { date: '2026-07-10', region: 'global', metric: 'brent_crude', value: 80 },
      { date: '2026-07-17', region: 'global', metric: 'brent_crude', value: 82 },
      { date: '2026-07-10', region: 'global', metric: 'aud_usd', value: 0.65 },
      { date: '2026-07-17', region: 'global', metric: 'aud_usd', value: 0.66 },
      { date: '2026-07-10', region: 'global', metric: 'us_10y_treasury', value: 4.2 },
      { date: '2026-07-17', region: 'global', metric: 'us_10y_treasury', value: 4.35 },
    ],
  }
  mutated.series.intl_commodities = {
    status: 'ok',
    meta: { source_name: 'World Bank', source_url: 'https://wb', frequency: 'monthly',
            last_fetched: '2026-07-18T00:00:00Z', last_changed: null,
            last_data_date: '2026-06-30', error: null, cadence_days: 31 },
    units: { iron_ore: 'USD/dmtu', copper: 'USD/tonne', sawnwood: 'USD/m3' },
    points: [
      { date: '2026-05-31', region: 'global', metric: 'iron_ore', value: 100 },
      { date: '2026-06-30', region: 'global', metric: 'iron_ore', value: 105 },
      { date: '2026-05-31', region: 'global', metric: 'copper', value: 9000 },
      { date: '2026-06-30', region: 'global', metric: 'copper', value: 9500 },
      { date: '2026-05-31', region: 'global', metric: 'sawnwood', value: 400 },
      { date: '2026-06-30', region: 'global', metric: 'sawnwood', value: 420 },
    ],
  }
  for (const id of ['brent', 'aud_usd', 'ust10', 'iron_ore', 'copper', 'sawnwood']) {
    mutated.findings[id] = 'f'
  }
  mutated.section_summaries = { ...mutated.section_summaries,
    world: 'Brent crude rose 9.8% to US$82 in Jul 2026' }
  return mutated
}

describe('World KPI tile row (D1f)', () => {
  beforeEach(() => localStorage.clear())

  test('World expanded renders the compact 6-tile KPI row led by the section summary, not six chart cards', async () => {
    history.replaceState(null, '', '/')
    localStorage.setItem('vh.sections', JSON.stringify({ world: 'open' }))
    mockFetch(withWorldTiles(siteEdge))
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const world = await openSection('World')
    expect(within(world).getByText('Brent crude rose 9.8% to US$82 in Jul 2026')).toBeInTheDocument()
    for (const label of ['Brent crude', 'AUD/USD', 'US 10-year Treasury', 'Iron ore', 'Copper', 'Sawnwood']) {
      expect(within(world).getByText(label)).toBeInTheDocument()
    }
    // No full-height single-series LineChart cards left in World.
    expect(within(world).queryAllByRole('img').length).toBe(0)
  })

  test('tapping a World tile opens the same detail modal used everywhere else', async () => {
    history.replaceState(null, '', '/')
    localStorage.setItem('vh.sections', JSON.stringify({ world: 'open' }))
    mockFetch(withWorldTiles(siteEdge))
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const world = await openSection('World')
    await userEvent.click(within(world).getByText('Copper').closest('button')!)
    expect(location.search).toContain('s=copper')
  })
})

// --- D2(e): dangling last card spans full width ---

describe('trailing card grid (D2e)', () => {
  test('an even-remainder section (fixture Money: 3 cards) does not dangle its last card', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = await openSection('Money & credit')
    const articles = within(section).getAllByRole('article')
    expect(articles).toHaveLength(3)   // cash_rate, lending, mortgage_rates
    expect(articles[0].parentElement).toHaveClass('sm:col-span-2')   // the lead card
    expect(articles[2].parentElement).not.toHaveClass('sm:col-span-2')   // last, but pairs evenly
  })

  test('an odd-remainder section (4 cards) spans the dangling last card full width', async () => {
    history.replaceState(null, '', '/')
    const mutated = JSON.parse(JSON.stringify(siteEdge))
    mutated.charts.push({
      id: 'credit', section: 'money', title: 'Housing credit growth',
      series_id: 'au_cash_rate', metrics: ['cash_rate'], region_mode: 'fixed:australia',
      percent: true, markers: false, annotate: false, note: null, modal_metrics: null,
    })
    mutated.findings.credit = 'f'
    mockFetch(mutated)
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = await openSection('Money & credit')
    const articles = within(section).getAllByRole('article')
    expect(articles).toHaveLength(4)
    expect(articles[0].parentElement).toHaveClass('sm:col-span-2')       // the lead card
    expect(articles[1].parentElement).not.toHaveClass('sm:col-span-2')
    expect(articles[2].parentElement).not.toHaveClass('sm:col-span-2')
    expect(articles[3].parentElement).toHaveClass('sm:col-span-2')       // the dangling last card
  })
})

// --- P1-outage: hoisted section notice + quiet per-card chips ---

describe('sections URL param (2.5)', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

  const toggleOf = (name: string) =>
    within(screen.getByRole('region', { name })).getByRole('button', { name })

  test('?sections= beats localStorage and the closed default — and is not persisted on load', async () => {
    localStorage.setItem('vh.sections', JSON.stringify({ prices: 'open' }))
    history.replaceState(null, '', '/?sections=rents,money')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(toggleOf('Rents & vacancy')).toHaveAttribute('aria-expanded', 'true')
    expect(toggleOf('Money & credit')).toHaveAttribute('aria-expanded', 'true')
    expect(toggleOf('Prices')).toHaveAttribute('aria-expanded', 'false')
    // Viewing a preset link must not overwrite the visitor's own saved state.
    expect(JSON.parse(localStorage.getItem('vh.sections')!)).toEqual({ prices: 'open' })
  })

  test('toggling a heading persists the full state and mirrors it into the URL', async () => {
    history.replaceState(null, '', '/?sections=rents')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await userEvent.click(toggleOf('Prices'))
    // contentSections order is prices,rents,… so the mirrored list is ordered.
    expect(new URLSearchParams(location.search).get('sections')).toBe('prices,rents')
    expect(JSON.parse(localStorage.getItem('vh.sections')!))
      .toMatchObject({ prices: 'open', rents: 'open' })
  })

  test('with no param, toggling still mirrors into the URL', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await userEvent.click(toggleOf('People'))
    expect(new URLSearchParams(location.search).get('sections')).toBe('people')
  })

  test('unknown ids in the param are ignored', async () => {
    history.replaceState(null, '', '/?sections=bogus,money')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(toggleOf('Money & credit')).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['Prices', 'People', 'World']) {
      expect(toggleOf(name)).toHaveAttribute('aria-expanded', 'false')
    }
  })

  test('the Sections popover opens sections and Reset returns to bare defaults', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await userEvent.click(screen.getAllByRole('button', { name: 'Sections' })[0])
    await userEvent.click(screen.getByRole('checkbox', { name: 'Prices' }))
    expect(toggleOf('Prices')).toHaveAttribute('aria-expanded', 'true')
    expect(new URLSearchParams(location.search).get('sections')).toBe('prices')
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(toggleOf('Prices')).toHaveAttribute('aria-expanded', 'false')
    expect(new URLSearchParams(location.search).get('sections')).toBeNull()
    expect(localStorage.getItem('vh.sections')).toBeNull()
  })
})

describe('first-run welcome modal', () => {
  beforeEach(() => localStorage.clear())

  const modal = () => screen.getByRole('dialog', { name: /choose your sections/i })

  test('shows on a true first visit (no saved state, no preset link)', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(modal()).toBeInTheDocument()
  })

  test.each([
    ['vh.welcomeSeen present', () => localStorage.setItem('vh.welcomeSeen', '1'), '/'],
    ['vh.sections present', () => localStorage.setItem('vh.sections', JSON.stringify({ money: 'open' })), '/'],
    ['legacy hint dismissed', () => localStorage.setItem('vh.sectionsHintDismissed', '1'), '/'],
    ['preset link', () => {}, '/?sections=money'],
  ])('suppressed when %s', async (_label, seed, url) => {
    seed()
    history.replaceState(null, '', url)
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(screen.queryByRole('dialog', { name: /choose your sections/i })).not.toBeInTheDocument()
  })

  test('Enter opens exactly the checked sections, persists, and closes the modal', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await userEvent.click(within(modal()).getByRole('checkbox', { name: 'Money & credit' }))
    await userEvent.click(within(modal()).getByRole('button', { name: 'Enter dashboard' }))
    // Section opened
    const money = screen.getByRole('region', { name: 'Money & credit' })
    expect(within(money).getByRole('button', { name: 'Money & credit' }))
      .toHaveAttribute('aria-expanded', 'true')
    // Persisted + mirrored + marked seen
    expect(localStorage.getItem('vh.welcomeSeen')).toBe('1')
    expect(new URLSearchParams(location.search).get('sections')).toBe('money')
    // Modal gone
    expect(screen.queryByRole('dialog', { name: /choose your sections/i })).not.toBeInTheDocument()
  })

  test('Show everything opens all themed sections, persists, and closes', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await userEvent.click(within(modal()).getByRole('button', { name: 'Show everything' }))
    for (const name of ['Prices', 'Money & credit', 'World', 'News']) {
      const s = screen.getByRole('region', { name })
      expect(within(s).getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
    }
    expect(localStorage.getItem('vh.welcomeSeen')).toBe('1')
    expect(screen.queryByRole('dialog', { name: /choose your sections/i })).not.toBeInTheDocument()
  })
})

describe('shared-outage section notice', () => {
  beforeEach(() => localStorage.clear())

  test('hoists one notice under the h2 when every series in the section shares one source + vintage',
    async () => {
      history.replaceState(null, '', '/')
      mockFetch()
      const stale = new Date('2027-01-01T00:00:00Z')   // trips vic_rents' failed gate
      render(<App now={stale} />)
      await screen.findByText('Victorian Housing')
      const section = await openSection('Rents & vacancy')
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
      const section = await openSection('Money & credit')
      expect(within(section).queryByText(/source unavailable — data to/)).not.toBeInTheDocument()
    })
})
