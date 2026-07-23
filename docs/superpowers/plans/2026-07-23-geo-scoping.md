# Geo Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every geo selection (Melbourne / Regional Vic / Victoria / Australia) show only data genuinely relevant to it — no silent substitution, no contradictory headlines — hiding what isn't published and filling the gaps that free sources can close.

**Architecture:** The pipeline computes, per chart, a data-derived `geos` array (which UI geos the chart genuinely has data for) and a `scope` classification (`geo` | `state` | `national` | `global`). The front end applies one predicate — a chart is in the main grid iff the selected geo ∈ `chart.geos` — and puts broader-scope charts in a badged "Wider context" band below. Findings become per-geo, killing the headline/chart contradiction. New sources then widen `geos` automatically, with no UI change.

**Tech Stack:** Python 3.12 (pandas, requests) for the pipeline; React 19 + TS + Tailwind v4 front end; Vitest + Testing Library; Playwright.

**Spec:** `docs/superpowers/specs/2026-07-23-geo-scoping-design.md` (approved 2026-07-23).

## Global Constraints

- Repo `C:\Users\OEM\Schemes\housing dashboard` (path has a space — always quote). Branch `feature/geo-scoping` **already exists and the spec is committed on it** — do NOT create or switch branches.
- Python: never bare `python`. From repo root: `& ".\.venv\Scripts\python.exe" -m pytest -q` (PowerShell) — baseline **142 passed, 0 warnings**. Pipeline runs: `& ".\.venv\Scripts\python.exe" -m pipeline.run`.
- Frontend from `web/`: `npm test` (vitest, baseline 256), `npm run e2e` (Playwright, 2 projects), `npm run build`.
- **Source rules (standing project law, non-negotiable):** verify each source live BEFORE writing its parser; save a real response fixture in `tests/fixtures/`; parser tests run offline against fixtures; **one source = one module = one commit**; every fetcher runs isolated in its own try/except in the orchestrator; polite fetching (1 run/day, timeouts + retries). Never store news article text.
- **Derivation guardrail:** never sum or average across regions to synthesise a geo for medians, rates or index values. Only additive counts/dollars may be derived, and each derivation must be recorded in the series metadata.
- Tidy CSV schema is fixed: `date,region,metric,value,unit`. Region vocabulary: `melbourne | regional_vic | vic | australia | global`.
- UI geo enum (`web/src/lib/urlState.ts`): `melbourne | regional_vic | vic | australia`. `global` is NOT a UI geo.
- All colours via `theme/tokens.{css,ts}`; no new hardcoded hexes.
- Commit after every task, trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `pipeline/findings.py` | Chart registry (`CHARTS`), `scope` per chart, per-geo finding generation |
| `pipeline/export.py` | Derives `geos` from series data; emits `scope`/`geos`; export validation |
| `pipeline/sources/abs.py` | ABS SDMX fetchers (approvals, prices, population, CPI rents, PPI) |
| `pipeline/sources/dffh.py` | DFFH rental-report parsing (adds Victoria series) |
| `pipeline/sources/udp.py` | UDP land supply (adds regional package) |
| `pipeline/sources/rogs.py` | **new** — Productivity Commission RoGS social housing |
| `web/src/lib/types.ts` | `ChartSpec` gains `scope`/`geos`; `findings` becomes per-geo |
| `web/src/lib/selectors.ts` | Strict geo filtering — substitution deleted |
| `web/src/lib/geoBands.ts` | **new** — pure band-assignment + footnote logic |
| `web/src/App.tsx` | Two-band render, footnote |
| `web/src/components/ChartCard.tsx`, `DetailView.tsx` | Per-geo finding, scope badge |

---

# Phase A — Pipeline data contract

### Task 1: Emit `scope` and data-derived `geos` per chart

**Files:**
- Modify: `pipeline/findings.py` (`_c` signature + all 27 `_c(...)` calls)
- Modify: `pipeline/export.py:203-206` (chart dict emission), validation ~line 272-280
- Test: `tests/test_export.py` (add; create if absent)

**Interfaces:**
- Consumes: nothing new.
- Produces (every later task depends on these exact names):
  - Each chart dict gains `scope: str` ∈ `{"geo","state","national","global"}` and `geos: list[str]`.
  - `geos` is DERIVED at export from the series' actual regions ∩ the four UI geos, intersected with the chart's `region_mode` restriction. Never hand-written.
  - `pipeline/export.py` exposes `chart_geos(chart, load_series) -> list[str]`.

- [ ] **Step 1.1: Write the failing test — create/append `tests/test_export.py`**

```python
import pandas as pd
from pipeline.export import chart_geos

UI_GEOS = ["melbourne", "regional_vic", "vic", "australia"]


def _loader(rows):
    df = pd.DataFrame(rows, columns=["date", "region", "metric", "value", "unit"])
    return lambda _sid: df


def test_geos_are_derived_from_the_regions_actually_present():
    load = _loader([
        ("2026-01-31", "melbourne", "m", 1.0, "n"),
        ("2026-01-31", "regional_vic", "m", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": None}
    assert chart_geos(chart, load) == ["melbourne", "regional_vic"]


def test_geos_preserve_ui_geo_order_not_data_order():
    load = _loader([
        ("2026-01-31", "australia", "m", 1.0, "n"),
        ("2026-01-31", "melbourne", "m", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": None}
    assert chart_geos(chart, load) == ["melbourne", "australia"]


def test_a_fixed_region_chart_reports_only_that_region():
    load = _loader([
        ("2026-01-31", "melbourne", "m", 1.0, "n"),
        ("2026-01-31", "vic", "m", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "fixed:vic", "metrics": None}
    assert chart_geos(chart, load) == ["vic"]


def test_global_regions_never_appear_as_a_ui_geo():
    load = _loader([("2026-01-31", "global", "m", 1.0, "n")])
    chart = {"id": "c", "series_id": "s", "region_mode": "fixed:global", "metrics": None}
    assert chart_geos(chart, load) == []


def test_a_missing_or_empty_series_yields_no_geos():
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": None}
    assert chart_geos(chart, lambda _sid: None) == []


def test_metric_filtering_applies_before_region_derivation():
    # A region that only carries a metric this chart doesn't plot must not
    # count as coverage for the chart.
    load = _loader([
        ("2026-01-31", "melbourne", "wanted", 1.0, "n"),
        ("2026-01-31", "vic", "other", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": ["wanted"]}
    assert chart_geos(chart, load) == ["melbourne"]


def test_every_registry_chart_declares_a_valid_scope():
    from pipeline.findings import CHARTS
    valid = {"geo", "state", "national", "global"}
    for c in CHARTS:
        assert c["scope"] in valid, f"{c['id']} has invalid scope {c.get('scope')!r}"
```

