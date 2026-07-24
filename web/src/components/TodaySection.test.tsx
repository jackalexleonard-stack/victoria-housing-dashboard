import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData, type HeroTile, type NewsData } from '../lib/types'
import { TodaySection } from './TodaySection'
import { PALETTE } from '../theme/tokens'
import { tileValueGeoMatch } from '../lib/conveyor'

const site = assertSiteData(siteEdge)
const NOW = new Date('2026-07-18T00:00:00Z')
const news: NewsData = {
  schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
  items: [{ title: 'Rates on hold again', url: 'https://n/1', source: 'RBA',
            published: '2026-07-17', tags: ['policy'], image: null,
            dup_sources: ['The Age', 'ABC News'], score: 9.1 }],
  top_story_urls: ['https://n/1'], digest: 'Two-line digest.',
}

test('the lead card renders hero_lead\'s finding and opens its chart on click', async () => {
  const onOpen = vi.fn()
  render(<TodaySection site={site} news={news} now={NOW} onOpen={onOpen} geo="melbourne" />)
  // Fixture: hero_lead = "melb_rent" -> TILE_CHART.melb_rent = "median_rent"
  // -> findings.median_rent.
  const lead = screen.getByTestId('lead-finding')
  expect(lead.tagName).toBe('H2')
  expect(lead).toHaveTextContent('The median rent held at $580/wk in Mar qtr 2026')
  await userEvent.click(lead)
  expect(onOpen).toHaveBeenCalledWith('median_rent')
})

test('the lead card shows its compact value + delta under the sentence', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('$580/wk')).toBeInTheDocument()
  expect(within(card).getByText('+10/wk')).toBeInTheDocument()
})

test('two secondary finding cards render the next hero picks, excluding the lead', async () => {
  const onOpen = vi.fn()
  render(<TodaySection site={site} news={news} now={NOW} onOpen={onOpen} geo="melbourne" />)
  // Fixture hero order: cash_rate, melb_dwelling_values, melb_rent(lead),
  // oo_lending, mortgage_new -> excluding the lead, the next two in order
  // are cash_rate and melb_dwelling_values. Band-aligned headlinePool
  // (2026-07-24 amendment) restores this byte-for-byte at the melbourne
  // default — cash_rate qualifies badged ('Australia', at its own geo)
  // rather than first-class, but it renders at that own geo with the same
  // finding sentence it always carried, so the visible order/text is
  // unchanged from pre-migration.
  const secondaries = screen.getByTestId('secondary-findings')
  const headings = within(secondaries).getAllByRole('heading', { level: 3 })
  expect(headings).toHaveLength(2)
  expect(headings[0]).toHaveTextContent('The cash rate has held at 3.85% since Jan 2026')
  expect(headings[1]).toHaveTextContent(/Melb dwelling values rose 0.3%/)
  await userEvent.click(headings[0])
  expect(onOpen).toHaveBeenCalledWith('cash_rate')
})

// Band-aligned per-geo test data (2026-07-24 amendment): site.edge.json
// carries no regional_vic finding or points anywhere (every finding is
// keyed 'melbourne' or 'australia'; vic_rents' points are melbourne-only)
// — build the same synthetic shape conveyor.test.ts's Task 1 tests already
// use (a regional_vic finding + two regional_vic points for median_rent),
// so this exercises a real first-class-at-geo pool entry and a real
// latestForGeo value instead of an always-empty pool.
const siteRegional: typeof site = {
  ...site,
  findings: { ...site.findings,
    median_rent: { ...site.findings.median_rent,
      regional_vic: 'The median rent held at $410/wk in Mar qtr 2026' } },
  series: { ...site.series,
    vic_rents: { ...site.series.vic_rents, points: [...site.series.vic_rents.points,
      { date: '2025-12-31', region: 'regional_vic', metric: 'median_rent', value: 400 },
      { date: '2026-03-31', region: 'regional_vic', metric: 'median_rent', value: 410 },
    ] } },
}

