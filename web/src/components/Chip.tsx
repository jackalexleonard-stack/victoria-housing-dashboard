import { PALETTE } from '../theme/tokens'

const STYLES = {
  good: { bg: PALETTE.chip_up, fg: PALETTE.up },
  warn: { bg: PALETTE.chip_warn, fg: PALETTE.warn },
  bad: { bg: PALETTE.chip_down, fg: PALETTE.down },
  neutral: { bg: PALETTE.bg2, fg: PALETTE.muted },
} as const

export function Chip({ kind, children }: { kind: keyof typeof STYLES;
                                            children: React.ReactNode }) {
  const s = STYLES[kind]
  return (
    <span style={{ background: s.bg, color: s.fg, borderRadius: 999,
                   padding: '2px 10px', fontSize: 12, fontWeight: 500 }}>
      {children}
    </span>
  )
}