- [ ] **Step 1.2: Run to verify it fails**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
& ".\.venv\Scripts\python.exe" -m pytest tests/test_export.py -q
```
Expected: FAIL — `ImportError: cannot import name 'chart_geos'`.

- [ ] **Step 1.3: Implement `chart_geos` in `pipeline/export.py`**

Add near the top of the module (after existing imports):

```python
# The four selectable geographies, in display order. `global` is deliberately
# absent: it is a data-side region token, never a UI selection.
UI_GEOS = ("melbourne", "regional_vic", "vic", "australia")


def chart_geos(chart: dict, load_series) -> list[str]:
    """The UI geos this chart genuinely has data for, derived from the series
    itself so it can never drift from reality. Metric filtering is applied
    first: a region that only carries metrics this chart doesn't plot is not
    coverage. Returns UI_GEOS order, not data order."""
    df = load_series(chart["series_id"])
    if df is None or len(df) == 0:
        return []
    if chart.get("metrics"):
        df = df[df["metric"].isin(chart["metrics"])]
    mode = chart.get("region_mode", "geo")
    if mode.startswith("fixed:"):
        df = df[df["region"] == mode.split(":", 1)[1]]
    present = set(df["region"].dropna().unique())
    return [g for g in UI_GEOS if g in present]
```

- [ ] **Step 1.4: Add `scope` to the registry**

In `pipeline/findings.py`, add `scope="geo"` to the `_c` signature and pass it through:

```python
def _c(id, section, title, series_id, *, metrics=None, region_mode="geo",
       scope="geo", percent=False, markers=False, annotate=False, noun=None,
       primary=None, note=None, modal_metrics=None, source_name=None):
```
and in the returned dict add `scope=scope,` alongside `region_mode=region_mode,`.

Extend the docstring with:
```
    scope: the FINEST geography this chart is ever available at —
    "geo" (metro/regional specific), "state" (Victoria-wide only; no
    metro/regional split is published), "national" (no sub-national version
    exists), "global" (world context). Drives band placement: a chart whose
    selected geo is absent from its derived `geos` is hidden-and-footnoted
    when scope=="geo", but shown in the badged context band otherwise.
```

Then set `scope=` on the non-`geo` charts (leave the rest at the default `"geo"`):
- `scope="state"` → `activity`, `waitlist`

**`activity` also needs `region_mode` changed from `"fixed:vic"` to `"geo"`.** `fixed:vic` pins the
chart to Victorian rows, so `chart_geos` can never see the `australia` rows already present in
`vic_activity.csv`, and Step 1.6's required `['vic','australia']` would be unreachable. This is
deliberate and is the fix for the audit defect "activity falls back to vic under australia
(MISLEADING)" — under the finished model the chart shows real national data when Australia is
selected, and sits in the context band (badged Victoria-wide, rendered at its own `vic` geo) under
Melbourne/Regional. Add a comment at the chart saying so, so it is not "tidied" back. `waitlist`
keeps `fixed:vic` — its series has only `vic` rows, so nothing is hidden by pinning it.
- `scope="national"` → `hvi_australia`, `accord`, `cash_rate`, `mortgage_rates`, `credit`
- `scope="global"` → `brent`, `aud_usd`, `ust10`, `iron_ore`, `copper`, `sawnwood`

- [ ] **Step 1.5: Emit both fields in the export**

In `pipeline/export.py`, the charts list currently emits a fixed key tuple (~line 203). Change it to include `scope` and the derived `geos`:

```python
        "charts": [{**{k: c[k] for k in ("id", "section", "title", "series_id",
                                         "metrics", "region_mode", "percent",
                                         "markers", "annotate", "note",
                                         "modal_metrics", "source_name")},
                    "scope": c["scope"],
                    "geos": chart_geos(c, ls)}
                   for c in CHARTS],
```
Keep whatever key tuple the file currently has — add `scope`/`geos` to it rather than retyping the existing keys from this plan (they may have drifted).

- [ ] **Step 1.6: Run tests + a real export**

```powershell
& ".\.venv\Scripts\python.exe" -m pytest tests/test_export.py -q
& ".\.venv\Scripts\python.exe" -m pytest -q
```
Expected: new tests PASS; full suite PASS (142 + new).

Then verify against real data:
```powershell
& ".\.venv\Scripts\python.exe" -c "import json;from pipeline.export import export_all;export_all();d=json.load(open('web/public/data/site.json'));print([(c['id'],c['scope'],c['geos']) for c in d['charts']])"
```
Expected, and CHECK THESE EXPLICITLY (they are the audit's ground truth):
- `approvals` → `['melbourne','regional_vic','vic']`
- `activity` → scope `state`, geos `['vic','australia']` (the australia rows are already in the CSV — this is the "free unlock")
- `land` → `['melbourne']`
- every world chart → `[]`
Report any chart whose `geos` is unexpectedly empty.

- [ ] **Step 1.7: Commit**

```powershell
git add pipeline/findings.py pipeline/export.py tests/test_export.py
git commit -m "feat(pipeline): emit per-chart scope + data-derived geos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Per-geo findings

**Files:**
- Modify: `pipeline/findings.py` (`_primary_frame`, `build_findings`, and each custom finding builder)
- Modify: `pipeline/export.py` validation (~line 276)
- Test: `tests/test_findings.py` (existing — extend)

**Interfaces:**
- Consumes: Task 1's `chart["scope"]`, `chart_geos`.
- Produces: `build_findings(load_series, load_meta) -> dict[str, dict[str, str]]` — chart id → geo → sentence. The exported `site.findings[chartId]` is now an OBJECT keyed by geo, not a string. Front-end tasks depend on this exact shape.

- [ ] **Step 2.1: Write the failing test — append to `tests/test_findings.py`**

```python
def test_findings_are_keyed_by_geo_and_use_that_geo_s_own_data(tmp_path):
    import pandas as pd
    from pipeline.findings import build_findings

    df = pd.DataFrame([
        ("2026-03-31", "melbourne", "median_rent", 575.0, "aud_per_week"),
        ("2026-06-30", "melbourne", "median_rent", 590.0, "aud_per_week"),
        ("2026-03-31", "regional_vic", "median_rent", 460.0, "aud_per_week"),
        ("2026-06-30", "regional_vic", "median_rent", 470.0, "aud_per_week"),
    ], columns=["date", "region", "metric", "value", "unit"])

    out = build_findings(lambda _s: df, lambda _s: {"frequency": "quarterly"})
    mr = out["median_rent"]
    assert set(mr) >= {"melbourne", "regional_vic"}
    # The regional sentence must quote the REGIONAL number, never Melbourne's.
    assert "470" in mr["regional_vic"]
    assert "590" not in mr["regional_vic"]
    assert "590" in mr["melbourne"]


def test_no_finding_is_produced_for_a_geo_the_chart_has_no_data_for():
    import pandas as pd
    from pipeline.findings import build_findings

    df = pd.DataFrame([
        ("2026-06-30", "melbourne", "median_rent", 590.0, "aud_per_week"),
    ], columns=["date", "region", "metric", "value", "unit"])
    out = build_findings(lambda _s: df, lambda _s: {"frequency": "quarterly"})
    assert "regional_vic" not in out["median_rent"]
```

