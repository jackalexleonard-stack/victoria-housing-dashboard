# Build brief: Victorian Housing Dashboard

You (Claude Code) are building an automated housing dashboard for a user in Melbourne, Australia. It tracks Victorian and national housing metrics plus international leading indicators, and aggregates housing news. It must run hands-off: scheduled fetches, self-updating front-end, zero infrastructure cost.

## Locked decisions — do not revisit
- **Granularity:** Metro Melbourne vs Regional Victoria (no LGA/suburb drill-down).
- **Cost:** $0 infrastructure. Free data sources only. No paid APIs, no servers, no databases.
- **Stack:** Python 3.11+ · GitHub Actions (scheduler) · CSVs committed to the repo (storage) · Streamlit (front-end, deployed on Streamlit Community Cloud).
  *Amended 2026-07-18:* the front-end half of this decision is superseded by Dashboard 2.0 — a React SPA on GitHub Pages, per `docs/superpowers/specs/2026-07-18-dashboard-2.0-design.md`. The Python/Actions/CSV pipeline decisions stand unchanged.
- **Repo is public** (all data is public anyway; free hosting tiers want this).

## Working rules for you
1. **Verify before you code.** Before writing any fetcher or parser, hit the live source, inspect the real structure, and save a sample response as a fixture in `tests/fixtures/`. Never invent ABS dataflow IDs, URLs, or spreadsheet layouts from memory — discover them live.
2. **One source, one module, one commit.** Each source gets its own module and its own small commit once its test passes.
3. **Isolation is sacred.** Every fetcher runs inside its own try/except in the orchestrator. One broken scraper must never block the other sources. Failures are logged, recorded in metadata, and the run continues.
4. **Fixtures make tests offline.** Parser tests run against saved fixtures, not the network.
5. **Be polite.** One scheduled run per day. Identify with a plain user-agent. Respect robots.txt on the scraped sources. Timeouts and modest retries on all requests.
6. **Never store article text** from news feeds — headline, link, date, source, tags only (copyright).
7. Pin dependencies in `requirements.txt`.

## Repo layout
```
housing-dashboard/
├── .github/workflows/update.yml      # daily cron
├── pipeline/
│   ├── run.py                        # orchestrator: runs all fetchers, isolated
│   ├── sources/                      # one module per source
│   │   ├── abs.py  rba.py  fred.py  cotality.py  reiv.py
│   │   ├── sqm.py  dffh.py  udp.py  homes_vic.py
│   │   ├── worldbank.py  auctions.py
│   │   └── news.py
│   └── common.py                     # fetch helpers, CSV writer, metadata
├── data/
│   ├── series/<series_id>.csv        # tidy data, one file per series
│   ├── meta/<series_id>.json         # source url/name, frequency, last_fetched, last_changed, status
│   └── news/items.jsonl              # rolling news items
├── app/streamlit_app.py              # the dashboard
├── tests/                            # parser tests + fixtures/
├── requirements.txt
└── README.md
```

