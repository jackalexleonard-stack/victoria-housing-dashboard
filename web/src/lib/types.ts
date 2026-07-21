export interface Pt { date: string; region: string; metric: string; value: number }

export interface SeriesMeta {
  source_name: string | null; source_url: string | null
  frequency: string | null; last_fetched: string | null
  last_changed: string | null; last_data_date: string | null
  error: string | null; cadence_days: number
}

export interface SeriesEntry {
  status: 'ok' | 'failed'; meta: SeriesMeta
  units: Record<string, string>; points: Pt[]
}

export interface ChartSpec {
  id: string; section: string; title: string; series_id: string
  metrics: string[] | null; region_mode: string
  percent: boolean; markers: boolean; annotate: boolean
  note?: string | null
  // Extra series shown only in the detail modal — mixed-scale split charts
  // (credit, Accord) keep a secondary series set there. Optional: older
  // fixtures/exports without it stay valid.
  modal_metrics?: string[] | null
}

export interface HeroTile {
  key: string; label: string; value: number | null; delta: number | null
  delta_color: 'normal' | 'inverse' | 'off'; last_date: string | null
  changed_at?: string
  // whats_new-only (design review P0-2): export-time notability, the same
  // scoring.score_metric pick_hero itself uses — lets the "changed this
  // week" strip rank by more-than-recency. Never set on plain hero tiles.
  score?: number | null
}

// A small stat tile split out of a chart card for scale reasons (e.g. ERP
// population level, split from the People chart's NOM/natural-increase
// lines). `chart` names the card this tile's "view chart" action opens.
export interface ExtraTile {
  key: string; label: string; value: number | null; delta: number | null
  delta_color: 'normal' | 'inverse' | 'off'; last_date: string | null
  chart: string
}

export interface SiteData {
  schema_version: 1; generated_at: string
  sections: [string, string][]
  charts: ChartSpec[]; findings: Record<string, string>
  series: Record<string, SeriesEntry>
  hero: HeroTile[]; whats_new: HeroTile[]
  annotations: { cash_rate_moves: { date: string; delta: number }[]; accord_start: string }
  // Scan-batch additions (design review 2026-07-21) — all optional so the
  // current web build/runtime stay green until later tasks wire them in.
  hero_lead?: string
  extra_tiles?: ExtraTile[]
  metric_labels?: Record<string, string>
  section_summaries?: Record<string, string>
  // True when section_summaries[id] is the pipeline's own generic quiet/
  // no-data sentinel (T6: derived in Python where the sentinel is authored,
  // replacing sections.ts's old byte-match-the-prose approach).
  section_summary_quiet?: Record<string, boolean>
}

export interface NewsItem {
  title: string; url: string; source: string; published: string
  tags: string[]; image: string | null; dup_sources: string[]; score: number
}

export interface NewsHealth {
  feeds_ok: number; feeds_total: number; last_fetched: string | null
}

export interface NewsData {
  schema_version: 1; generated_at: string
  items: NewsItem[]; top_story_urls: string[]; digest: string | null
  health?: NewsHealth
}

function bad(detail: string): never {
  throw new Error(`unexpected data shape: ${detail}`)
}

export function assertSiteData(x: unknown): SiteData {
  const s = x as SiteData
  if (!s || typeof s !== 'object') bad('not an object')
  if (s.schema_version !== 1) bad(`schema_version ${String(s.schema_version)}`)
  if (!s.generated_at || typeof s.generated_at !== 'string') bad('generated_at')
  if (!s.series || typeof s.series !== 'object') bad('series')
  if (!Array.isArray(s.charts) || s.charts.length === 0) bad('charts')
  if (!s.findings || typeof s.findings !== 'object') bad('findings')
  if (!Array.isArray(s.hero) || s.hero.length !== 5) bad('hero')
  for (const [sid, e] of Object.entries(s.series)) {
    if (e.status !== 'ok' && e.status !== 'failed') bad(`status of ${sid}`)
    if (!Array.isArray(e.points)) bad(`points of ${sid}`)
    if (typeof e.meta?.cadence_days !== 'number') bad(`cadence of ${sid}`)
  }
  // Scan-batch fields are all optional — only type-check when present, so
  // older exports/fixtures without them stay valid.
  if (s.hero_lead != null && typeof s.hero_lead !== 'string') bad('hero_lead')
  if (s.extra_tiles != null && !Array.isArray(s.extra_tiles)) bad('extra_tiles')
  if (s.metric_labels != null && typeof s.metric_labels !== 'object') bad('metric_labels')
  if (s.section_summaries != null && typeof s.section_summaries !== 'object') {
    bad('section_summaries')
  }
  if (s.section_summary_quiet != null && typeof s.section_summary_quiet !== 'object') {
    bad('section_summary_quiet')
  }
  return s
}

export function assertNewsData(x: unknown): NewsData {
  const n = x as NewsData
  if (!n || typeof n !== 'object') bad('not an object')
  if (n.schema_version !== 1) bad(`news schema_version`)
  if (!Array.isArray(n.items)) bad('news items')
  if (!Array.isArray(n.top_story_urls)) bad('top_story_urls')
  // health is optional — older exports/fixtures without it stay valid; when
  // present, tolerate only the documented shape.
  if (n.health != null &&
      (typeof n.health.feeds_ok !== 'number' || typeof n.health.feeds_total !== 'number')) {
    bad('news health shape')
  }
  return n
}
