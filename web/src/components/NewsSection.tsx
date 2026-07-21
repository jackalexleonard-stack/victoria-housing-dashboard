import { useState } from 'react'
import { ago, newsByline } from '../lib/format'
import type { NewsData, NewsItem } from '../lib/types'

// Mirrors pipeline/scoring.py's TAG_VALUE weighting order — an item's group
// is whichever of its tags ranks highest here (ties broken by this fixed
// order); an item with none of these tags falls into "other".
const PRIORITY = ['policy', 'prices', 'rents', 'supply_construction',
                  'construction_costs', 'international'] as const
type Tag = typeof PRIORITY[number]
type GroupId = Tag | 'other'
const GROUP_ORDER: GroupId[] = [...PRIORITY, 'other']

const GROUP_LABEL: Record<GroupId, string> = {
  policy: 'Policy', prices: 'Prices', rents: 'Rents',
  supply_construction: 'Supply & construction', construction_costs: 'Construction costs',
  international: 'International', other: 'Other',
}
// Material Symbols names — matches app/theme.py's TAG_ICON (v1) plus a
// "newspaper" fallback for the untagged/Other bucket.
const GROUP_ICON: Record<GroupId, string> = {
  policy: 'account_balance', prices: 'trending_up', rents: 'key',
  supply_construction: 'construction', construction_costs: 'receipt_long',
  international: 'public', other: 'newspaper',
}

const VISIBLE_CAP = 5

function primaryGroup(tags: string[]): GroupId {
  return PRIORITY.find(t => tags.includes(t)) ?? 'other'
}

function NewsGroup({ id, items }: { id: GroupId; items: NewsItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, VISIBLE_CAP)
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-medium mb-2">
        <span aria-hidden="true" className="material-symbols-rounded text-muted text-lg">
          {GROUP_ICON[id]}
        </span>
        {GROUP_LABEL[id]}
        <span className="text-faint font-normal">({items.length})</span>
      </h3>
      <ul className="divide-y divide-line">
        {shown.map(i => (
          <li key={i.url} className="py-2.5">
            <a href={i.url} target="_blank" rel="noreferrer"
               className="text-sm font-medium leading-snug hover:text-blue">{i.title}</a>
            <p className="text-xs text-faint mt-0.5">{newsByline(i.source, i.published)}</p>
          </li>
        ))}
      </ul>
      {items.length > VISIBLE_CAP && (
        <button type="button" onClick={() => setExpanded(x => !x)} aria-expanded={expanded}
                className="text-xs text-blue mt-1">
          {expanded ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  )
}

// Design review P0-3: News stays open (not collapsible-by-default's
// summary-line treatment other sections get) but is truncated to its own
// top-story cards by default, with the existing "Show all N" expander
// pattern (mirrored from NewsGroup's per-group cap above) revealing the
// full, filterable, grouped list on demand.
export function NewsSection({ news, now }: { news: NewsData; now: Date }) {
  const [source, setSource] = useState('')
  const [expanded, setExpanded] = useState(false)
  const allSources = [...new Set(news.items.map(i => i.source))].sort()
  const filtering = source !== ''
  const items = news.items.filter(i =>
    (source === '' || i.source === source) &&
    (filtering || !news.top_story_urls.includes(i.url)))

  const byGroup = new Map<GroupId, NewsItem[]>()
  for (const i of items) {
    const g = primaryGroup(i.tags)
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(i)
  }
  const groups = GROUP_ORDER
    .map(id => ({ id, items: (byGroup.get(id) ?? [])
      .sort((a, b) => b.published.localeCompare(a.published)) }))
    .filter(g => g.items.length > 0)

  if (!expanded) {
    const top = news.top_story_urls
      .map(u => news.items.find(i => i.url === u))
      .filter((i): i is NewsItem => i != null)
    return (
      <div>
        {news.health && (
          <p className="text-xs text-faint mb-3">
            {news.health.feeds_ok} of {news.health.feeds_total} feeds
            {' '}· fetched {ago(news.health.last_fetched, now)}
          </p>
        )}
        {top.length > 0 ? (
          <ul className="divide-y divide-line">
            {top.map(i => (
              <li key={i.url} className="py-2.5">
                <a href={i.url} target="_blank" rel="noreferrer"
                   className="text-sm font-medium leading-snug hover:text-blue">{i.title}</a>
                <p className="text-xs text-faint mt-0.5">{newsByline(i.source, i.published)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted">No standout stories this week.</p>
        )}
        <button type="button" onClick={() => setExpanded(true)} aria-expanded={false}
                className="text-xs text-blue mt-2">
          Show all {news.items.length} stories
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        {news.health
          ? <p className="text-xs text-faint">
              {news.health.feeds_ok} of {news.health.feeds_total} feeds
              {' '}· fetched {ago(news.health.last_fetched, now)}
            </p>
          : <span />}
        <label className="text-xs text-muted">Source{' '}
          <select aria-label="Source" value={source}
                  onChange={e => setSource(e.target.value)}
                  className="border border-line rounded-md px-2 py-1 bg-card">
            <option value="">All</option>
            {allSources.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {groups.length === 0 && (
        <p className="py-6 text-sm text-muted">No stories match these filters</p>
      )}
      <div className="space-y-6">
        {groups.map(g => <NewsGroup key={g.id} id={g.id} items={g.items} />)}
      </div>
      <button type="button" onClick={() => setExpanded(false)} aria-expanded={true}
              className="text-xs text-blue mt-4">
        Show fewer
      </button>
    </div>
  )
}
