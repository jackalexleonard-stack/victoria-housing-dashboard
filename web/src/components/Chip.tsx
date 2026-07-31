import { CHIP_STYLES } from '../theme/tokens'

export function Chip({ kind, children }: { kind: keyof typeof CHIP_STYLES;
                                            children: React.ReactNode }) {
  const s = CHIP_STYLES[kind]
  return (
    <span style={{ background: s.bg, color: s.fg, borderRadius: 999,
                   padding: '2px 10px', fontSize: 12, fontWeight: 500 }}>
      {children}
    </span>
  )
}
