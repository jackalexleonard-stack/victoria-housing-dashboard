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
  // vic_auctions: failed, no data at all -> kind 'failed', counts.
  // vic_rents: failed but retains data (last_data 2026-03-31) -> age-only
  // taxonomy governs it (fresh/ageing/stale) -> kind is never 'failed' while
  // data exists, so it never counts, regardless of date.
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
           region_mode: 'fixed:global', scope: 'global', geos: [],
           percent, markers: false, annotate: false }
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
    mutated.findings[id] = { melbourne: 'f' }
  }
  // T4: section_summaries is per-geo now ({section: {geo: sentence}}) —
  // World is geo-independent, so WorldTiles resolves it under DEFAULT_GEO.
  mutated.section_summaries = { ...mutated.section_summaries,
    world: { melbourne: 'Brent crude rose 9.8% to US$82 in Jul 2026' } }
  return mutated
}

describe('World KPI tile row (D1f)', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

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

// --- D2(e)/§2.2: height-aware row spans in both the grid and context bands ---

describe('trailing card grid (D2e)', () => {
  // T4: Money's own cash_rate/mortgage_rates are national-scope (their data
  // is australia-only) -> under the default melbourne geo they now sit in
  // the "Wider context" band, not the grid (see the 'geo banding' describe
  // below) — the grid band ends up holding only 'lending'. Spec §2.2 (Task
  // 8/9) repealed the old "context cards never span" rule: the context band
  // now runs through the same height-aware buildRows as the grid, so a
  // 'standard' card with no same-class neighbour (cash_rate) and a 'tall'
  // card that can never pair (mortgage_rates, always tall) both end up as
  // their own spanning rows. These two tests still cover the SAME
  // dangling/lead col-span-2 rule for the grid band, plus the new
  // height-aware context-band spanning, with the post-banding composition
  // spelled out below instead of the pre-T4 flat 3-/4-card layout.
  test('an even-remainder section: money\'s single grid card (lending) spans as the lead; its context-band siblings (standard cash_rate, tall mortgage_rates) both span too (spec §2.2)', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = await openSection('Money & credit')
    const articles = within(section).getAllByRole('article')
    expect(articles).toHaveLength(3)   // lending (grid), cash_rate + mortgage_rates (context)
    expect(articles[0].parentElement).toHaveClass('sm:col-span-2')   // lending — the grid's lead (and only) card
    expect(articles[1].parentElement).toHaveClass('sm:col-span-2')   // cash_rate — standard, no same-class neighbour: spans
    expect(articles[2].parentElement).toHaveClass('sm:col-span-2')   // mortgage_rates — always tall, never pairs: spans
  })

  test('an odd-remainder grid (2 grid cards): lead and dangle rules coincide, so both span full width; the context band spans both its cards too (spec §2.2)', async () => {
    history.replaceState(null, '', '/')
    const mutated = JSON.parse(JSON.stringify(siteEdge))
    // scope 'geo' + geos ['melbourne']: a synthetic Melbourne-specific mover
    // (unlike the real cash_rate/mortgage_rates, national-scope and thus
    // context-band under melbourne — see the describe-level comment above),
    // so this one joins 'lending' in the grid band, making it a 2-card grid.
    mutated.charts.push({
      id: 'credit', section: 'money', title: 'Housing credit growth',
      series_id: 'au_cash_rate', metrics: ['cash_rate'], region_mode: 'fixed:australia',
      scope: 'geo', geos: ['melbourne'],
      percent: true, markers: false, annotate: false, note: null, modal_metrics: null,
    })
    mutated.findings.credit = { melbourne: 'f' }
    mockFetch(mutated)
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const section = await openSection('Money & credit')
    const articles = within(section).getAllByRole('article')
    expect(articles).toHaveLength(4)   // lending, credit (grid) + cash_rate, mortgage_rates (context)
    expect(articles[0].parentElement).toHaveClass('sm:col-span-2')       // lending — grid lead (i === 0)
    // grid.length is 2 here, so (grid.length - 1) % 2 === 1: the "odd
    // remainder" dangle condition is true for the LAST grid card too —
    // with only 2 cards in the grid, lead and dangle are the same card.
    expect(articles[1].parentElement).toHaveClass('sm:col-span-2')       // credit — grid's dangling last card
    expect(articles[2].parentElement).toHaveClass('sm:col-span-2')       // cash_rate — standard, no same-class neighbour: spans (spec §2.2)
    expect(articles[3].parentElement).toHaveClass('sm:col-span-2')       // mortgage_rates — always tall, never pairs: spans (spec §2.2)
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

  test('a first-visit detail deep-link shows onboarding first, not the detail view', async () => {
    history.replaceState(null, '', '/?s=cash_rate')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(screen.getByRole('dialog', { name: /choose your sections/i })).toBeInTheDocument()
    // The detail view must be suppressed until the user has onboarded.
    expect(screen.queryByRole('dialog', { name: 'RBA cash rate target' })).not.toBeInTheDocument()
  })
})

describe('shared-outage section notice', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

  test('hoists one notice under the h2 when every series in the section shares one source + vintage',
    async () => {
      history.replaceState(null, '', '/')
      mockFetch()
      // Age-only taxonomy: this pushes vic_rents (last_data 2026-03-31,
      // cadence 92) past 2.5x cadence into kind 'stale' — never 'failed',
      // since it still carries data — which is enough on its own to satisfy
      // sectionOutageNotice's stale-or-failed gate.
      const stale = new Date('2027-01-01T00:00:00Z')
      render(<App now={stale} />)
      await screen.findByText('Victorian Housing')
      const section = await openSection('Rents & vacancy')
      const banner = within(section).getByRole('button',
        { name: /DFFH — awaiting new release · data to Mar qtr 2026/ })
      expect(banner).toBeInTheDocument()
      // jsdom can't see layout, so these are the class-level guards that the
      // real full-width warn bar depends on: the button itself must stretch
      // (`w-full`), and its Popover root must be a block box, not the
      // default `inline-block` (which would shrink-wrap to the text and
      // render a text-width pill instead of a full-width bar).
      expect(banner.className).toContain('w-full')
      expect(banner.parentElement?.className).toContain('block')
      expect(banner.parentElement?.className).not.toContain('inline-block')
      // The per-card chip drops to the quiet form instead of repeating the
      // full staleness sentence at full strength (two cards share vic_rents
      // in the fixture, so both carry the quiet chip). Age-only taxonomy:
      // vic_rents is 'stale' here (not 'failed', per the comment above), so
      // the quiet chip says "· stale", not a blanket "· unavailable".
      expect(within(section).getAllByText(/Mar qtr 2026 · stale/).length).toBeGreaterThan(0)
      // The banner is the same Popover mechanism the chips use — clicking it
      // opens the shared ExplainerPanel, not a bespoke tooltip.
      await userEvent.click(banner)
      expect(within(section).getByRole('group', { name: /why this section.s data is old/i }))
        .toBeInTheDocument()
    })

  test('no shared-outage notice when the section is not uniformly stale/failed (e.g. Money, at the default NOW)',
    async () => {
      history.replaceState(null, '', '/')
      mockFetch()
      render(<App now={new Date('2026-07-18T10:00:00Z')} />)
      await screen.findByText('Victorian Housing')
      const section = await openSection('Money & credit')
      expect(within(section).queryByText(/awaiting new release · data to/)).not.toBeInTheDocument()
    })
})

test('the detail modal chip opens the explainer popover', async () => {
  history.replaceState(null, '', '/')
  mockFetch()
  const stale = new Date('2027-01-01T00:00:00Z')
  render(<App now={stale} />)
  await screen.findByText('Victorian Housing')
  const section = await openSection('Rents & vacancy')
  await userEvent.click(within(section).getAllByRole('button', { name: /open details/ })[0])
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: /— why\?$/ }))
  expect(within(dialog).getByRole('group', { name: /details$/ })).toBeInTheDocument()
})

