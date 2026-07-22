export const PALETTE = {
  bg: '#1A1824', bg2: '#211E2E', card: '#242133',
  line: '#332F45', line2: '#3D3852',
  ink: '#ECEAF4', muted: '#B5B1C4', faint: '#918DA3',
  blue: '#7FA9D6', clay: '#DA8A54',
  up: '#879A39', down: '#DB7263', warn: '#D0A215',
  chip_up: '#223420', chip_down: '#3A2224', chip_warn: '#352C1A',
  chip_up_text: '#A3C68C', chip_down_text: '#F0A296', chip_warn_text: '#D8B45A',
  zeroline: '#4A4660',
  // Reserved EXCLUSIVELY for de-emphasised context lines (LineChart's
  // `emphasize` prop) — design review P1-emphasis found this same hex
  // misused as a rotating DATA colour in the mortgage chart's 6-line
  // colorway, which meant a genuinely de-emphasised context line and a
  // named data series could accidentally share one colour. Freed from
  // COLORWAY below; a Flexoki hue takes its old rotation slot instead.
  deemphasis: '#6F6A84',
} as const

// Six-hue rotation for multi-line charts. The 6th slot used to be the same
// grey now reserved for `deemphasis` above (COLORWAY doubled as "6th data
// colour" AND, informally, "muted line" — the two roles collided on the
// mortgage-rates chart, where grey was one of six equally-weighted series
// colours despite grey being clearly a lower-emphasis choice). Replaced
// with Flexoki magenta (#A02F6F): the existing five hues already cover
// blue, clay-orange, teal, olive-green and purple, so magenta is the one
// remaining Flexoki hue family with no near-neighbour already in rotation
// (cyan was the other candidate, but the existing teal (#24837B) already
// reads as cyan-adjacent, so magenta stays more visually distinct from the
// other five). The six values are now the Flexoki dark-scheme 400 levels
// of the same six hue families, matched to the ink-violet identity.
export const COLORWAY = ['#4385BE', '#DA702C', '#3AABB0',
                         '#879A39', '#8B7EC8', '#CE5D97'] as const

export const FONT_UI = "'Inter Variable', 'Helvetica Neue', Arial, sans-serif"
export const FONT_DISPLAY = "'Newsreader Variable', Georgia, serif"
