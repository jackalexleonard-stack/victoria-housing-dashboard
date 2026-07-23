# Geo scoping — design

**Date:** 2026-07-23 · **Status:** design approved (user), pending build
**Audit:** 10-agent geo-scoping audit (workflow `wf_e1ed3bd4-60d`), findings quoted below with file:line.

## 1. Context — what is actually wrong

The dashboard has a global geo selector (`melbourne | regional_vic | vic | australia`), but the data
is not scoped to it. The audit found four distinct defects.

**D1 — Headlines contradict their own charts (most severe).** `pipeline/findings.py:245-250` computes
each chart's serif headline ONCE, walking a hardcoded `melbourne → vic → australia` chain that
**omits `regional_vic` entirely**. The sentence is baked into the bundle (`export.py:207`) and
rendered verbatim regardless of the selected geo (`ChartCard.tsx:147,178-180`; modal `DetailView.tsx:86`;
and the chart's accessible label at `ChartCard.tsx:216`). Shipped contradictions at `geo=regional_vic`:
median_rent plots $470/wk under "…rose 2.7% to $575/wk"; vacancy plots 1.87% under "…held at 2.51%";
rent_growth plots 4.57% under "…rose 1.0 pp to 3.53%". The chart is right; the sentence above it is
wrong. For an audience that quotes these numbers, this is the priority defect.

**D2 — Silent substitution.** `web/src/lib/selectors.ts:50-56` resolves a chart's region by walking a
per-geo widening chain (`FALLBACK`, selectors.ts:10-15) and, failing that, falls through to
`?? regions[0]` — whichever region appears first in the exported points. `export.py:58-60` does not
sort, and every Victorian CSV is written Melbourne-first, so `regions[0]` is **always melbourne**.
Under `geo=vic`: rent_growth, median_rent, affordable_share, median_rent_by_type, vacancy all show
Melbourne. Under `geo=australia`: those five plus approvals. Sole disclosure is a neutral grey pill
with a bare region name and no verb (`ChartCard.tsx:233`).

**D2a** — `FALLBACK['australia'] = ['australia']` (selectors.ts:14) has no widening step, so
`approvals` — whose series carries a real `vic` aggregate (845 monthly obs back to 1956) — falls
straight to melbourne. The app shows Greater Melbourne's 3,343 approvals under an *Australia-wide*
selection while a valid Victoria line (4,704) sits unused in the same file.

**D3 — 17 of 27 charts ignore the selector and say nothing.** The `fixed:<region>` branch
(selectors.ts:47-49) filters on a literal region without ever reading `geo`, and `scopeNote` is
assigned in exactly one place — inside the `geo` branch (selectors.ts:54) — so `fixed:` charts carry
**zero** user-visible signal. Worst unlabelled cases: `land` titled "Greenfield land supply" is in
fact seven metro growth-area LGAs (`udp.py:107-111` hardcodes `region='melbourne'`); `activity` is
state-only.

**D4 — Nothing is ever hidden, and empty is misreported.** `App.tsx:239` filters charts by section
only; there is no geo predicate anywhere in the render tree, so all 27 charts mount in all 4 geos.
A chart resolving to zero lines renders a full-size dead card whose copy blames the SOURCE
(`ChartCard.tsx:181-184`), so a geography gap is misreported to the reader as an upstream outage.

## 2. The scoping model

Replace the per-chart `region_mode` string with two **pipeline-computed, data-driven** fields per chart:

- **`geos: string[]`** — the UI geos for which the chart has genuine data, derived at export time from
  the distinct regions actually present in the series (never hand-maintained, so it cannot drift).
- **`scope`** — one of:
  - `geo` — genuinely geo-specific (prices, rents, approvals, vacancy, land, population…)
  - `state` — exists only Victoria-wide; no metro/regional split is published (`activity`, `waitlist`)
  - `national` — no sub-national version exists (`cash_rate`, `mortgage_rates`, `credit`, `accord`, `hvi_australia`)
  - `global` — world context (`brent`, `aud_usd`, `ust10`, `iron_ore`, `copper`, `sawnwood`)

**Front-end rule (single predicate):** render a chart in the main grid iff the selected geo is in
`chart.geos`. No hardcoded chart lists in the UI.

**Two-band layout:**
- **Main grid** — only charts with real data for the selected geo. Selecting Regional Victoria means
  everything in the grid *is* regional.
- **"Wider context" band** below the grid — charts whose scope is broader than the selection, each
  badged with its true scope (*Victoria-wide* / *Australia* / *Global*).

Band membership by selection:

| Selected | Main grid | Wider context band |
|---|---|---|
| melbourne | charts with melbourne data | state + national + global |
| regional_vic | charts with regional_vic data | state + national + global |
| vic | charts with vic data (incl. `state` scope) | national + global |
| australia | charts with australia data (incl. `national` scope) | global |

`state`-scope charts join the main grid under `vic`; `national`-scope charts join it under `australia`.
`global` charts are never in the main grid — they are not any of the four geos.

## 3. Correctness fixes

- **Delete the `?? regions[0]` fallback** (selectors.ts:52) outright. No chart ever renders another
  region's data. Also delete the `FALLBACK` widening chains — widening IS substitution; band
  membership replaces it. A chart either has data for the geo (grid) or does not (hidden / context band).
- **Per-geo findings.** `findings[chartId]` becomes `findings[chartId][geo]`, computed for every geo
  the chart supports (`findings.py`), consumed by geo in `ChartCard`/`DetailView`. This is the root
  fix for D1. Charts hidden for a geo need no finding for it.
- **Empty-state honesty.** The source-blaming dead card stops being reachable via geography: a chart
  with no data for the selected geo is not rendered at all, so the dead card means only what it says
  (a genuine source failure).
- **Hidden-set footnote.** One collapsed line under the grid, data-driven. It lists exactly the
  charts that are **neither in the grid nor in the context band** — i.e. `scope: geo` charts with no
  data for the selected geo. Context-band charts (`state`/`national`/`global`) are still on screen and
  must NOT be footnoted. Example at `regional_vic`: *"Not published for Regional Victoria:
  commencements & completions, social-housing waitlist, construction input costs, daily dwelling
  values, auction clearance."*
- **Honest titles** where they currently mislead: `land` → "Greenfield land supply (Melbourne growth
  areas)". `credit` gains an explicit national qualifier.
