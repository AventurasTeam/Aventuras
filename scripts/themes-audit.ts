import { contrastRatio } from '../lib/themes/core/contrast'
import { themes } from '../lib/themes/core/registry'
import type { Theme } from '../lib/themes/types'

type Pair = {
  fg: keyof Theme['colors']
  bg: keyof Theme['colors']
  aaFloor: number
  aaaTarget?: number
}
type NonTextPair = { fg: keyof Theme['colors']; bg: keyof Theme['colors']; floor: number }
type AdvisoryPair = { fg: keyof Theme['colors']; bg: keyof Theme['colors'] }

export const AUDIT_PAIRS = {
  text: [
    { fg: '--fg-primary', bg: '--bg-base', aaFloor: 4.5, aaaTarget: 7 },
    { fg: '--fg-primary', bg: '--bg-raised', aaFloor: 4.5 },
    { fg: '--fg-primary', bg: '--bg-sunken', aaFloor: 4.5 },
    { fg: '--fg-primary', bg: '--bg-overlay', aaFloor: 4.5 },
    { fg: '--fg-secondary', bg: '--bg-base', aaFloor: 4.5 },
    { fg: '--fg-muted', bg: '--bg-base', aaFloor: 3, aaaTarget: 4.5 },
    { fg: '--accent-fg', bg: '--accent', aaFloor: 4.5 },
    { fg: '--accent-fg', bg: '--accent-hover', aaFloor: 4.5 },
    { fg: '--success-fg', bg: '--success', aaFloor: 4.5 },
    { fg: '--warning-fg', bg: '--warning', aaFloor: 4.5 },
    { fg: '--danger-fg', bg: '--danger', aaFloor: 4.5 },
    { fg: '--info-fg', bg: '--info', aaFloor: 4.5 },
    { fg: '--fg-primary', bg: '--selection-bg', aaFloor: 4.5 },
    { fg: '--fg-primary', bg: '--recently-classified-bg', aaFloor: 4.5 },
  ] satisfies Pair[],
  nonText: [
    { fg: '--focus-ring', bg: '--bg-base', floor: 3 },
    { fg: '--focus-ring', bg: '--bg-raised', floor: 3 },
    { fg: '--focus-ring', bg: '--bg-overlay', floor: 3 },
    { fg: '--accent', bg: '--bg-base', floor: 3 },
  ] satisfies NonTextPair[],
  advisory: [
    { fg: '--border', bg: '--bg-base' },
    { fg: '--border-strong', bg: '--bg-base' },
    { fg: '--selection-bg', bg: '--bg-base' },
    { fg: '--fg-disabled', bg: '--bg-disabled' },
    { fg: '--recently-classified-bg', bg: '--bg-base' },
  ] satisfies AdvisoryPair[],
} as const

// Pairs that fail by canonical design and are knowingly accepted.
// Catppuccin Latte's mid-luminance Green/Yellow/Sky cannot reach
// AA 4.5 as filled pills with any foreground; verbatim-Catppuccin
// is honored over the floor.
const EXEMPT: ReadonlySet<string> = new Set([
  'catppuccin-latte|--success-fg|--success',
  'catppuccin-latte|--warning-fg|--warning',
  'catppuccin-latte|--info-fg|--info',
])

export type AuditRow = {
  kind: 'text' | 'non-text' | 'advisory'
  fg: string
  bg: string
  ratio: number
  aa?: 'pass' | 'fail'
  aaa?: 'pass' | 'fail'
  status: 'pass' | 'fail' | 'warn' | 'info' | 'exempt'
}

export type AuditResult = {
  themeId: string
  rows: AuditRow[]
}

export function auditTheme(theme: Theme): AuditResult {
  const rows: AuditRow[] = []

  for (const p of AUDIT_PAIRS.text) {
    const ratio = contrastRatio(theme.colors[p.fg], theme.colors[p.bg])
    const aa = ratio >= p.aaFloor ? 'pass' : 'fail'
    const aaa = p.aaaTarget ? (ratio >= p.aaaTarget ? 'pass' : 'fail') : undefined
    const exempt = EXEMPT.has(`${theme.id}|${p.fg}|${p.bg}`)
    rows.push({
      kind: 'text',
      fg: p.fg,
      bg: p.bg,
      ratio,
      aa,
      aaa,
      status: exempt ? 'exempt' : aa === 'fail' ? 'fail' : aaa === 'fail' ? 'warn' : 'pass',
    })
  }

  for (const p of AUDIT_PAIRS.nonText) {
    const ratio = contrastRatio(theme.colors[p.fg], theme.colors[p.bg])
    rows.push({
      kind: 'non-text',
      fg: p.fg,
      bg: p.bg,
      ratio,
      status: ratio >= p.floor ? 'pass' : 'fail',
    })
  }

  for (const p of AUDIT_PAIRS.advisory) {
    const ratio = contrastRatio(theme.colors[p.fg], theme.colors[p.bg])
    rows.push({ kind: 'advisory', fg: p.fg, bg: p.bg, ratio, status: 'info' })
  }

  return { themeId: theme.id, rows }
}

function formatTable(result: AuditResult): string {
  const header = `\n# ${result.themeId}\n  ${'pair'.padEnd(38)} ${'ratio'.padEnd(8)} aa   aaa  status`
  const rows = result.rows.map((r) => {
    const pair = `${r.fg} × ${r.bg}`.padEnd(38)
    const ratio = r.ratio.toFixed(2).padEnd(8)
    const aa = (r.aa ?? '-').padEnd(4)
    const aaa = (r.aaa ?? '-').padEnd(4)
    return `  ${pair} ${ratio} ${aa} ${aaa} ${r.status}`
  })
  return [header, ...rows].join('\n')
}

function main(): void {
  for (const theme of themes) {
    const result = auditTheme(theme)
    console.log(formatTable(result))
  }
  process.exit(0)
}

if (require.main === module) main()
