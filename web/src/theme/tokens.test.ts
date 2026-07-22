import { PALETTE, COLORWAY, FONT_UI, FONT_DISPLAY } from './tokens'

// WCAG relative luminance + contrast ratio (WCAG 2.x definition) — the
// unit-level gate behind the spec's "axe is the arbiter" rule, so a token
// edit can't silently ship an AA failure between axe runs.
function lum(hex: string): number {
  const c = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('palette matches the approved 2.5 spec exactly (ink violet)', () => {
  expect(PALETTE).toEqual({
    bg: '#1A1824', bg2: '#211E2E', card: '#242133',
    line: '#332F45', line2: '#3D3852',
    ink: '#ECEAF4', muted: '#B5B1C4', faint: '#918DA3',
    blue: '#7FA9D6', clay: '#DA8A54',
    up: '#879A39', down: '#DB7263', warn: '#D0A215',
    chip_up: '#223420', chip_down: '#3A2224', chip_warn: '#352C1A',
    chip_up_text: '#A3C68C', chip_down_text: '#F0A296', chip_warn_text: '#D8B45A',
    zeroline: '#4A4660',
    // Nudged from the brief's #6B6680 to #6F6A84 (RGB +4/+4/+4, minimal
    // uniform lightening) — the brief's value measured 2.86:1 against
    // `card`, short of the 3:1 AA-graphics gate; #6F6A84 clears it on both
    // bg (3.39:1) and card (3.04:1). See task-1-report.md for the ratios.
    deemphasis: '#6F6A84',
  })
})

test('colorway is the Flexoki dark-scheme 400 set (same six hue families as 2.4)', () => {
  expect(COLORWAY).toEqual(['#4385BE', '#DA702C', '#3AABB0',
                            '#879A39', '#8B7EC8', '#CE5D97'])
})

test('the de-emphasis grey is reserved and no longer appears in the data colorway rotation', () => {
  expect(COLORWAY).not.toContain(PALETTE.deemphasis)
})

// Contrast gates. Text roles: 4.5:1 (AA body). Data marks: 3:1 (AA
// graphics). zeroline is exempt: it is a decorative hairline, deliberately
// subtle in the cream identity too (its cream-era hex was ~1.6:1).
const SURFACES = [PALETTE.bg, PALETTE.card] as const

test.each(['ink', 'muted', 'faint', 'blue', 'clay', 'up', 'down', 'warn'] as const)(
  'text token %s holds 4.5:1 on bg and card', key => {
    for (const s of SURFACES) expect(ratio(PALETTE[key], s)).toBeGreaterThanOrEqual(4.5)
  })

test.each([
  ['chip_up_text', 'chip_up'], ['chip_down_text', 'chip_down'],
  ['chip_warn_text', 'chip_warn'],
] as const)('chip text %s holds 4.5:1 on its own chip tint', (fg, bg) => {
  expect(ratio(PALETTE[fg], PALETTE[bg])).toBeGreaterThanOrEqual(4.5)
})

test('every colorway hue and the deemphasis line hold 3:1 on bg and card', () => {
  for (const hue of [...COLORWAY, PALETTE.deemphasis]) {
    for (const s of SURFACES) expect(ratio(hue, s)).toBeGreaterThanOrEqual(3)
  }
})

test('font stacks', () => {
  expect(FONT_UI).toMatch(/^'Inter Variable'/)
  expect(FONT_DISPLAY).toMatch(/^'Newsreader Variable'/)
})
