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
}

export interface HeroTile {
  key: string; label: string; value: number | null; delta: number | null
  delta_color: 'normal' | 'inverse' | 'off'; last_date: string | null
  changed_at?: string
}

export interface SiteData {
  schema_version: 1; generated_at: string
  sections: [string, string][]
  charts: ChartSpec[]; findings: Record<string, string>
  series: Record<string, SeriesEntry>
  hero: HeroTile[]; whats_new: HeroTile[]
  annotations: { cash_rate_moves: { date: string; delta: number }[]; accord_start: string }
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