test('non-default geo: the banner shows that geo\'s finding and value, never Melbourne\'s', () => {
  render(<TodaySection site={siteRegional} news={news} now={NOW} onOpen={() => {}} geo="regional_vic" />)
  const lead = screen.getByTestId('lead-finding')
  // Fixture (+ inline regional finding above): melb_rent's chart now
  // qualifies first-class at regional_vic, so it leads with its OWN
  // sentence, never the melbourne one.
  expect(lead).toHaveTextContent('The median rent held at $410/wk in Mar qtr 2026')
  const card = screen.getByTestId('lead-finding-card')
  // The value line is the regional latestForGeo number, not melbourne's.
  expect(within(card).getByText('$410/wk')).toBeInTheDocument()
  expect(within(card).queryByText('$580/wk')).not.toBeInTheDocument()
})

test('default geo, at-render-geo case: value line comes from the export tiles (melb_rent\'s own number)', () => {
  // Final-review note: the blanket "byte-identical default view" constraint
  // is superseded (user-approved 2026-07-24) for the vic_approvals/
  // au_dwelling_values fixes below — but melb_rent's OWN case is genuinely
  // unaffected: its export tile value (580) IS median_rent's melbourne
  // level, so tileValueGeoMatch classifies it 'at-render-geo' either way,
  // and the tri-state rule shows the export tile verbatim exactly as the
  // old fast path did. This test still pins that (unchanged) case.
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('$580/wk')).toBeInTheDocument()   // the existing pinned tile value
})

test('mis-format guard (\'none\' case): an hvi-style tile\'s export value never matches its own level', () => {
  // melb_dwelling_values pairs a MoM tile value (0.3) with an index-LEVEL
  // chart (hvi_index, latest melbourne level 178.7) — tileValueGeoMatch must
  // classify this 'none' (a different representation of its own chart, not
  // a cross-geo mismatch), which is what lets TodaySection's tri-state rule
  // still show it (entry.geo === chart.geos[0]) while never treating a
  // level number as if it were the tile's own MoM% at some OTHER geo. The
  // fixture's hvi chart has no non-melbourne geo (geos=['melbourne']), so
  // the omit-elsewhere branch is unreachable in production for this key
  // today — assert the classification itself directly (TodaySection's
  // value-line rule consults exactly this).
  expect(tileValueGeoMatch(site, 'melb_dwelling_values', 'melbourne')).toEqual({ kind: 'none' })
})

// Final-review regression tests (2026-07-24): the actual defects this batch
// fixes. site.edge.json predates this batch's real hero set and carries
// neither the 'approvals' nor 'hvi_australia' chart — extend fixture-shaped
// synthetic sites instead of inventing numbers. Every value below is copied
// verbatim from web/src/test/fixtures/site.real.json (charts 'approvals'/
// 'hvi_australia', series 'vic_approvals'/'au_hvi', their findings and hero
// tiles — read 2026-07-24; see conveyor.test.ts's tileValueGeoMatch
// describe block for the same data, unit-tested at the pure-function level).
const siteApprovals: typeof site = {
  ...site,
  charts: [...site.charts, {
    id: 'approvals', section: 'supply', title: 'Dwelling approvals',
    series_id: 'vic_approvals', metrics: null, region_mode: 'geo', scope: 'geo',
    geos: ['melbourne', 'regional_vic', 'vic', 'australia'],
    percent: false, markers: false, annotate: false,
  }],
  findings: { ...site.findings,
    approvals: { melbourne: 'Dwelling approvals fell 16.3% to 3,343 in May 2026' } },
  series: { ...site.series, vic_approvals: {
    status: 'ok' as const,
    meta: { source_name: 'ABS Building Approvals (BA_GCCSA)',
             source_url: 'https://data.api.abs.gov.au/rest/data/BA_GCCSA/1.1.9.1.110+150+100.10.2+2GMEL+2RVIC+AUS.M',
             frequency: 'monthly', last_fetched: '2026-07-24T01:10:51Z',
             last_changed: '2026-07-23T07:28:16Z', last_data_date: '2026-05-31',
             error: null, cadence_days: 31 },
    units: { approvals_dwellings_total: 'dwellings' },
    points: [
      { date: '2026-04-30', region: 'melbourne', metric: 'approvals_dwellings_total', value: 3996 },
      { date: '2026-05-31', region: 'melbourne', metric: 'approvals_dwellings_total', value: 3343 },
      { date: '2026-04-30', region: 'vic', metric: 'approvals_dwellings_total', value: 5204 },
      { date: '2026-05-31', region: 'vic', metric: 'approvals_dwellings_total', value: 4704 },
    ],
  } },
  // Real production hero.vic_approvals tile — the vic-wide figure (4,704),
  // paired (pre-fix) with Melbourne's own finding sentence above.
  hero: [site.hero[0], site.hero[1], site.hero[2],
    { key: 'vic_approvals', label: 'Vic dwelling approvals (mth)', value: 4704, delta: -500,
      delta_color: 'normal', last_date: '2026-05-31' },
    site.hero[4]],
  hero_lead: 'vic_approvals',
}

