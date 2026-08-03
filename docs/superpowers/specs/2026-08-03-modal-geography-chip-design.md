# Always-visible geography in the chart modal

**Date:** 2026-08-03 · **Status:** user-approved (conversation, design message)
**Origin:** user feedback with screenshot — inside the chart popup there is no way to
tell what geography the data covers ("I know this is Victoria-wide data because it
told me before I opened it up, but once inside, it's not clear"). Applies to all
graphs.

## Facts the design rests on

- Every chart resolves to exactly ONE plotted geography in the modal: fixed-region
  charts (`region_mode: 'fixed:<r>'`) plot `<r>`; geo-scoped charts plot the geo the
  modal was opened at (App's `detailGeo`, which already falls back to the chart's own
  primary geo when it doesn't cover the selected one). There are no
  `region_mode: 'all'` charts.
- Two label vocabularies exist and disagree: cards' `SCOPE_BADGE` (state→
  "Victoria-wide", national→"Australia", global→"Global") vs `GEO_LABEL` (vic→
  "Victoria", australia→"Australia-wide"). The user reads the card vocabulary.

## Design

### 1. Canonical region badge map (`web/src/lib/geoBands.ts`)

```ts
export const REGION_BADGE: Record<string, string> = {
  melbourne: 'Melbourne', regional_vic: 'Regional Vic', vic: 'Victoria-wide',
  australia: 'Australia', global: 'Global',
}
```

Chosen to be IDENTICAL to the card badges where those exist (Victoria-wide /
Australia / Global) so pre-open and in-modal wording never differ. A unit test pins
the alignment: `SCOPE_BADGE.state === REGION_BADGE.vic`,
`SCOPE_BADGE.national === REGION_BADGE.australia`,
`SCOPE_BADGE.global === REGION_BADGE.global`.

### 2. Modal region resolution (pure, same file)

```ts
export function modalRegion(chart: ChartSpec, geo: Geo): string {
  return chart.region_mode.startsWith('fixed:')
    ? chart.region_mode.slice('fixed:'.length)
    : geo
}
```

### 3. DetailView chip — always rendered

- Directly under the modal's `<h2>` headline: a neutral `<Chip>` (inert span, NOT
  the clickable StatusChip) reading `REGION_BADGE[region] ?? region` where
  `region = modalRegion(chart, geo)`. Rendered unconditionally for every chart —
  no band, scope, or data-state exceptions. Hero tiles and World tiles open the
  same DetailView, so they are covered automatically.
- The dialog's accessible name gains the label:
  `aria-label={`${chart.title} — ${label}`}`.
- The existing `scopeNote` chip in DetailView's caption row is REMOVED — the new
  always-on chip is a superset of the information it carried (it only rendered for
  fixed-region charts outside their own geo). ChartCard's own scopeNote chip is
  untouched.
- Carve-out (fix batch, 2026-08-03): the chip — and the aria-label suffix — is
  suppressed for a dead chart (`isDeadChart`) whose `region_mode` is `'geo'` and
  `geos` is `[]` (e.g. `reiv_median`: coverage genuinely unknown, rendered at
  every geo by `bandFor`'s dead-chart override). Naming whatever geo the filter
  happened to be on would assert evidence this chart doesn't have. The aria
  suffix also dedupes when `chart.title` already ends with `` ` — ${regionLabel}` ``
  (e.g. "Auction clearance — Melbourne") so the accessible name never doubles it.

### 4. Compare-line region suffix

When the compare chart's `modalRegion(cmpChart, geo)` differs from the primary's,
the compare overlay line is renamed
`` `${cmpChart.title} — ${REGION_BADGE[cmpRegion] ?? cmpRegion}` `` (em-dash
separator, matching the app's idiom). The suffixed name must be used
CONSISTENTLY: the line name, the `unitByName` key for the compare unit, and
therefore the legend, tooltip rows, and the CSV export header all carry it —
a cross-geography comparison can never silently read as same-place data. When
regions match, the name stays the bare title (no noise).

## Testing

- vitest: `modalRegion` (fixed + geo paths), REGION_BADGE↔SCOPE_BADGE alignment
  pins; App-level modal assertions — a `fixed:australia` chart opened under
  melbourne shows "Australia"; a geo chart opened under melbourne shows
  "Melbourne"; approvals-style chart at vic shows "Victoria-wide"; scopeNote chip
  no longer renders in the modal caption; compare with a cross-region chart shows
  the suffixed legend/table name and same-region compare stays bare.
- e2e (time-independent): extend the existing modal-opening spec — open a modal,
  assert a chip with one of the five canonical labels is visible inside the
  dialog; open the cash-rate modal specifically and assert "Australia".

## Non-goals

- Chart titles and findings sentences unchanged (per-geo prose; the chip carries
  the geography).
- Card badges (`SCOPE_BADGE`) unchanged; `GEO_LABEL` unchanged (tooltip/legend
  vocabulary for in-chart region lines stays as is).
- No pipeline/export changes.

## Rollout

Feature branch `feature/modal-geo-chip` → subagent-driven TDD → whole-branch
review → merge --no-ff → CI + Pages deploy via update.yml → live verification via
run conclusion (never the local browser pane).
