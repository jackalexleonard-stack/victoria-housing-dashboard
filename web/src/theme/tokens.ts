export const PALETTE = {
  bg: '#FAF7EF', bg2: '#F2F0E5', card: '#FFFEFA',
  line: '#E6E4D9', line2: '#DAD8CE',
  ink: '#1C1B1A', muted: '#575653', faint: '#6F6E69',
  blue: '#205EA6', clay: '#BC5215',
  up: '#00824D', down: '#AF3029', warn: '#7A5900',
  chip_up: '#DDF7CE', chip_down: '#FFE0E0', chip_warn: '#FFEECC',
  zeroline: '#B7B5AC',
  // Reserved EXCLUSIVELY for de-emphasised context lines (LineChart's
  // `emphasize` prop) — design review P1-emphasis found this same hex
  // misused as a rotating DATA colour in the mortgage chart's 6-line
  // colorway, which meant a genuinely de-emphasised context line and a
  // named data series could accidentally share one colour. Freed from
  // COLORWAY below; a Flexoki hue takes its old rotation slot instead.
  deemphasis: '#878580',
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
// other five).
export const COLORWAY = ['#205EA6', '#BC5215', '#24837B',
                         '#66800B', '#5E409D', '#A02F6F'] as const

export const FONT_UI = "'Inter Variable', 'Helvetica Neue', Arial, sans-serif"
export const FONT_DISPLAY = "'Newsreader Variable', Georgia, serif"
