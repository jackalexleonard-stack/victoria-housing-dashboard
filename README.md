# Victorian Housing Dashboard

An automated, zero-infrastructure dashboard tracking Victorian and national
housing metrics plus international leading indicators. It runs hands-off:
GitHub Actions fetches the data once a day, commits the tidy CSVs back to the
repo, and a Streamlit app renders them — no servers, no databases, no paid APIs.

**Granularity:** Metro Melbourne vs Regional Victoria (no LGA/suburb drill-down).
**Cost:** $0 — free public data sources only.
**Stack:** Python 3.11+ · GitHub Actions (scheduler) · CSVs committed to the repo
(storage) · Streamlit (front-end).

> **Status: Phase 2 complete** — the API-backed sources (ABS, RBA, FRED) and the
> derived Housing Accord series (Phase 1), plus the file-based sources (DFFH rents,
> UDP greenfield land, Homes Victoria waitlist, World Bank commodities) and the
> tagged, deduped news layer (Phase 2). The scrapers (Cotality, REIV, SQM, auction
> clearances) and the optional daily news digest arrive in Phase 3.

## The data (16 series + news)

**Phase 1 — API-backed**

| Series | What | Source · cadence |
|---|---|---|
| `vic_approvals` | New dwelling approvals — houses / other / total, Metro vs Regional | ABS Building Approvals `BA_GCCSA` · monthly |
| `vic_activity` | Dwellings commenced / completed / under construction — Vic + national | ABS Building Activity `BUILDING_ACTIVITY` · quarterly |
| `vic_input_costs` | House-construction input price index — Melbourne (all groups + materials) | ABS Producer Price Indexes `PPI` · quarterly |
| `au_lending` | New housing loan commitments — OO / investor / FHB / total, Vic + national | ABS Lending Indicators `LEND_HOUSING` · quarterly |
| `au_population` | Resident population, growth, net overseas migration, natural increase — Vic + national | ABS `ERP_COMP_Q` · quarterly |
| `au_dwelling_stock` | Number of dwellings + mean dwelling price — Vic + national | ABS Total Value of Dwellings `RES_DWELL_ST` · quarterly |
| `au_cash_rate` | RBA cash rate target | RBA table F1.1 · monthly |
| `au_mortgage_rates` | Housing lending rates — new/outstanding × variable/fixed/all (owner-occupier) | RBA table F6 · monthly |
| `au_credit` | Housing credit growth — total / OO / investor (monthly & 12-month) | RBA table D1 · monthly |
| `intl_fred` | Brent crude, US 10-year Treasury, AUD/USD | FRED API · daily |
| `au_accord` | Cumulative national completions vs the Housing Accord target | Derived from Building Activity · quarterly |

**Phase 2 — file-based downloads**

| Series | What | Source · cadence |
|---|---|---|
| `vic_rents` | Rent-index annual growth, affordable-lettings share, median rents by dwelling type — Metro vs Regional | DFFH / Homes Victoria Rental Report (XLSX) · quarterly |
| `vic_land` | Greenfield lots titled, remaining lot supply, years of supply — Melbourne growth corridors | UDP greenfield layer on data.vic.gov.au (WFS) · annual |
| `vic_social_waitlist` | Victorian Housing Register applications — Priority Access / Register of Interest / Total | Homes Victoria (VHR page) · quarterly |
| `intl_commodities` | Iron ore, copper, sawnwood | World Bank "Pink Sheet" (XLSX) · monthly |

**Phase 2 — news** (`data/news/items.jsonl`): housing-relevant headlines from The
Age, ABC, Guardian Australia, The Conversation, the RBA, plus The Urban Developer,
Cotality and the Premier of Victoria via Google News, and two Google News catch-alls.
Keyword-tagged (prices / rents / supply_construction / policy / construction_costs /
international), deduped by canonical URL then headline, rolling ~90 days. Only the
headline, link, date, source and tags are stored — never article text (copyright).

Each source lives in its own module under `pipeline/sources/`, was verified
against the live source before its parser was written, and has a saved response
fixture plus an offline parser test.