- [ ] **Step 2.2: Run to verify it fails**

```powershell
& ".\.venv\Scripts\python.exe" -m pytest tests/test_findings.py -q
```
Expected: FAIL — findings are strings, so `out["median_rent"]` has no geo keys.

- [ ] **Step 2.3: Make `_primary_frame` geo-aware**

Replace the region-resolution block in `_primary_frame` (currently the
`melbourne → vic → australia` loop) with an explicit geo argument:

```python
def _primary_frame(chart: dict, load_series: Loader, geo: str) -> pd.DataFrame:
    df = load_series(chart["series_id"])
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=["date", "region", "metric", "value", "unit"])
    df = df[df["metric"] == chart["primary"]] if chart["primary"] else df
    mode = chart["region_mode"]
    if mode.startswith("fixed:"):
        df = df[df["region"] == mode.split(":", 1)[1]]
    else:
        # Exactly the requested geo — never a fallback. A geo with no rows
        # yields an empty frame, and the caller emits no finding for it.
        df = df[df["region"] == geo]
    df = df.dropna(subset=["value"]).copy()
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date")
```

Thread `geo` through every caller: `_generic(chart, load_series, load_meta, geo)` and each
custom builder that calls `_primary_frame`. Grep first so none is missed:
```powershell
Select-String -Path pipeline/findings.py -Pattern "_primary_frame|def _generic|def _hvi|def _accord"
```
Every function that takes `(chart, load_series, load_meta)` and reaches `_primary_frame` gains a
trailing `geo: str` parameter and passes it down.

- [ ] **Step 2.4: Make `build_findings` iterate geos**

`build_findings` currently maps chart id → sentence. Change it to map chart id → geo → sentence,
iterating the chart's own derived geos, and skipping any geo that produces no sentence:

```python
def build_findings(load_series: Loader, load_meta: Loader) -> dict[str, dict[str, str]]:
    from pipeline.export import chart_geos     # local import avoids a cycle
    out: dict[str, dict[str, str]] = {}
    for chart in CHARTS:
        per_geo: dict[str, str] = {}
        for geo in chart_geos(chart, load_series):
            sentence = _finding_for(chart, load_series, load_meta, geo)
            if sentence:
                per_geo[geo] = sentence
        out[chart["id"]] = per_geo
    return out
```
where `_finding_for` is the existing per-chart dispatch (the custom-builder lookup falling back to
`_generic`), now taking `geo` and passing it through. If the existing dispatch is inline in
`build_findings`, extract it to `_finding_for(chart, load_series, load_meta, geo) -> Optional[str]`
so the loop above stays readable.

- [ ] **Step 2.5: Update the export validation**

`pipeline/export.py` currently fails the export when a chart has no finding
(`if not site.get("findings", {}).get(cid): _fail(...)`). Under the per-geo model an empty dict is
legitimate ONLY when the chart has no geos at all (the world charts). Replace with:

```python
    for c in site.get("charts", []):
        cid, geos = c["id"], c.get("geos", [])
        f = site.get("findings", {}).get(cid)
        if not isinstance(f, dict):
            _fail(f"findings[{cid}] must be an object keyed by geo")
        missing = [g for g in geos if g not in f]
        if missing:
            _fail(f"findings[{cid}] missing geo(s): {missing}")
```
Keep the surrounding validation function's existing structure and `_fail` helper.

- [ ] **Step 2.6: Run tests + real export**

```powershell
& ".\.venv\Scripts\python.exe" -m pytest -q
& ".\.venv\Scripts\python.exe" -c "import json;from pipeline.export import export_all;export_all();d=json.load(open('web/public/data/site.json'));print(json.dumps(d['findings']['median_rent'],indent=1));print(json.dumps(d['findings']['vacancy'],indent=1))"
```
Expected: PASS. The printed `median_rent` object must show DIFFERENT sentences for `melbourne` and
`regional_vic` (this is the D1 fix — Melbourne ~$575/wk, Regional ~$470/wk). Report both sentences.

- [ ] **Step 2.7: Commit**

```powershell
git add pipeline/findings.py pipeline/export.py tests/test_findings.py
git commit -m "fix(pipeline): compute findings per geo (kills the headline/chart contradiction)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Phase B — Front end

### Task 3: Strict geo filtering + band logic

**Files:**
- Modify: `web/src/lib/types.ts` (`ChartSpec`, `SiteData.findings`)
- Modify: `web/src/lib/selectors.ts:10-15, 46-56` (delete FALLBACK + substitution)
- Create: `web/src/lib/geoBands.ts`
- Test: `web/src/lib/geoBands.test.ts`, `web/src/lib/selectors.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `scope`/`geos`, Task 2's per-geo findings.
- Produces:
  - `ChartSpec` gains `scope: string` and `geos: string[]`.
  - `SiteData.findings: Record<string, Record<string, string>>`.
  - `geoBands.ts` exports `type Band = 'grid' | 'context' | 'hidden'`, `bandFor(chart, geo): Band`, and `hiddenTitles(charts, geo): string[]`.
  - `chartPoints` no longer returns a substitution; `scopeNote` is retained ONLY as the context-band badge label.

- [ ] **Step 3.1: Write the failing test — create `web/src/lib/geoBands.test.ts`**