test('vic_approvals: the value line agrees with its own finding\'s number, never the vic-wide export figure', () => {
  // THE regression this whole batch exists for: on the default Melbourne
  // banner, vic_approvals used to pair the Melbourne finding ("fell 16.3% to
  // 3,343") with the Victoria-wide export tile value (4,704 -500) because
  // the old geo===DEFAULT_GEO fast path skipped the mis-format guard
  // entirely. tileValueGeoMatch classifies this 'other-geo' (the tile's
  // 4704 matches the chart's OWN 'vic' geo, not 'melbourne'), so the tri-
  // state rule reroutes to melbourne's own number (latestForGeo) instead.
  render(<TodaySection site={siteApprovals} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const lead = screen.getByTestId('lead-finding')
  expect(lead).toHaveTextContent('Dwelling approvals fell 16.3% to 3,343 in May 2026')
  const card = screen.getByTestId('lead-finding-card')
  // Melbourne's own approvals count (3,343 -> the same number named in the
  // finding above), and its own delta (3343 - 3996 = -653) — never the
  // vic-wide 4,704/-500 the export tile actually carries.
  expect(within(card).getByText('3,343')).toBeInTheDocument()
  expect(within(card).getByText('-653')).toBeInTheDocument()
  expect(within(card).queryByText('4,704')).not.toBeInTheDocument()
  expect(within(card).queryByText('-500')).not.toBeInTheDocument()
})

const siteAuHvi: typeof site = {
  ...site,
  charts: [...site.charts, {
    id: 'hvi_australia', section: 'prices', title: 'AU dwelling values',
    series_id: 'au_hvi', metrics: ['hvi_index'], region_mode: 'fixed:australia',
    scope: 'national', geos: ['australia'], percent: false, markers: false, annotate: true,
  }],
  findings: { ...site.findings,
    hvi_australia: { australia: 'AU dwelling values fell 0.6% in Jun 2026 (+6.1% over the year)' } },
  series: { ...site.series, au_hvi: {
    status: 'ok' as const,
    meta: { source_name: 'Cotality Home Value Index — 5-capital-city aggregate',
             source_url: 'https://www.cotality.com/au/our-data/indices',
             frequency: 'daily', last_fetched: '2026-07-24T01:11:03Z',
             last_changed: '2026-07-23T23:34:37Z', last_data_date: '2026-07-24',
             error: null, cadence_days: 3 },
    units: { hvi_index: 'index' },
    points: [
      { date: '2026-07-22', region: 'australia', metric: 'hvi_index', value: 221.69 },
      { date: '2026-07-24', region: 'australia', metric: 'hvi_index', value: 221.53 },
    ],
  } },
  // Real production hero.au_dwelling_values tile — a MoM% (-0.58, +6.13 yr),
  // never the AU hvi_index level (221.53).
  hero: [site.hero[0], site.hero[1], site.hero[2], site.hero[3],
    { key: 'au_dwelling_values', label: 'AU dwelling values (MoM)', value: -0.58, delta: 6.13,
      delta_color: 'normal', last_date: '2026-06-30' }],
  hero_lead: 'au_dwelling_values',
}

test('au_dwelling_values: the badge entry regains its MoM value/delta line (the binary guard used to drop it)', () => {
  // The old binary tileValueMatchesPrimary only ever checked chart.geos[0]
  // (here, 'australia') for a LEVEL match — au_dwelling_values' tile value
  // is a MoM% (-0.58), never the hvi_index level (221.53), so the guard
  // failed and the line was silently omitted. tileValueGeoMatch classifies
  // this 'none' (a representation, not a mismatch) — the tri-state rule
  // still shows the export tile's value/delta because entry.geo IS the
  // chart's own primary geo (chart.geos[0] === 'australia').
  render(<TodaySection site={siteAuHvi} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const lead = screen.getByTestId('lead-finding')
  expect(lead).toHaveTextContent('AU dwelling values fell 0.6% in Jun 2026 (+6.1% over the year)')
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('Australia')).toBeInTheDocument()   // scope badge
  expect(within(card).getByText('-0.6%')).toBeInTheDocument()
  expect(within(card).getByText('+6.1% yr')).toBeInTheDocument()
})

test('a context entry renders its own-geo finding with the scope badge (cash_rate under a Victorian geo)', () => {
  // cash_rate is national-scope; its one finding/points are keyed
  // 'australia' (pipeline/findings.py never replicates a national finding
  // per UI geo) — under regional_vic it enters band-aligned, badged
  // 'Australia', rendered at its own geo, exactly like the grid's "Wider
  // context" band. melb_rent (the plain, un-augmented fixture's hero_lead)
  // has no regional_vic finding here, so cash_rate leads.
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="regional_vic" />)
  const lead = screen.getByTestId('lead-finding')
  expect(lead).toHaveTextContent('The cash rate has held at 3.85% since Jan 2026')
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('Australia')).toBeInTheDocument()
})

