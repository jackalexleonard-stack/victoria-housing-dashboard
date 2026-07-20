import { HeroTiles, TILE_CHART } from './HeroTiles'
import { TILE_FMT, fmtDate } from '../lib/format'
import type { NewsData, SiteData } from '../lib/types'

export function TodaySection({ site, news, onOpen }: {
  site: SiteData; news: NewsData; onOpen: (chartId: string) => void }) {
  const top = news.top_story_urls
    .map(u => news.items.find(i => i.url === u))
    .filter(i => i != null)
  return (
    <section aria-label="Today">
      <div title="Today's most notable movements">
        <HeroTiles tiles={site.hero} onOpen={onOpen} />
      </div>
      {site.whats_new.length > 0 && (
        <div className="mt-4">
          <h3 className="font-display text-lg mb-2">Changed this week</h3>
          <ul className="flex flex-wrap gap-2">
            {site.whats_new.map(t => (
              <li key={t.key}>
                <button type="button" onClick={() => onOpen(TILE_CHART[t.key])}
                        className="text-xs bg-card border border-line rounded-full px-3 py-1.5 hover:border-blue num">
                  <span className="text-muted">{t.label}</span>{' '}
                  <span className="font-medium">
                    {t.value != null && TILE_FMT[t.key]
                      ? TILE_FMT[t.key].value(t.value) : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {top.length > 0 && (
        <div className="mt-5">
          <h3 className="font-display text-lg mb-2"
              title="Ranked by source, topic and recency">Top stories</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {top.map(item => (
              <article key={item.url} className="flex gap-3 bg-card border border-line rounded-lg p-3">
                {item.image
                  ? <img src={item.image} alt="" loading="lazy"
                         className="w-16 h-16 object-cover rounded-md shrink-0" />
                  : <span aria-hidden="true"
                          className="material-symbols-rounded text-muted w-16 h-16 flex items-center justify-center bg-bg2 rounded-md shrink-0">
                      newspaper</span>}
                <div className="min-w-0">
                  <a href={item.url} target="_blank" rel="noreferrer"
                     className="font-medium text-sm leading-snug hover:text-blue">
                    {item.title}</a>
                  <p className="text-xs text-faint mt-1">
                    {item.source} · {fmtDate(item.published)}
                    {item.dup_sources.length > 0 &&
                      ` · covered by ${item.dup_sources.length + 1} outlets`}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {news.digest && (
        <p className="mt-4 text-sm text-muted border-t border-line pt-3 max-w-[70ch]">
          {news.digest}</p>
      )}
    </section>
  )
}