## Data schema
Tidy long format, one CSV per series:
`date, region, metric, value, unit`
- `date`: ISO (use period-end dates for monthly/quarterly data)
- `region`: e.g. `melbourne`, `regional_vic`, `vic`, `australia`, `global`
- Append new observations; if a source revises history, overwrite the affected rows (git history preserves the old vintage — that's a feature, note it in the README).
- Update the series' `meta/*.json` on every run: `last_fetched` always, `last_changed` only when data actually changed, plus `status: ok|failed` and a short error string on failure.

## The 19 series

### Victoria
| ID | Series | Source · cadence | Method |
|---|---|---|---|
| vic_hvi | Dwelling values index & monthly change — Melbourne + Regional Vic | Cotality free monthly HVI release / chart pack (cotality.com/au) · monthly, ~1st of month | Parse release HTML or PDF |
| vic_median_price | Median house & unit price — metro vs regional | REIV quarterly medians (reiv.com.au) · quarterly | Scrape |
| vic_rents | Median rents by dwelling type + affordable lettings share — metro vs regional | DFFH / Homes Victoria Rental Report · quarterly | Find latest XLSX link on the report index page, download, parse |
| vic_vacancy | Rental vacancy rate — Melbourne | SQM Research free vacancy pages · monthly | Scrape |
| vic_approvals | Dwelling approvals — Vic: total, houses vs other; Greater Melbourne vs Rest of Vic | ABS Building Approvals · monthly | ABS Data API |
| vic_activity | Commencements, completions, under construction — Vic | ABS Building Activity · quarterly | ABS Data API |
| vic_input_costs | Input to the house construction industry PPI — Melbourne | ABS Producer Price Indexes · quarterly | ABS Data API |
| vic_land | Greenfield lots titled per year + years of supply | Urban Development Program datasets on data.vic.gov.au · annual | Download + parse |
| vic_auctions | Auction clearance rate — Melbourne | Cotality weekly auction article (fallback: Domain) · weekly | Scrape |
| vic_social_waitlist | Victorian Housing Register applications | Homes Victoria quarterly data · quarterly | Download + parse |

### National
| ID | Series | Source · cadence | Method |
|---|---|---|---|
| au_cash_rate | RBA cash rate target | RBA cash rate data (CSV/XLS on rba.gov.au) · per decision | Download |
| au_mortgage_rates | Housing lending rates — new & outstanding, fixed & variable | RBA statistical tables F5/F6 (stable XLSX URLs) · monthly | Download |
| au_lending | New loan commitments — owner-occupier / investor / first home buyer, national + Vic | ABS Lending Indicators · **quarterly** (it moved from monthly — do not expect monthly data) | ABS Data API |
| au_credit | Housing credit growth | RBA table D1/D2 · monthly | Download |
| au_hvi | National + combined capitals + combined regionals values | Cotality (same parse as vic_hvi) · monthly | Shared parser |
| au_population | Population growth + net overseas migration — national + Vic | ABS National, State and Territory Population · quarterly | ABS Data API |
| au_dwelling_stock | Dwelling stock count + mean dwelling price | ABS Total Value of Dwellings · quarterly | ABS Data API |
| au_accord | **Derived:** national quarterly completions vs Housing Accord target | Computed from vic_activity's national equivalent | Computed |

Accord definition: 1.2 million homes over the 5 years from 1 July 2024 → straight-line target of 60,000 completions/quarter. Store cumulative actual vs cumulative target.

### International
| ID | Series | Source · cadence | Method |
|---|---|---|---|
| intl_fred | Brent crude (DCOILBRENTEU), US 10-yr Treasury (DGS10), AUD/USD (DEXUSAL) | FRED API · daily | API — needs a free FRED API key |
| intl_commodities | Iron ore, copper, sawnwood (pick available columns) | World Bank Pink Sheet monthly XLSX (Commodity Markets page) · monthly | Download + parse |

FRED key: read from env var `FRED_API_KEY`; in Actions it's a repo secret. Document how to get one (free) in the README.

### ABS Data API notes
SDMX REST API, no key required. Discover the correct dataflow IDs and dimension keys via the API's dataflow/datastructure endpoints or the ABS Data Explorer — verify each one live and record the final request URL in the source module's docstring. Request seasonally adjusted series where available, original otherwise. For the Greater Melbourne vs Rest of Vic split use GCCSA-level geography where the dataflow provides it.

## News layer
- RSS via `feedparser`. Feeds (locate each feed URL — don't guess): The Age, ABC News, Guardian Australia, The Conversation, The Urban Developer, Cotality research/news, RBA media releases, Premier of Victoria.
- Plus two Google News catch-alls:
  `https://news.google.com/rss/search?q=housing+victoria+melbourne&hl=en-AU&gl=AU&ceid=AU:en`
  `https://news.google.com/rss/search?q=construction+costs+australia&hl=en-AU&gl=AU&ceid=AU:en`
- Dedupe by canonical URL. Keyword-tag each item into: prices · rents · supply/construction · policy · construction costs · international. Keep a rolling ~90 days in `items.jsonl`.
- Optional (Phase 3, only if `ANTHROPIC_API_KEY` env var is present): a short daily digest paragraph generated from the day's headlines, saved to `data/news/digest.md`. Must degrade silently to keyword-tags-only when no key.

## Scheduler
`.github/workflows/update.yml`:
- `schedule: cron "0 3 * * *"` (03:00 UTC ≈ 1pm AEST / 2pm AEDT — after the ABS 11:30am release window) + `workflow_dispatch` for manual runs.
- `permissions: contents: write`. Steps: checkout → setup-python → install → `python -m pipeline.run` → commit & push **only if `data/` changed** (skip empty commits).
- Rely on GitHub's default email notification for failed workflows; also make `run.py` exit non-zero if *every* source failed (single-source failures are logged but exit 0).

## Dashboard (`app/streamlit_app.py`)
- **Hero strip:** cash rate · Melbourne dwelling values monthly change · Vic approvals (latest month + 12-mo trend) · Accord run-rate vs target · Brent crude.
- **Tabs:** Victoria · National · International · News.
- Victoria tab has a Metro / Regional toggle applied across its charts.
- Every chart shows a staleness badge from the series metadata: "Data to Mar qtr 2026 · fetched 2 days ago", turning amber/red when the gap exceeds ~1.5× the series' normal cadence, and a source link.
- A failed/stale series renders its last good data with a warning — never a crash.
- News tab: filter by tag, newest first, headline links out; show the digest if present.
- Charts: Plotly or Altair. Keep the app a single file if reasonable.

## Phases & acceptance criteria

**Phase 1 — live skeleton (do this first, stop when done):**
API-backed sources only: abs, rba, fred + the derived Accord series (~12 series). Common fetch/write/metadata plumbing, orchestrator, workflow file, dashboard with hero strip + three data tabs on real data, README (setup, FRED key, Streamlit Community Cloud deploy steps, data vintage explanation).
✅ Done when: `python -m pipeline.run` succeeds locally; series CSVs + metadata validate against the schema; parser tests pass offline; a manual `workflow_dispatch` run is green and commits data; `streamlit run app/streamlit_app.py` shows real numbers.

**Phase 2 — files & news:**
dffh, udp, homes_vic, worldbank parsers (fixtures + tests) + the full news layer + News tab.
✅ Done when: those series render with staleness badges and the News tab shows tagged, deduped items.

**Phase 3 — scrapers & polish:**
cotality, reiv, sqm, auctions scrapers (each individually failure-isolated); optional Claude digest; release-calendar note on each tab (next expected update per series, derived from cadence + last data point).
✅ Done when: a deliberately broken scraper leaves the rest of the run green and the dashboard degrades gracefully.

## Out of scope (do not build)
Databases · paid data · LGA/suburb granularity · scraping paywalled article text · auth/user accounts · intraday scheduling.

## Manual steps for the user (list these in the README)
1. Create the GitHub repo and push.
2. Get a free FRED API key; add as repo secret `FRED_API_KEY`.
3. Connect the repo to Streamlit Community Cloud (one-time) and set the same env var there.