test('badge entries render byte-identical value/delta text at the default geo (bypass-path regression guard)', () => {
  // Review follow-up (post-Task-2 approval; final-review note 2026-07-24: the
  // predicate this guards is now tileValueGeoMatch, not the retired
  // tileValueMatchesPrimary, but the regression it guards is unchanged). A
  // badge entry's entry.geo is its OWN fixed geo ('australia' for cash_rate/
  // mortgage_new), which is never DEFAULT_GEO ('melbourne') — so the old
  // `geo === DEFAULT_GEO` fast path never fired for a badge entry, even when
  // the PAGE's selected geo IS the default; badge entries always went
  // through the guard/latestForGeo path instead. Today that's numerically
  // identical to the export tile — cash_rate's chart has one geo
  // ('australia'), the same geo the badge renders at, so tileValueGeoMatch
  // classifies it 'at-render-geo' and the tri-state rule shows the export
  // tile verbatim — but nothing pinned that identity as rendered TEXT until
  // now. If this test ever fails after adding a new national-scope hero
  // tile, the fix is to special-case badge entries at the page's default
  // geo, NOT to weaken this pin: a silent value-line loss on the default
  // view is exactly the class of bug this whole batch exists to catch.
  const siteNoLead = { ...site, hero_lead: undefined }
  render(<TodaySection site={siteNoLead} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  // cash_rate leads here (see 'no hero_lead' test, above) — badged
  // 'Australia', entry.geo = 'australia'. Pinned from site.edge.json's
  // cash_rate hero tile (value 3.85, delta 0.0) via TILE_FMT.cash_rate.
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('3.85%')).toBeInTheDocument()
  expect(within(card).getByText('+0.00 pp')).toBeInTheDocument()
})