```ts
import { bandFor, hiddenTitles } from './geoBands'
import type { ChartSpec } from './types'

const chart = (over: Partial<ChartSpec>): ChartSpec => ({
  id: 'c', section: 's', title: 'T', series_id: 'sid', metrics: null,
  region_mode: 'geo', percent: false, markers: false, annotate: false,
  scope: 'geo', geos: [], ...over,
} as ChartSpec)

describe('bandFor', () => {
  test('a chart with data for the selected geo goes in the main grid', () => {
    expect(bandFor(chart({ scope: 'geo', geos: ['melbourne', 'regional_vic'] }), 'regional_vic'))
      .toBe('grid')
  })

  test('a geo-scope chart WITHOUT data for the selected geo is hidden, not substituted', () => {
    expect(bandFor(chart({ scope: 'geo', geos: ['melbourne'] }), 'regional_vic')).toBe('hidden')
  })

  test('a national chart is context under a Victorian geo but grid under australia', () => {
    const c = chart({ scope: 'national', geos: ['australia'] })
    expect(bandFor(c, 'melbourne')).toBe('context')
    expect(bandFor(c, 'regional_vic')).toBe('context')
    expect(bandFor(c, 'vic')).toBe('context')
    expect(bandFor(c, 'australia')).toBe('grid')
  })

  test('a state chart is grid under vic and context under metro/regional', () => {
    const c = chart({ scope: 'state', geos: ['vic', 'australia'] })
    expect(bandFor(c, 'vic')).toBe('grid')
    expect(bandFor(c, 'australia')).toBe('grid')
    expect(bandFor(c, 'melbourne')).toBe('context')
    expect(bandFor(c, 'regional_vic')).toBe('context')
  })

  test('a global chart is never in the grid — not even under australia', () => {
    const c = chart({ scope: 'global', geos: [] })
    for (const g of ['melbourne', 'regional_vic', 'vic', 'australia'] as const) {
      expect(bandFor(c, g)).toBe('context')
    }
  })
})

describe('hiddenTitles', () => {
  test('lists only hidden geo-scope charts — context-band charts are on screen', () => {
    const charts = [
      chart({ id: 'a', title: 'Vacancy', scope: 'geo', geos: ['melbourne'] }),
      chart({ id: 'b', title: 'Cash rate', scope: 'national', geos: ['australia'] }),
      chart({ id: 'c', title: 'Rents', scope: 'geo', geos: ['regional_vic'] }),
    ]
    expect(hiddenTitles(charts, 'regional_vic')).toEqual(['Vacancy'])
  })

  test('returns an empty list when nothing is hidden', () => {
    expect(hiddenTitles([chart({ scope: 'geo', geos: ['vic'] })], 'vic')).toEqual([])
  })
})
```

- [ ] **Step 3.2: Run to verify it fails**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard\web"
npx vitest run src/lib/geoBands.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement — create `web/src/lib/geoBands.ts`**

```ts
import type { ChartSpec } from './types'
import type { Geo } from './urlState'

// Where a chart belongs for the selected geo (spec §2). One predicate, no
// hardcoded chart lists: `geos` is derived by the pipeline from the data
// itself, so a chart can never claim a geography it doesn't have.
export type Band = 'grid' | 'context' | 'hidden'

export function bandFor(chart: ChartSpec, geo: Geo): Band {
  if (chart.geos.includes(geo)) return 'grid'
  // No data for this geo. A `geo`-scope chart is a genuine gap → hide it and
  // name it in the footnote. Anything broader (state/national/global) is
  // legitimate wider context → show it below, badged with its real scope.
  return chart.scope === 'geo' ? 'hidden' : 'context'
}

// The footnote's content: charts that are neither in the grid nor on screen
// as context — i.e. real gaps for this geography.
export function hiddenTitles(charts: ChartSpec[], geo: Geo): string[] {
  return charts.filter(c => bandFor(c, geo) === 'hidden').map(c => c.title)
}

// The badge a context-band chart carries, so it is never mistaken for the
// selected geography.
export const SCOPE_BADGE: Record<string, string> = {
  state: 'Victoria-wide', national: 'Australia', global: 'Global',
}
```

- [ ] **Step 3.4: Update the types**

In `web/src/lib/types.ts`, add to `ChartSpec` (after `region_mode`):
```ts
  scope: string; geos: string[]
```
and change the findings field on `SiteData` from `Record<string, string>` to
`Record<string, Record<string, string>>`. Update `assertSiteData`'s validation of `findings`
accordingly (it must accept an object-of-objects; keep the existing `bad()` helper style).

- [ ] **Step 3.5: Delete substitution from `selectors.ts`**

Remove the `FALLBACK` constant (lines 10-15) entirely. Replace the region-resolution block inside
`chartPoints` with:

```ts
  let scopeNote: string | null = null
  if (chart.region_mode.startsWith('fixed:')) {
    const r = chart.region_mode.slice(6)
    pts = pts.filter(p => p.region === r)
    // A fixed-region chart shown outside its own geography is context, and
    // must say so (previously it said nothing at all — audit D3).
    if (r !== geo) scopeNote = GEO_LABEL[r] ?? r
  } else if (chart.region_mode === 'geo') {
    // Strictly the selected geo. No widening, no `?? regions[0]` — a chart
    // with no rows for this geo renders nothing and is filtered out of the
    // grid upstream by bandFor() (audit D2).
    pts = pts.filter(p => p.region === geo)
  }
```

- [ ] **Step 3.6: Add the substitution regression test — append to `web/src/lib/selectors.test.ts`**

```ts
test('never renders another region\'s data when the selected geo is absent', () => {
  const site = {
    series: { s: { points: [
      { date: '2026-06-30', region: 'melbourne', metric: 'm', value: 575 },
    ], units: { m: 'aud' }, meta: {} } },
    metric_labels: {},
  } as unknown as Parameters<typeof chartPoints>[0]
  const chart = { id: 'c', series_id: 's', metrics: ['m'], region_mode: 'geo',
                  scope: 'geo', geos: ['melbourne'] } as unknown as Parameters<typeof chartPoints>[1]
  const { lines } = chartPoints(site, chart, 'all', 'regional_vic', new Date('2026-07-01'))
  expect(lines).toEqual([])   // must be empty, NOT Melbourne's 575
})
```
(Adjust the fixture shape to match whatever `selectors.test.ts` already uses — read it first and
follow its existing helper style rather than inventing a new one.)

- [ ] **Step 3.7: Run, then commit**

```powershell
npx vitest run src/lib/geoBands.test.ts src/lib/selectors.test.ts
npm test
```
Expected: PASS. Some App/ChartCard tests may fail to typecheck because findings changed shape —
that is expected and Task 5 fixes them; if `npm test` fails ONLY in those files, proceed.

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
git add web/src/lib/geoBands.ts web/src/lib/geoBands.test.ts web/src/lib/selectors.ts web/src/lib/selectors.test.ts web/src/lib/types.ts
git commit -m "feat(web): strict geo filtering + band assignment; delete silent substitution

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Two-band layout, footnote, and ALL nested-findings consumers

**Files:**
- Modify: `web/src/App.tsx` (section chart grid, ~line 239 onward)
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `bandFor`, `hiddenTitles`, `SCOPE_BADGE` from `geoBands.ts`.
- Produces: testids `context-band`, `geo-footnote`.

- [ ] **Step 4.1: Write the failing tests — append to `web/src/App.test.tsx`**