describe('geo banding', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

  async function openAll() {
    for (const t of screen.getAllByRole('button', { expanded: false })) await userEvent.click(t)
  }

  test('a chart with no data for the selected geo is not rendered in the grid, but IS present at a geo it genuinely covers', async () => {
    // median_rent (rents section): site.edge.json's vic_rents series only
    // carries melbourne rows for the median_rent metric -> hidden (genuine
    // gap) under regional_vic, present in the grid under melbourne. Picked
    // by inspecting the fixture directly (`node -e` dump of site.edge.json)
    // rather than assuming a title that doesn't exist in this fixture.
    history.replaceState(null, '', '/?geo=regional_vic&sections=rents')
    mockFetch()
    const first = render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    expect(screen.queryByText('Median weekly rent')).not.toBeInTheDocument()
    first.unmount()

    history.replaceState(null, '', '/?geo=melbourne&sections=rents')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    expect(screen.getByText('Median weekly rent')).toBeInTheDocument()
  })

  test('the footnote names the hidden charts for this geography', async () => {
    history.replaceState(null, '', '/?geo=regional_vic&sections=prices')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    // openAll() expands every section, not just 'prices' — the edge
    // fixture's rents/money sections also carry melbourne-only geo-scope
    // charts backed by a WORKING source (vic_rents/au_lending are not the
    // broken-source case), so under regional_vic each of rents/money
    // legitimately renders its OWN footnote (a genuine per-section gap)
    // — prices' own chart (auctions) is a broken source with no historical
    // geos and is correctly absent, not footnoted (see 'never reports a
    // failed source as a geography gap', below).
    const notes = screen.getAllByTestId('geo-footnote')
    expect(notes.length).toBeGreaterThan(0)
    for (const note of notes) expect(note).toHaveTextContent(/not published for Regional Vic/i)
  })

  test('national charts appear in the context band under a Victorian geo', async () => {
    history.replaceState(null, '', '/?geo=melbourne&sections=money')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    const band = screen.getByTestId('context-band')
    expect(within(band).getByText(/RBA cash rate/i)).toBeInTheDocument()
    expect(within(band).getAllByText('Australia').length).toBeGreaterThan(0)
  })

  // 2026-07-24 banner batch (Task 3): a dead chart (isDeadChart — a broken
  // source with no historical geo coverage) must sort to the END of its
  // section's grid, as a compact outage row, never as the section's
  // spanning lead card. Deliberately targets Prices: the fixture's REGISTRY
  // order there is [auctions (dead), hvi_melbourne (healthy)] — the
  // OPPOSITE of the required render order — so this genuinely exercises the
  // sort rather than passing by registry-order coincidence (a sort that
  // silently no-ops, or that even reverses correctly by accident on some
  // OTHER section, would still fail here).
  test('a dead chart (auctions) sorts to the end of Prices, after the healthy chart that leads it in registry order', async () => {
    history.replaceState(null, '', '/?geo=melbourne&sections=prices')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const prices = screen.getByRole('region', { name: 'Prices' })
    const outageRow = within(prices).getByTestId('outage-row')
    const healthyCard = within(prices).getByText('Cotality HVI — Melbourne').closest('article')
    expect(healthyCard).not.toBeNull()
    // DOCUMENT_POSITION_FOLLOWING (4): healthyCard must precede outageRow in
    // the DOM — i.e. the healthy card renders BEFORE the dead one, reversed
    // from their [auctions, hvi_melbourne] registry order.
    expect(healthyCard!.compareDocumentPosition(outageRow) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    // The dead chart never becomes the spanning lead card either.
    expect(outageRow.closest('.sm\\:col-span-2')).not.toBeNull()
    expect(healthyCard!.parentElement).toHaveClass('sm:col-span-2')
  })

  // 2026-07-24 banner batch: the headline banner used to hide whenever
  // filters were active (range and/or geo off default) — it's now always
  // on, quoting whatever geography is selected. App no longer computes
  // filtersActive at all, so this just proves the banner survives a
  // non-default range untouched.
  test('the headline banner still shows under a non-default range', async () => {
    history.replaceState(null, '', '/?range=1y')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(screen.getByTestId('lead-finding-card')).toBeInTheDocument()
  })

  // Review fix: a failed/missing source (vic_auctions: status 'failed', zero
  // points, no historical geo signal at all) must never be reported as a
  // geography gap — that would itself be the false claim this project
  // exists to stop (auction clearance IS published for Melbourne; the
  // scraper is blocked). It renders its honest outage card at its own home
  // geo, and is simply absent — never footnoted — anywhere else.
  test('a failed source never reports a false geography gap — outage card at its own geo, no footnote at all', async () => {
    history.replaceState(null, '', '/?geo=melbourne&sections=prices')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    expect(screen.getByText('Auction clearance — Melbourne')).toBeInTheDocument()
    expect(screen.getByText(/aren.t reachable from an automated source/i)).toBeInTheDocument()
    // Nothing is a genuine gap under the chart's own home geo (melbourne) in
    // this fixture — no footnote anywhere on the page.
    expect(screen.queryByTestId('geo-footnote')).not.toBeInTheDocument()
  })

  test('...and under a geo it does not cover, it is simply absent — never named in the footnote either', async () => {
    history.replaceState(null, '', '/?geo=vic&sections=prices')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    expect(screen.queryByText('Auction clearance — Melbourne')).not.toBeInTheDocument()
    // Other sections legitimately footnote genuine gaps under 'vic' (their
    // own working-source, melbourne-only charts) — auctions must never be
    // named in any of them.
    for (const note of screen.queryAllByTestId('geo-footnote')) {
      expect(note).not.toHaveTextContent(/auction/i)
    }
  })

  // CRITICAL whole-branch review fix: a scope="state", region_mode="geo"
  // context chart (mirrors the real 'activity'/'social_housing_rogs'
  // charts, both geos:['vic','australia']) renders in the "Wider context"
  // band at ITS OWN geo ('vic') — the card above already shows the correct
  // Victorian finding. Before this fix, clicking the card opened the detail
  // modal at state.geo ('melbourne') regardless: the h2 finding still fell
  // back to the Victorian sentence (via `?? geos[0]`), but the chart body
  // filtered strictly on 'melbourne' -> zero rows -> the "No recent data —
  // source currently unavailable" empty state. A genuine geography gap was
  // misreported as a source outage, directly contradicting its own headline.
  test('opening a context chart\'s detail modal renders the chart at its own geo, agreeing with the headline (not the melbourne fallback)', async () => {
    history.replaceState(null, '', '/?geo=melbourne&sections=supply')
    const mutated = JSON.parse(JSON.stringify(siteEdge))
    mutated.series.vic_activity_test = {
      status: 'ok',
      meta: { source_name: 'ABS', source_url: 'https://abs.gov.au', frequency: 'quarterly',
              last_fetched: '2026-07-17T06:00:00Z', last_changed: '2026-07-15T00:00:00Z',
              last_data_date: '2026-03-31', error: null, cadence_days: 92 },
      units: { dwellings_commenced: 'dwellings' },
      points: [
        { date: '2025-12-31', region: 'vic', metric: 'dwellings_commenced', value: 13600 },
        { date: '2026-03-31', region: 'vic', metric: 'dwellings_commenced', value: 13429 },
        { date: '2025-12-31', region: 'australia', metric: 'dwellings_commenced', value: 54000 },
        { date: '2026-03-31', region: 'australia', metric: 'dwellings_commenced', value: 45154 },
      ],
    }
    mutated.charts.push({
      id: 'activity_test', section: 'supply', title: 'Commencements, completions, pipeline',
      series_id: 'vic_activity_test', metrics: null, region_mode: 'geo',
      scope: 'state', geos: ['vic', 'australia'],
      percent: false, markers: false, annotate: false, note: null, modal_metrics: null,
    })
    mutated.findings.activity_test = {
      vic: 'Dwellings commenced fell 1.2% to 13,429 in Mar qtr 2026',
      australia: 'Dwellings commenced fell 16.7% to 45,154 in Mar qtr 2026',
    }
    mockFetch(mutated)
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    const card = screen.getByRole('button',
      { name: /Commencements, completions, pipeline — open details/i })
    await userEvent.click(card)
    // region_mode 'geo' -> modalRegion is the geo the modal actually opened
    // at, which is detailGeo (App's own-geo fallback), NOT the requested
    // melbourne — 'vic', per the comment above -> REGION_BADGE suffix
    // '— Victoria-wide' (Task 2).
    const dialog = await screen.findByRole('dialog',
      { name: 'Commencements, completions, pipeline — Victoria-wide' })
    // (a) the modal chart is NOT the "No recent data" empty state.
    expect(within(dialog).queryByText(/No recent data/i)).not.toBeInTheDocument()
    // (b) the modal's h2 finding matches the same Victorian finding the card showed.
    expect(within(dialog).getByRole('heading', { level: 2 }))
      .toHaveTextContent('Dwellings commenced fell 1.2% to 13,429 in Mar qtr 2026')
  })
})