test('badge-entry DELTA comes from the export tile, not a recomputed series delta (final-review Item 2)', () => {
  // The test above pins cash_rate's delta as "+0.00 pp", but site.edge.json's
  // au_cash_rate series is flat (every point is 3.85) — latestForGeo would
  // ALSO compute a 0.00 delta from the raw series, so that pin can't tell
  // "the tri-state rule used the export tile's delta" apart from "the code
  // silently recomputed it from the series and got the same number by
  // coincidence". Diverge them here: keep the series flat (still a 3.85
  // level match, so tileValueGeoMatch still classifies 'at-render-geo') but
  // give the EXPORT tile an explicit non-zero delta (0.10) that the flat
  // series could never produce on its own. If a future change swaps the
  // 'at-render-geo' branch to recompute from latestForGeo instead of
  // reading tile.delta, this fails ("+0.00 pp" would render) — the tri-state
  // routing (not this pin) is what to revisit if that happens.
  const siteNoLead = { ...site, hero_lead: undefined,
    hero: [{ ...site.hero[0], delta: 0.10 }, ...site.hero.slice(1)] }
  render(<TodaySection site={siteNoLead} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('+0.10 pp')).toBeInTheDocument()
  expect(within(card).queryByText('+0.00 pp')).not.toBeInTheDocument()
})

test('the compact strip renders sentence-case labels with cadence codes moved to the delta line', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const strip = screen.getByTestId('hero-strip')
  // "Melb dwelling values (MoM)" -> label without the code...
  const label = within(strip).getByText('Melb dwelling values')
  expect(label.textContent).not.toMatch(/MoM/)
  // ...the code rides the delta line instead.
  expect(within(strip).getByText('+2.1% yr (MoM)')).toBeInTheDocument()
})

test('the compact strip is not forced upper-case (sentence case)', () => {
  const { container } = render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const strip = screen.getByTestId('hero-strip')
  expect(within(strip).getByText('RBA cash rate')).toBeInTheDocument()
  expect(container.querySelector('[data-testid="hero-strip"] .uppercase')).toBeNull()
})

test('the ERP tile renders in the strip after the five hero tiles, muted (delta_color off)', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const strip = screen.getByTestId('hero-strip')
  expect(within(strip).getByText('Resident population')).toBeInTheDocument()
  expect(within(strip).getByText('27,801,000')).toBeInTheDocument()
  const delta = within(strip).getByText('+78,600')
  expect(delta).toHaveStyle({ color: PALETTE.muted })   // 'off' delta_color
})

test('changed-this-week chips render deltas via TILE_FMT, coloured by delta_color', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const list = screen.getByTestId('whats-new')
  const oo = within(list).getByText('$1,020m').closest('button')!
  expect(within(oo).getByText('+2.0% qtr')).toBeInTheDocument()
})

test('a flat/off delta renders level-only colour, not a move', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const list = screen.getByTestId('whats-new')
  const vac = within(list).getByText('2.5%').closest('button')!
  const delta = within(vac).getByText('+0.0 pp')
  expect(delta).toHaveStyle({ color: PALETTE.muted })
})

test('changed-this-week caps at 6 chips with an "and N more" disclosure', async () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const list = screen.getByTestId('whats-new')
  expect(within(list).getAllByRole('listitem')).toHaveLength(6)
  const more = screen.getByRole('button', { name: 'and 2 more changes' })
  await userEvent.click(more)
  expect(within(list).getAllByRole('listitem')).toHaveLength(8)
  expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
})

test('changed-this-week strip sorts by score desc, nulls last, recency tiebreak among nulls', () => {
  // P0-2 (complete): recency alone used to decide order (changed_at desc).
  // Deliberately scramble that recency order against score so the test only
  // passes if score is actually driving the sort.
  const customWhatsNew: HeroTile[] = [
    { key: 'melb_vacancy', label: 'Rental vacancy — Melbourne', value: 2.51, delta: 0.0,
      delta_color: 'off', last_date: '2026-06-30', changed_at: '2026-07-10', score: 0.2 },
    { key: 'cash_rate', label: 'RBA cash rate', value: 3.85, delta: 0.0,
      delta_color: 'inverse', last_date: '2026-06-30', changed_at: '2026-07-15', score: 0.9 },
    { key: 'melb_rent', label: 'Median rent — Melbourne', value: 580, delta: 10,
      delta_color: 'normal', last_date: '2026-03-31', changed_at: '2026-07-08', score: null },
    { key: 'oo_lending', label: 'New loans — owner-occupier', value: 1020, delta: 2.0,
      delta_color: 'normal', last_date: '2026-06-30', changed_at: '2026-07-14', score: null },
  ]
  render(<TodaySection site={{ ...site, whats_new: customWhatsNew }} news={news} now={NOW}
                       onOpen={() => {}} geo="melbourne" />)
  const list = screen.getByTestId('whats-new')
  const rows = within(list).getAllByRole('listitem').map(li => li.textContent ?? '')
  // score desc first (cash_rate 0.9 > vacancy 0.2), THEN the two null-score
  // tiles, broken by changed_at desc (oo_lending 07-14 before melb_rent 07-08)
  // — the opposite of their array-declaration order above.
  expect(rows[0]).toMatch(/RBA cash rate/)
  expect(rows[1]).toMatch(/Rental vacancy/)
  expect(rows[2]).toMatch(/owner-occupier/)
  expect(rows[3]).toMatch(/Median rent/)
})