- **Today section unchanged.** Its findings already suppress themselves when filters are active
  (2.5 behaviour) and hero tiles carry explicit labels, so Today is already honest. Out of scope.

## 4. Source work

Each source follows the project's standing rules: verify live → save a real fixture in
`tests/fixtures/` → parser → offline test → **one source = one module = one commit**, each fetcher
isolated in its own try/except in the orchestrator.

**Unlocks — data already present or already downloaded:**

| Gap | Change |
|---|---|
| Australia construction activity | `abs.py:88 _ACTIVITY_KEY` already requests `AUS` and the CSV holds 855 `australia` rows; the chart is merely hardcoded `fixed:vic` (`findings.py:117-119`). Unlock via the new `geos` model. |
| Victoria median rents (all 7 sheets) | The DFFH LGA workbook carries an explicit **Victoria** row (index 94) inside the `METRO NON-METRO` section the parser already scans, currently discarded. |
| Victoria affordable-lettings share | `Fig 8 source` header is `[None,'Victoria %','Metro %','Regional %']`; `dffh.py:155` reads only `{2:'melbourne', 3:'regional_vic'}` — column 1 is the statewide series. |

**Two-token ABS change:**

| Gap | Change |
|---|---|
| Australia dwelling approvals (fixes D2a) | Add `+AUS` to `_APPROVALS_KEY` (`abs.py:59`) **and** `'AUS': 'australia'` to `_REGION_GCCSA_VIC` (`abs.py:19`) — both halves required. |

**New fetches (all verified live during the audit):**