> **A note on user-agents.** A few Victorian-government sites
> (`dffh.vic.gov.au`, `homes.vic.gov.au`) block non-browser User-Agents, so those
> two sources send a standard browser UA. Every source is otherwise polite: one
> scheduled run per day, `robots.txt` respected, timeouts + modest retries.

## Repo layout

```
pipeline/
  run.py            # orchestrator: runs every source in isolation
  common.py         # fetch/retry, tidy-CSV writer, metadata, the Series runner
  sources/          # abs.py  rba.py  fred.py  accord.py  (one module per source)
data/
  series/<id>.csv   # tidy long data, one file per series
  meta/<id>.json    # source url/name, frequency, last_fetched, last_changed, status
app/streamlit_app.py
tests/              # offline parser tests + fixtures/
.github/workflows/update.yml
```

### Data schema

Tidy long format, one CSV per series: `date, region, metric, value, unit`.

- `date` — ISO, period-end (last day of the month/quarter for periodic series).
- `region` — `melbourne`, `regional_vic`, `vic`, `australia`, or `global`.
- New observations are appended; if a source revises history the affected rows
  are overwritten. **Git history preserves every past vintage** — you can always
  `git log`/`git blame` a CSV to see what a number was on a given day. That's a
  feature: revisions and the "data as first published" are both recoverable.
- Each series' `meta/*.json` records `last_fetched` (every run), `last_changed`
  (only when the data actually changed), `last_data_date`, `status` and an error
  string on failure. The dashboard turns a chart's badge amber/red when the data
  ages past ~1.5× / 2.5× its normal cadence.

## Run it locally

```bash
# 1. Create a virtual environment and install pinned deps
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt

# 2. Add your free FRED API key (see below)
cp .env.example .env          # then edit .env and paste your key

# 3. Fetch the data
python -m pipeline.run        # writes data/series/*.csv and data/meta/*.json

# 4. Launch the dashboard
streamlit run app/streamlit_app.py   # opens http://localhost:8501

# Tests (offline — run against saved fixtures, no network)
python -m pytest -q
```

`python -m pipeline.run` runs each source in its own try/except, so one broken
source never blocks the others; failures are logged and recorded in metadata and
the run continues. It exits non-zero only if *every* source fails.

## FRED API key (free)

The international indicators come from FRED and need a free API key.

1. Create a free account and request a key at
   <https://fred.stlouisfed.org/docs/api/api_key.html>.
2. Locally: copy `.env.example` to `.env` and set `FRED_API_KEY=...`
   (`.env` is gitignored — never commit it).
3. In GitHub Actions: add it as a repository secret named `FRED_API_KEY`.

ABS and RBA need no key. If the FRED key is missing, only `intl_fred` fails; the
rest of the dashboard still updates.

## Deploy (hands-off, $0)

1. **Create a public GitHub repo and push this project.** A public repo is
   required by the free hosting tiers (all the data is public anyway).
2. **Add the FRED key as a repo secret** named `FRED_API_KEY`
   (Settings → Secrets and variables → Actions).
3. **Connect the repo to [Streamlit Community Cloud](https://streamlit.io/cloud)**
   (one-time): New app → pick this repo → main file `app/streamlit_app.py`.
   The dashboard redeploys automatically whenever Actions commits new data.

The scheduler (`.github/workflows/update.yml`) then runs daily at 03:00 UTC
(~1–2 pm Melbourne, after the ABS morning release window) and on demand via
**Actions → Update housing data → Run workflow**. It commits `data/` only when
something changed. GitHub emails you if a run fails.

## Roadmap

- **Phase 1** ✅ — API-backed sources (ABS, RBA, FRED) + derived Housing Accord.
- **Phase 2** ✅ — DFFH rents, UDP greenfield land, Homes Victoria waitlist, World
  Bank commodities, and the housing-news layer (tagged, deduped RSS + News tab).
- **Phase 3** — Cotality/REIV/SQM/auction scrapers (each failure-isolated), an
  optional Claude-generated daily news digest (`data/news/digest.md`, shown on the
  News tab when present), and a next-release calendar note per series.