// Task 2 (2026-08-03): every chart-detail modal now carries an always-on
// geography chip naming the ONE region the modal plots — REGION_BADGE/
// modalRegion from Task 1 (web/src/lib/geoBands.ts). Distinct from the
// per-card scopeNote chip (which is now removed from the modal's own
// caption row; ChartCard's card-level scopeNote chip is untouched).
describe('modal geography chip', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

  test('every modal names its geography: fixed:australia chart under melbourne shows Australia', async () => {
    // cash_rate is region_mode fixed:australia — a context-band chart under
    // the default (melbourne) geo, section 'Money & credit'.
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const money = await openSection('Money & credit')
    await userEvent.click(within(money).getByRole('button', { name: /RBA cash rate target — open details/i }))
    const dialog = await screen.findByRole('dialog', { name: /— Australia$/ })
    expect(within(dialog).getByText('Australia')).toBeInTheDocument()
  })

  test('a geo-scoped chart opened under melbourne shows Melbourne in the modal', async () => {
    // median_rent is region_mode geo, scope geo — 'Rents & vacancy'.
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const rents = await openSection('Rents & vacancy')
    await userEvent.click(within(rents).getByRole('button', { name: /Median weekly rent — open details/i }))
    const dialog = await screen.findByRole('dialog', { name: /— Melbourne$/ })
    expect(within(dialog).getByText('Melbourne')).toBeInTheDocument()
  })

  test('the modal caption no longer repeats the scopeNote chip', async () => {
    // auctions is region_mode fixed:melbourne with geos: [] (broken source,
    // no historical geo signal), so App's detailGeo fallback never overrides
    // the requested geo (see App.tsx's detailGeo comment) — opening it under
    // 'vic' keeps chartPoints' own scopeNote condition (r !== geo) true, the
    // exact case the old caption-row chip used to repeat. Deep-linked
    // (?s=), same pattern as the existing 'deep link opens the detail view'
    // test, so the modal opens regardless of the card's own grid/context/
    // hidden/absent band at this geo.
    history.replaceState(null, '', '/?s=auctions&geo=vic')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    const dialog = await screen.findByRole('dialog', { name: /— Melbourne$/ })
    // Exactly one region chip in the whole modal — the new one under the
    // headline — none left in the caption row.
    expect(within(dialog).getAllByText('Melbourne')).toHaveLength(1)
  })
})