test('a stale-source chip badges its vintage inline instead of being excluded', () => {
  // Far enough past vic_rents' 92-day cadence (last_data_date 2026-03-31)
  // that its "failed" status actually trips the staleness gate.
  const later = new Date('2026-08-20T00:00:00Z')
  render(<TodaySection site={site} news={news} now={later} onOpen={() => {}} geo="melbourne" />)
  const list = screen.getByTestId('whats-new')
  const rentChip = within(list).getByText('$580/wk').closest('button')!
  expect(within(rentChip).getByText(/Mar qtr 2026/)).toBeInTheDocument()
})

test('no vintage badge when the source is fresh', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const list = screen.getByTestId('whats-new')
  const cashChip = within(list).getByText('3.85%', { selector: 'span.font-medium' }).closest('button')!
  expect(within(cashChip).queryByText(/2026$/)).not.toBeInTheDocument()
})

test('top stories render with outlet count and digest shows', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  expect(screen.getByText('Rates on hold again')).toHaveAttribute('href', 'https://n/1')
  expect(screen.getByText(/covered by 3 outlets/)).toBeInTheDocument()
  expect(screen.getByText('Two-line digest.')).toBeInTheDocument()
})

test('empty whats_new hides the strip entirely', () => {
  const siteNoChanges = { ...site, whats_new: [] }
  render(<TodaySection site={siteNoChanges} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  expect(screen.queryByText(/changed this week/i)).not.toBeInTheDocument()
})

test('dates render human-formatted, not raw ISO', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  expect(screen.getByText(/17 Jul 2026/)).toBeInTheDocument()   // top story published
  expect(screen.queryByText(/2026-07-17/)).not.toBeInTheDocument()
})

// Backlog cleanup: these explainers were hover-only `title=` attrs,
// unreachable by touch or keyboard — now a visible caption line, present
// in the accessible tree (not just on hover), matching the product's
// existing honest-caption idiom.
test('hero tiles carry a one-line explainer as visible text, not just a hover tooltip', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const strip = screen.getByTestId('hero-strip')
  expect(strip).not.toHaveAttribute('title')
  expect(within(strip).getByText("Today's most notable movements")).toBeInTheDocument()
})

test('top stories heading explainer is visible text, not just a hover tooltip', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const heading = screen.getByRole('heading', { name: 'Top stories' })
  expect(heading).not.toHaveAttribute('title')
  expect(screen.getByText('Ranked by source, topic and recency')).toBeInTheDocument()
})

