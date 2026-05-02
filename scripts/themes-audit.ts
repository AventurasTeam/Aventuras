import { contrastRatio } from '../lib/themes/contrast'
import { themes } from '../lib/themes/registry'
import type { Theme } from '../lib/themes/types'

type Pair = {
  fg: keyof Theme['colors']
  bg: keyof Theme['colors']
  aaFloor: number
  aaaTarget?: number
}
type NonTextPair = { fg: keyof Theme['colors']; bg: keyof Theme['colors']; floor: number }

export const AUDIT_PAIRS = {
  text: [
    { fg: '--fg-primary', bg: '--bg-base', aaFloor: 4.5, aaaTarget: 7 },
    { fg: '--fg-secondary', bg: '--bg-base', aaFloor: 4.5, aaaTarget: 7 },
    { fg: '--fg-muted', bg: '--bg-base', aaFloor: 3, aaaTarget: 4.5 },
    { fg: '--fg-primary', bg: '--bg-raised', aaFloor: 4.5, aaaTarget: 7 },
    { fg: '--fg-primary', bg: '--bg-sunken', aaFloor: 4.5, aaaTarget: 7 },
    { fg: '--accent-fg', bg: '--accent', aaFloor: 4.5, aaaTarget: 7 },
    { fg: '--success-fg', bg: '--success', aaFloor: 4.5 },
    { fg: '--warning-fg', bg: '--warning', aaFloor: 4.5 },
    { fg: '--danger-fg', bg: '--danger', aaFloor: 4.5 },
    { fg: '--info-fg', bg: '--info', aaFloor: 4.5 },
  ] satisfies Pair[],
  nonText: [
    { fg: '--border', bg: '--bg-base', floor: 3 },
    { fg: '--border-strong', bg: '--bg-base', floor: 3 },
    { fg: '--focus-ring', bg: '--bg-base', floor: 3 },
  ] satisfies NonTextPair[],
  faintSignal: { fg: '--recently-classified-bg', bg: '--bg-base' },
} as const

export type AuditRow = {
  kind: 'text' | 'non-text' | 'faint'
  fg: string
  bg: string
  ratio: number
  aa?: 'pass' | 'fail'
  aaa?: 'pass' | 'fail'
  status: 'pass' | 'fail' | 'warn' | 'info'
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
    rows.push({
      kind: 'text',
      fg: p.fg,
      bg: p.bg,
      ratio,
      aa,
      aaa,
      status: aa === 'fail' ? 'fail' : aaa === 'fail' ? 'warn' : 'pass',
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

  const faintRatio = contrastRatio(
    theme.colors[AUDIT_PAIRS.faintSignal.fg],
    theme.colors[AUDIT_PAIRS.faintSignal.bg],
  )
  rows.push({
    kind: 'faint',
    fg: AUDIT_PAIRS.faintSignal.fg,
    bg: AUDIT_PAIRS.faintSignal.bg,
    ratio: faintRatio,
    status: 'info',
  })

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