| Gap | Source |
|---|---|
| Regional Vic dwelling prices (regional has zero price data today) | ABS `RES_DWELL`: `GET /rest/data/RES_DWELL/1+2+3+4.2GMEL+2RVIC.Q`. `_REGION_GCCSA_VIC` already maps `2GMEL`/`2RVIC`. |
| Regional Vic greenfield land supply | Vic UDP package `urban-development-program-regional-greenfield-residential-land-2024`, WFS layer `open-data-platform:rgf2024` on the GeoServer already used. Broaden the anchored `_PKG_RE` (`udp.py:38`) and stop hardcoding `region='melbourne'` (`udp.py:107-111`). |
| Melbourne + Regional population / NOM / natural increase | ABS `ERP_COMP_SA_ASGS2021`: `GET /rest/data/ERP_COMP_SA_ASGS2021/10+9+6+3.GCCSA.2GMEL+2RVIC.A` (10=ERP, 9=NOM, 6=net internal, 3=natural increase). **Annual** — the existing `ERP_COMP_Q` is state-level only, so metro/regional population is annual by necessity. |
| Australia rents | ABS `CPI`: `GET /rest/data/CPI/1+3.115522+131186+20003.10.50+2.M`. REGION `50` = weighted average of eight capital cities (no `AUS` code exists). **This is an INDEX, not a median** — it must be labelled and charted as an index, never presented as comparable to the DFFH bond-based median. |
| Victoria construction cost index | ABS `PPI` with `TYPE=OUTPUT`: `GET /rest/data/PPI/1.1450001+1451374+1451550.OUTPUT.Q` (1450001 = "3011 House construction Victoria"). Same dataflow already called for the Melbourne INPUT index. |
| Victoria lending total | Derived: `HOUSING_PURPOSE='TOT'` exists only for `REGION=AUS`, so the Victorian total is owner-occupier + investor summed. Sum is valid here (both are dollar commitments). |
| Australia social housing | Productivity Commission RoGS 2026 Part G §18: `https://assets.pc.gov.au/2026-06/rogs-202606-partg-section18-housing-dataset_0.csv` (verified 200, 2,397 data rows, per-jurisdiction columns). |

**Derivation guardrail:** never sum or average across regions to synthesise a geo for medians, rates or
index values (a Victoria "median rent" is not the mean of metro and regional medians). Only additive
counts/dollars may be derived, and each derivation must be stated in the series metadata.

**Genuinely unfillable — hide, and name in the footnote** (verified against live APIs):
- *regional_vic*: commencements/completions (ABS `BUILDING_ACTIVITY` REGION is `CL_STATE` — 10 codes,
  no GCCSA), social-housing waitlist (Homes Vic publishes no geographic breakdown), construction input
  costs (no regional PPI), daily dwelling values (Cotality free feed is capitals-only), auction clearance.
- *vic*: rental vacancy rate and rent-index growth (DFFH publishes metro and regional only, no state aggregate).
- *australia*: rental vacancy (free machine-readable national series does not exist), bond-based median rents.
- *melbourne*: quarterly population components (`ERP_COMP_Q` is state-level), lending commitments
  (`LEND_HOUSING` is state-level max).

## 5. Testing

- **Pytest**: per-source parser tests against saved fixtures (offline); a test asserting the exported
  `geos` array matches the distinct regions in each series; a test that no derived series violates the
  derivation guardrail.
- **Vitest**: the render predicate (chart in grid iff geo ∈ chart.geos); band membership per geo for all
  four geos; per-geo finding selection; the footnote lists exactly the hidden set; **a regression test
  that no chart ever renders data from a region other than the selected geo** (the D2 guard).
- **Playwright**: switching geo changes which cards are present (not merely their contents); the
  Regional view contains no Melbourne-sourced figure; the context band is present and badged.
- Existing suites must stay green: 142 pytest / 256 vitest / e2e both projects / axe clean.

## 6. Rejected / deferred

Enrichments the audit surfaced that are **not** geo-honesty fixes (YAGNI — revisit on request):
regional SA4 approval decomposition (ABS `BA_SA2`), SRO first-home-buyer duty concessions,
Valuer-General property sales (redundant with `RES_DWELL`), and switching on the unused
`region_mode='all'` metro-vs-regional comparison branch (`selectors.ts:59-62`).

Also deferred: making the Today section geo-aware (already honest — it suppresses findings when
filters are active).