```tsx
describe('geo banding', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })

  async function openAll() {
    for (const t of screen.getAllByRole('button', { expanded: false })) await userEvent.click(t)
  }

  test('a chart with no data for the selected geo is not rendered in the grid', async () => {
    history.replaceState(null, '', '/?geo=regional_vic&sections=prices')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    // fixture: `land` has melbourne data only -> hidden under regional_vic
    expect(screen.queryByText(/Greenfield land supply/i)).not.toBeInTheDocument()
  })

  test('the footnote names the hidden charts for this geography', async () => {
    history.replaceState(null, '', '/?geo=regional_vic&sections=prices')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await openAll()
    const note = screen.getByTestId('geo-footnote')
    expect(note).toHaveTextContent(/not published for Regional Vic/i)
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
})
```
NOTE: the fixture `web/src/test/fixtures/site.edge.json` must be regenerated with `scope`/`geos`
and per-geo findings before these pass — do that in Step 4.3.

- [ ] **Step 4.2: Run to verify it fails**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard\web"
npx vitest run src/App.test.tsx -t "geo banding"
```
Expected: FAIL — no banding, no testids.

**COUPLING — read before starting.** Task 3 proved these cannot be split: migrating the fixtures to
the nested `findings[id][geo]` shape makes that value an OBJECT at runtime, and `App.tsx`,
`TodaySection.tsx` and `DetailView.tsx` still render `{finding}` directly — React then throws
"Objects are not valid as a React child" and 59 tests fail. So the fixture migration and EVERY
consumer update must land in this one task. The consumers are:
- `App.tsx` — grid + context band (below), and the DetailView lookup:
  `finding={site.findings[detailChart.id]?.[state.geo] ?? site.findings[detailChart.id]?.[detailChart.geos[0]] ?? ''}`
- `ChartCard.tsx` — takes `finding: string` (already resolved by App) and gains `scopeBadge?: string`,
  rendered beside the staleness chip via the existing `Chip`: `{scopeBadge && <Chip kind="neutral">{scopeBadge}</Chip>}`
- `DetailView.tsx` — takes the resolved string; no shape logic of its own.
- `TodaySection.tsx` — its conveyor LeadCard/SecondaryCard read `site.findings[chartId]` directly.
  Today is default-view-only, so resolve at the chart's own first geo:
  `site.findings[chartId]?.[chart.geos[0]] ?? ''` (look the chart up via the existing `TILE_CHART` map).

- [ ] **Step 4.3: Migrate the test fixtures**

`site.edge.json` and `site.real.json` predate `scope`/`geos`/per-geo findings. **Do NOT regenerate
them from the real export** — `site.edge.json` is a deliberately crafted edge-case fixture and
regenerating silently drops the edge cases other tests depend on. Migrate them IN PLACE:
- add `scope` per the `pipeline/findings.py` registry (`state` → activity, waitlist; `national` →
  hvi_australia, accord, cash_rate, mortgage_rates, credit; `global` → the six world charts; all
  others `geo`);
- add `geos`, derived from the regions actually present in that fixture's own series for that chart,
  in `melbourne, regional_vic, vic, australia` order (the `chart_geos` rule);
- convert `findings[id]` from a string to `{<that chart's first geo>: <the same string>}`, and `{}`
  when the chart has no geos.
Preserve every other byte — prefer a surgical text/bracket-span edit over a full JSON reserialise, so
unrelated formatting is untouched. Task 3 left a working script at
`<scratchpad>/migrate-fixtures.js` (its own report names the exact path); read it, satisfy yourself
it is correct, and reuse it or write your own. Do not commit the script.

- [ ] **Step 4.4: Implement the two bands in `App.tsx`**

Import at the top:
```tsx
import { bandFor, hiddenTitles, SCOPE_BADGE } from './lib/geoBands'
```
Replace the per-section chart selection (currently `const charts = site.charts.filter(c => c.section === id)`)
with a banded split, and render the context band after the grid:

```tsx
              {(() => {
                const sectionCharts = site.charts.filter(c => c.section === id)
                const grid = sectionCharts.filter(c => bandFor(c, state.geo) === 'grid')
                const context = sectionCharts.filter(c => bandFor(c, state.geo) === 'context')
                const hidden = hiddenTitles(sectionCharts, state.geo)
                return (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {grid.map((c, i) => {
                        const dangling = i === grid.length - 1 && (grid.length - 1) % 2 === 1
                        return (
                          <div key={c.id} className={i === 0 || dangling ? 'sm:col-span-2' : ''}>
                            <ChartCard site={site} chart={c} finding={site.findings[c.id]?.[state.geo] ?? ''}
                                       range={state.range} geo={state.geo} now={now}
                                       onOpen={openDetail} quietOutage={!!outageNotice} />
                          </div>
                        )
                      })}
                    </div>
                    {context.length > 0 && (
                      <div data-testid="context-band" className="mt-6">
                        <h3 className="text-xs text-faint uppercase tracking-wide mb-2">
                          Wider context</h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                          {context.map(c => {
                            // A context card is NOT about the selected geo — render it at its
                            // OWN primary geo, for both the data and the finding. Passing
                            // state.geo here would filter a region_mode='geo' context chart
                            // (e.g. `activity` under melbourne) down to zero rows and render
                            // an empty card that falsely reads as a source outage.
                            const own = (c.geos[0] ?? state.geo) as typeof state.geo
                            return (
                              <div key={c.id}>
                                <ChartCard site={site} chart={c}
                                           finding={site.findings[c.id]?.[own] ?? ''}
                                           range={state.range} geo={own} now={now}
                                           onOpen={openDetail} quietOutage={!!outageNotice}
                                           scopeBadge={SCOPE_BADGE[c.scope]} />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {hidden.length > 0 && (
                      <p data-testid="geo-footnote" className="text-xs text-faint mt-3">
                        Not published for {GEO_LABEL[state.geo] ?? state.geo}: {hidden.join(', ')}.
                      </p>
                    )}
                  </>
                )
              })()}
```
Import `GEO_LABEL` from `./lib/selectors` if not already imported. Keep the existing
`id === 'news'` / `id === 'world'` special-case branches ahead of this block exactly as they are —
this replaces only the default (chart-grid) branch.

- [ ] **Step 4.4b: Make section summaries geo-honest**

`pipeline/findings.py`'s `build_section_summaries_full` collapses its per-geo findings to ONE sentence
via `next(iter(per_geo.values()), None)` — i.e. Melbourne-first whenever Melbourne has data. Section
movers like `median_rent`, `vacancy`, `mean_price`, `approvals`, `lending` and `population` are all
`region_mode="geo"`, so that summary always quotes Melbourne regardless of the selected geo. Today the
only consumer is `WorldTiles.tsx` (World is geo-independent), so it is not yet visible — but it is the
same Melbourne-bias defect this whole project exists to remove, one level up, and it becomes live the
moment any non-World section summary is rendered beside the geo selector.

Fix it now rather than leaving the landmine: make `section_summaries` per-geo (`section → geo →
sentence`), mirroring `findings`, and update the single consumer:
```tsx
// web/src/components/WorldTiles.tsx — was site.section_summaries?.world
{site.section_summaries?.world?.[geo] ??
  Object.values(site.section_summaries?.world ?? {})[0]}
```
Update `export.py`'s section-summary validation to the nested shape, and add a pytest asserting a
section whose mover has both melbourne and regional_vic data yields DIFFERENT sentences for the two.

- [ ] **Step 4.5: Run and commit**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard\web"
npx vitest run src/App.test.tsx
npm test
```
Expected: PASS (ChartCard's `scopeBadge` prop lands in Task 5 — if the type errors, add the optional
prop to ChartCard's signature now as `scopeBadge?: string` and render it in Task 5).

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
git add web/src/App.tsx web/src/App.test.tsx web/src/test/fixtures/site.edge.json
git commit -m "feat(web): two-band geo layout (grid + wider context) with hidden-set footnote

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Turn on nested-findings validation

**Files:**
- Modify: `web/src/lib/types.ts` (`assertSiteData` findings check)
- Test: the file that currently tests `assertSiteData` — grep for it first

**Interfaces:**
- Consumes: Task 4 (every consumer reads `findings[id][geo]`; both fixtures migrated).
- Produces: `assertSiteData` rejects a flat `{chartId: sentence}` export.

**Why this is its own task:** Task 3 attempted this and had to revert — tightening the gate while the
renderers still expected strings broke 59 tests. It is only safe once Task 4 has landed. If Task 4 is
not committed, STOP and report rather than proceeding.

- [ ] **Step 5.1: Write the failing test**

Grep for the existing `assertSiteData` tests and follow that file's style. Add:

```ts
test('rejects the pre-geo flat findings shape', () => {
  const flat = { ...validSite, findings: { cash_rate: 'The cash rate held at 3.60%.' } }
  expect(() => assertSiteData(flat)).toThrow(/findings/)
})

test('accepts the nested per-geo findings shape', () => {
  const nested = { ...validSite, findings: { cash_rate: { australia: 'The cash rate held at 3.60%.' } } }
  expect(() => assertSiteData(nested)).not.toThrow()
})
```
Build `validSite` from the migrated `site.edge.json` fixture so the rest of the object is valid.

- [ ] **Step 5.2: Run to verify the reject test fails**

Run the focused test file. Expected: the reject test FAILS (the flat shape is currently accepted).

- [ ] **Step 5.3: Implement**

In `web/src/lib/types.ts`, extend the findings check in the existing `bad()` style:

```ts
  if (s.findings == null || typeof s.findings !== 'object' ||
      Object.values(s.findings).some(v => v == null || typeof v !== 'object')) {
    bad('findings')
  }
```

- [ ] **Step 5.4: Run everything**

From `web/`: `npm test`, then `npm run build`. Expected: all PASS, build clean. If ANY test outside
the assertSiteData test file breaks, a consumer or fixture was missed in Task 4 — report which; do
not adjust the test.

- [ ] **Step 5.5: Commit**

```
git add web/src/lib/types.ts <the assertSiteData test file>
git commit -m "feat(web): reject the pre-geo flat findings shape at the boundary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Phase C — Sources

**Every task in this phase follows the same law:** verify the source LIVE first (curl/python against
the real endpoint) → save the real response as a fixture in `tests/fixtures/` → write the parser →
offline test against the fixture → wire into `pipeline/run.py` inside its own try/except → run the
real pipeline once → **one commit**. Record any derivation in the series metadata.

After each source lands, `geos` widens automatically (Task 1) — no front-end change is ever needed.

**Shared test template.** The exact expected VALUES cannot be written here — they come from the
fixture each task fetches in its own Step 1, and inventing them would be fabrication. So every source
task writes this exact test SHAPE, filling the three marked literals from the fixture it just saved:

```python
def test_<source>_parses_the_fixture_into_tidy_rows_with_the_expected_regions():
    from pipeline.sources.<module> import <parse_fn>
    raw = (FIXTURES / "<fixture-file>").read_text(encoding="utf-8")   # or read_bytes for xlsx
    df = <parse_fn>(raw)

    # Schema is fixed law for every series in this repo.
    assert list(df.columns) == ["date", "region", "metric", "value", "unit"]
    # (1) The regions this source is being added FOR — the whole point of the task.
    assert set(df["region"]) == {<expected regions>}
    # (2) Metrics are the ones the chart will plot, nothing stray.
    assert set(df["metric"]) == {<expected metrics>}
    # (3) A spot value hand-verified against the fixture, so the test would fail
    #     if the parser mis-maps a column or an axis.
    row = df[(df.region == "<a region>") & (df.date == "<a date in the fixture>")
             & (df.metric == "<a metric>")]
    assert len(row) == 1 and row.iloc[0]["value"] == <the value read from the fixture>

    assert df["value"].notna().all()
    assert not df.duplicated(["date", "region", "metric"]).any()
```
Assertion (3) is mandatory: a test that only checks shape passes against a parser that reads the
wrong column. Read the value out of the saved fixture by hand (or print it) and pin it.

### Task 6: Australia dwelling approvals (fixes the worst fallback)

**Files:** Modify `pipeline/sources/abs.py:19,59`; Test `tests/test_abs.py`

- [ ] **Step 6.1** Verify live first:
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://data.api.abs.gov.au/rest/data/BA_GCCSA/1.1.9.1.110+150+100.10.AUS.M',headers={'Accept':'application/vnd.sdmx.data+csv'},timeout=60);print(r.status_code, len(r.text));print(r.text[:400])"
```
Expected: HTTP 200 with CSV rows carrying `REGION` = `AUS`. If this fails, STOP and report — do not
proceed on an unverified source.

- [ ] **Step 6.2** Write the failing test in `tests/test_abs.py`:
```python
def test_approvals_key_requests_the_national_aggregate():
    from pipeline.sources.abs import _APPROVALS_KEY, _REGION_GCCSA_VIC
    assert "AUS" in _APPROVALS_KEY
    assert _REGION_GCCSA_VIC["AUS"] == "australia"
```
Run it — expect FAIL.

- [ ] **Step 6.3** Implement BOTH halves (either alone is a silent no-op):
- `abs.py:59` — add `+AUS` to the REGION position of `_APPROVALS_KEY`
  (`...10.2+2GMEL+2RVIC+AUS.M`).
- `abs.py:19` — add `"AUS": "australia",` to `_REGION_GCCSA_VIC`.

- [ ] **Step 6.4** Run the offline tests, then refresh this series for real:
```powershell
& ".\.venv\Scripts\python.exe" -m pytest tests/test_abs.py -q
& ".\.venv\Scripts\python.exe" -m pipeline.run
& ".\.venv\Scripts\python.exe" -c "import pandas as pd;d=pd.read_csv('data/series/vic_approvals.csv');print(sorted(d.region.unique()))"
```
Expected: regions now include `australia`.

- [ ] **Step 6.5** Commit (`fix(pipeline): request the national aggregate for dwelling approvals`).

### Task 7: Victoria rents + affordable share (DFFH — data already downloaded)

**Files:** Modify `pipeline/sources/dffh.py`; Test `tests/test_dffh.py`; fixtures already exist

- [ ] **Step 7.1** Confirm the Victoria row/column exist in the CURRENT workbooks (the audit found
them at LGA-workbook row index 94 and `Fig 8 source` column 1, but the workbook rotates quarterly —
re-verify before coding):
```powershell
& ".\.venv\Scripts\python.exe" -c "from pipeline.sources import dffh;import openpyxl;wb=dffh.fetch_tables();ws=wb['Fig 8 source'];print([c.value for c in ws[1]])"
```
Expected header: `[None, 'Victoria %', 'Metro %', 'Regional %']`. Report what you actually see.

- [ ] **Step 7.2** Write the failing test using the **shared test template above** (expected regions
`{'vic','melbourne','regional_vic'}`; pin one Victoria value read from the fixture). Then implement:
- `dffh.py:155` — extend the Fig 8 column map from `{2: 'melbourne', 3: 'regional_vic'}` to
  `{1: 'vic', 2: 'melbourne', 3: 'regional_vic'}`.
- LGA workbook parse — accept the `Victoria` label in the `METRO NON-METRO` scan alongside Metro and
  Non-Metro, mapping it to region `vic`, for **all seven sheets**.
Do NOT derive Victoria by averaging metro and regional (guardrail — these are medians).

- [ ] **Step 7.3** Run offline tests + real pipeline; confirm `data/series/vic_rents.csv` now has
`vic` rows. Commit (`feat(pipeline): parse the published Victoria rent and affordability series`).

### Task 8: Regional Victoria dwelling prices (ABS RES_DWELL)

**Files:** Modify `pipeline/sources/abs.py`; Test `tests/test_abs.py`; new fixture

- [ ] **Step 8.1** Verify live:
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://data.api.abs.gov.au/rest/data/RES_DWELL/1+2+3+4.2GMEL+2RVIC.Q',headers={'Accept':'application/vnd.sdmx.data+csv'},timeout=60);print(r.status_code,len(r.text));open('tests/fixtures/abs_res_dwell.csv','w',encoding='utf-8').write(r.text)"
```
Expected 200 with both `2GMEL` and `2RVIC` rows. The fixture is saved by this command.

- [ ] **Step 8.2** Write the failing test using the **shared test template above** against
`tests/fixtures/abs_res_dwell.csv` (expected regions `{'melbourne','regional_vic'}`); then implement `res_dwell()` in `abs.py` following the existing
`abs_csv()` + `_tidy()` pattern. `_REGION_GCCSA_VIC` already maps `2GMEL`/`2RVIC`.

- [ ] **Step 8.3** Register the series in `pipeline/run.py` (own try/except) and add a chart to
`CHARTS` in `findings.py` — `_c("median_price", "prices", "Median dwelling price", "vic_res_dwell",
metrics=["median_price"], region_mode="geo", noun="The median dwelling price")`. Run the pipeline,
confirm the CSV, run pytest, commit.

### Task 9: Regional Victoria greenfield land supply (UDP)

**Files:** Modify `pipeline/sources/udp.py:38,107-111`; Test `tests/test_udp.py`

- [ ] **Step 9.1** Verify the regional package and layer exist live:
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://discover.data.vic.gov.au/api/3/action/package_search',params={'q':'urban development program regional greenfield','rows':20},timeout=60);print([p['name'] for p in r.json()['result']['results']])"
```
Expected: a name matching `urban-development-program-regional-greenfield-residential-land-<year>`.

- [ ] **Step 9.2** Write the failing test using the **shared test template above** (expected regions
`{'melbourne','regional_vic'}`), then implement: broaden `_PKG_RE` (`udp.py:38`) to match both
the metro and regional package names capturing which is which, and replace the hardcoded
`region='melbourne'` (`udp.py:107-111`) with the region implied by the package (metro→`melbourne`,
regional→`regional_vic`).

- [ ] **Step 9.3** Run pipeline, confirm `data/series/vic_land.csv` has both regions, pytest, commit.

### Task 10: Melbourne + Regional population (ABS ERP_COMP_SA_ASGS2021, annual)

**Files:** Modify `pipeline/sources/abs.py`; Test `tests/test_abs.py`; new fixture

- [ ] **Step 10.1** Verify live and save the fixture:
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://data.api.abs.gov.au/rest/data/ERP_COMP_SA_ASGS2021/10+9+6+3.GCCSA.2GMEL+2RVIC.A',headers={'Accept':'application/vnd.sdmx.data+csv'},timeout=60);print(r.status_code,len(r.text));open('tests/fixtures/abs_erp_gccsa.csv','w',encoding='utf-8').write(r.text)"
```
POP_COMP: 10=ERP, 9=NOM, 6=net internal migration, 3=natural increase.

- [ ] **Step 10.2** Write the failing test using the **shared test template above** (expected regions
`{'melbourne','regional_vic'}`), then the parser. **These are ANNUAL** — the metadata `frequency`
must be `annual`, distinct from the existing quarterly state series, and the chart must not imply
quarterly cadence. Add the metrics to the existing People section as a separate series
`vic_population_gccsa` rather than mixing cadences inside one series.

- [ ] **Step 10.3** Run, confirm, commit.

### Task 11: Australia rents (ABS CPI — INDEX, not a median)

**Files:** Modify `pipeline/sources/abs.py`; Test `tests/test_abs.py`; new fixture

- [ ] **Step 11.1** Verify live and save the fixture:
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://data.api.abs.gov.au/rest/data/CPI/1+3.115522+131186+20003.10.50+2.M',headers={'Accept':'application/vnd.sdmx.data+csv'},timeout=60);print(r.status_code,len(r.text));open('tests/fixtures/abs_cpi_rents.csv','w',encoding='utf-8').write(r.text)"
```
REGION `50` = weighted average of eight capital cities (there is NO `AUS` code on this flow).

- [ ] **Step 11.2** Implement as series `au_rents` with metric `rent_index` and unit `index`.
**Hard requirement:** the chart title and the series metadata must state this is a capital-cities
**index**, not a bond-based median, and it must NOT be added to the existing `median_rent` chart.
Add `_c("au_rent_index", "rents", "Rent price index — capital cities", "au_rents",
metrics=["rent_index"], region_mode="fixed:australia", scope="geo",
note="ABS CPI rents index for the weighted average of eight capital cities — an index, not a bond-based median; not comparable with the Victorian median rents above.")`.

- [ ] **Step 11.3** Run, confirm, commit.

### Task 12: Victoria construction cost index (ABS PPI OUTPUT)

**Files:** Modify `pipeline/sources/abs.py`; Test `tests/test_abs.py`; new fixture

- [ ] **Step 12.1** Verify live and save the fixture:
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://data.api.abs.gov.au/rest/data/PPI/1.1450001+1451374+1451550.OUTPUT.Q',headers={'Accept':'application/vnd.sdmx.data+csv'},timeout=60);print(r.status_code,len(r.text));open('tests/fixtures/abs_ppi_output_vic.csv','w',encoding='utf-8').write(r.text)"
```
1450001 = "3011 House construction Victoria".

- [ ] **Step 12.2** Emit as region `vic` with metrics distinct from the existing Melbourne INPUT
index (e.g. `output_house_construction`), in the same `vic_input_costs` series ONLY if the units
match; otherwise a new series `vic_construction_costs`. Input and output indexes are different
concepts — the chart/legend must distinguish them.

- [ ] **Step 12.3** Run, confirm, commit.

### Task 13: Victoria lending total (derived, additive)

**Files:** Modify `pipeline/sources/abs.py`; Test `tests/test_abs.py`

- [ ] **Step 13.1** Confirm live that `HOUSING_PURPOSE='TOT'` returns NoRecordsFound for `REGION=2`
(Victoria) but data for `AUS` — this is WHY the total must be derived:
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://data.api.abs.gov.au/rest/data/LEND_HOUSING/TOT.2.20.Q',headers={'Accept':'application/vnd.sdmx.data+csv'},timeout=60);print(r.status_code);print(r.text[:200])"
```

- [ ] **Step 13.2** Write a failing test asserting `lending_total` for region `vic` equals
owner-occupier + investor for the same date, then implement the derivation. **Guardrail compliance:**
this is a sum of dollar commitments (additive) — permitted. Record `"derived": "owner_occupier + investor"`
in the series metadata.

- [ ] **Step 13.3** Run, confirm, commit.

### Task 14: Australia social housing (Productivity Commission RoGS)

**Files:** Create `pipeline/sources/rogs.py`; Test `tests/test_rogs.py`; new fixture

- [ ] **Step 14.1** Verify live and save the fixture (974KB — save a trimmed slice if large):
```powershell
& ".\.venv\Scripts\python.exe" -c "import requests;r=requests.get('https://assets.pc.gov.au/2026-06/rogs-202606-partg-section18-housing-dataset_0.csv',timeout=120);print(r.status_code,len(r.content));open('tests/fixtures/rogs_housing.csv','wb').write(r.content)"
```

- [ ] **Step 14.2** Write the parser test against the fixture, then implement `rogs.py` emitting
series `au_social_housing` with regions `australia` and `vic` (the dataset carries per-jurisdiction
columns), metrics for social-housing dwellings and waiting lists. Follow the module pattern of an
existing file source (`worldbank.py`).

- [ ] **Step 14.3** Register in `run.py` (own try/except), add a chart in the `social` section, run
the pipeline, pytest, commit.

---

# Phase D — Integration

### Task 15: Honest titles, full verification, e2e

**Files:** Modify `pipeline/findings.py` (titles), `web/e2e/smoke.spec.ts`

**Interfaces:** Consumes everything above.

- [ ] **Step 15.1** Fix the misleading titles in `CHARTS`:
- `land`: Task 9 DID land regional data (`data/series/vic_land.csv` now has both `melbourne` and
  `regional_vic`). So: (a) **flip `region_mode` from `"fixed:melbourne"` to `"geo"`** — while it stays
  `fixed:melbourne`, `chart_geos` returns only `[melbourne]` and the regional rows sit dormant; the
  flip is what makes the chart a genuine metro-vs-regional pair. (b) Retitle to just
  `"Greenfield land supply"` (the Melbourne-only qualifier is now wrong). (c) Add a `note=` recording
  that the two regions are published on DIFFERENT cadences (metro annual to Dec; regional a half-year
  "Titled H1" snapshot to Jun) — Task 9 flagged this and it must be disclosed, not annualised away.
  Verify the export afterwards: `land` geos must become `['melbourne','regional_vic']`.
- `credit`: `"Housing credit growth"` → `"Housing credit growth (Australia)"`.

- [ ] **Step 15.2** Add the e2e guard — append to `web/e2e/smoke.spec.ts`:
```ts
test('switching geo changes which charts exist, and Regional shows no Melbourne figure', async ({ page }) => {
  await gotoDashboard(page, '/?geo=melbourne&sections=supply')
  await page.locator('section[aria-label="Supply & construction"]').waitFor()
  const melbCards = await page.locator('section[aria-label="Supply & construction"] article').count()
  await gotoDashboard(page, '/?geo=regional_vic&sections=supply')
  await page.locator('section[aria-label="Supply & construction"]').waitFor()
  const regionalCards = await page.locator('section[aria-label="Supply & construction"] article').count()
  // Card SET differs by geo — not merely the contents.
  expect(regionalCards).not.toBe(melbCards)
  // The footnote names what isn't published here.
  await expect(page.getByTestId('geo-footnote')).toContainText(/not published for Regional Vic/i)
})
```

- [ ] **Step 15.3** Full verification — ALL must be green:
```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
& ".\.venv\Scripts\python.exe" -m pipeline.run
& ".\.venv\Scripts\python.exe" -m pytest -q
cd web; npm test; npm run build; npm run e2e
```
Expected: pipeline runs with per-source isolation (any NEW source that fails live must fail
ISOLATED — exit code still 0 — and be reported, not silently swallowed); pytest ≥142; vitest ≥256;
e2e green on both projects; axe clean.

- [ ] **Step 15.4** Produce the final geo matrix for the report — for every chart, its `scope`,
`geos`, and band under each of the four geos:
```powershell
& ".\.venv\Scripts\python.exe" -c "import json;d=json.load(open('web/public/data/site.json'));[print(f\"{c['id']:<22}{c['scope']:<10}{','.join(c['geos'])}\") for c in d['charts']]"
```
Paste this into the task report — it is the evidence the geo work actually landed.

- [ ] **Step 15.5** Commit (`feat: honest chart titles + geo e2e guard`).

---

## Completion

After Task 15: whole-branch review, then merge to `main` (which redeploys via `update.yml`).
Post-deploy, live-verify on the production URL via the user's device — this machine's browser pane
cannot reach the Pages edge reliably.

**Known risk:** any of the Phase C sources may fail live despite audit verification (403s, rotating
URLs, schema drift — this repo has hit all three). The fallback for any source that cannot be made
to work is to drop that task, leave the gap, and let the chart stay hidden for that geo — the
Phase A/B honesty work stands on its own without any of Phase C.