test('no hero_lead: the conveyor leads with the first hero pick, no crash', () => {
  // 2.5: headlinePool degrades a missing/'empty' hero_lead to plain hero
  // order (same rule conveyor.test.ts asserts for the 'empty' sentinel) —
  // the conveyor rotates whenever findings exist, with or without an
  // explicit hero_lead, so the lead card now renders (leading with the
  // first hero pick, cash_rate) instead of being suppressed. Band-aligned
  // headlinePool (2026-07-24 amendment) restores this: cash_rate qualifies
  // badged at its own geo ('australia') rather than first-class, rendered
  // there with its real finding sentence — same visible text as before.
  const siteNoLead = { ...site, hero_lead: undefined }
  render(<TodaySection site={siteNoLead} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  expect(screen.getByTestId('lead-finding')).toHaveTextContent(/cash rate/)
  expect(screen.getByTestId('hero-strip')).toBeInTheDocument()
})

// --- 2.5 headline conveyor ---
// setup.ts stubs matchMedia with reduced-motion ON (deterministic DOM for
// every other test). Rotation tests need it OFF; afterEach restores ON.
const stubMotion = (reduced: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduced && q.includes('prefers-reduced-motion'),
    media: q, addEventListener: () => {}, removeEventListener: () => {},
  }))

describe('headline conveyor', () => {
  beforeEach(() => { stubMotion(false); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); stubMotion(true) })

  test('advances the lead finding after 5 s (conveyor: secondary-1 is promoted)', () => {
    render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
    expect(screen.getByTestId('lead-finding'))
      .toHaveTextContent('The median rent held at $580/wk in Mar qtr 2026')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByTestId('lead-finding'))
      .toHaveTextContent('The cash rate has held at 3.85% since Jan 2026')
  })

  test('the pause control stops auto-advance and flips to a resume control', () => {
    // fireEvent.click (not userEvent) — vitest@4 + user-event@14 fake-timer
    // clicks deadlock in this toolchain regardless of advanceTimers/delay
    // config (confirmed with a minimal repro unrelated to this component).
    render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause rotating findings' }))
    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByTestId('lead-finding')).toHaveTextContent(/median rent/)
    expect(screen.getByRole('button', { name: 'Resume rotating findings' })).toBeInTheDocument()
  })

  test('hovering pauses; leaving resumes', () => {
    render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
    fireEvent.mouseEnter(screen.getByTestId('headline-conveyor'))
    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByTestId('lead-finding')).toHaveTextContent(/median rent/)
    fireEvent.mouseLeave(screen.getByTestId('headline-conveyor'))
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByTestId('lead-finding')).toHaveTextContent(/cash rate/)
  })

  test('a dot jumps straight to its finding', () => {
    render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
    fireEvent.click(screen.getByRole('button', { name: 'Show finding 3 of 5' }))
    expect(screen.getByTestId('lead-finding')).toHaveTextContent(/Melb dwelling values rose 0.3%/)
  })

  test('detailOpen suspends rotation', () => {
    render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" detailOpen />)
    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByTestId('lead-finding')).toHaveTextContent(/median rent/)
  })

  test('reduced motion: no auto-advance, manual controls still work', () => {
    stubMotion(true)
    render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByTestId('lead-finding')).toHaveTextContent(/median rent/)
    fireEvent.click(screen.getByRole('button', { name: 'Show finding 2 of 5' }))
    expect(screen.getByTestId('lead-finding')).toHaveTextContent(/cash rate/)
  })
})

test('fewer than 3 findings: static row, no conveyor controls', () => {
  // Keep hero at 5 (assertSiteData requires it) but strip findings down to
  // two hero-resolving charts, so headlinePool yields a pool of 2 (< MIN_ROTATE).
  // hero keys -> chart: cash_rate->cash_rate, melb_dwelling_values->hvi_melbourne.
  // cash_rate qualifies band-aligned (badged 'Australia' at its own geo,
  // 2026-07-24 amendment) since its finding is keyed 'australia', not
  // 'melbourne' — same pool size/order as before that amendment.
  const small = assertSiteData({
    ...siteEdge,
    hero_lead: 'empty',
    findings: {
      cash_rate: (siteEdge as { findings: Record<string, Record<string, string>> }).findings.cash_rate,
      hvi_melbourne: (siteEdge as { findings: Record<string, Record<string, string>> }).findings.hvi_melbourne,
    },
  })
  render(<TodaySection site={small} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  expect(screen.getByTestId('lead-finding')).toHaveTextContent(/cash rate/)
  expect(screen.queryByTestId('conveyor-controls')).not.toBeInTheDocument()
})
