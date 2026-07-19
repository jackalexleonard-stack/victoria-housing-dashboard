import { PALETTE, COLORWAY, FONT_UI, FONT_DISPLAY } from './tokens'

test('palette matches the approved spec exactly', () => {
  expect(PALETTE).toEqual({
    bg: '#FAF7EF', bg2: '#F2F0E5', card: '#FFFEFA',
    line: '#E6E4D9', line2: '#DAD8CE',
    ink: '#1C1B1A', muted: '#575653', faint: '#6F6E69',
    blue: '#205EA6', clay: '#BC5215',
    up: '#00824D', down: '#AF3029', warn: '#7A5900',
    chip_up: '#DDF7CE', chip_down: '#FFE0E0', chip_warn: '#FFEECC',
    zeroline: '#B7B5AC',
  })
})

test('colorway matches the approved spec', () => {
  expect(COLORWAY).toEqual(['#205EA6', '#BC5215', '#24837B',
                            '#66800B', '#5E409D', '#878580'])
})

test('font stacks', () => {
  expect(FONT_UI).toMatch(/^'Inter Variable'/)
  expect(FONT_DISPLAY).toMatch(/^'Newsreader Variable'/)
})
