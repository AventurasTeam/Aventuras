import { describe, expect, it } from 'vitest'

import { auditTheme, AUDIT_PAIRS } from './themes-audit'
import { themes } from '../lib/themes/core/registry'

describe('AUDIT_PAIRS', () => {
  it('declares the body-prose load-bearing pair', () => {
    expect(AUDIT_PAIRS.text).toContainEqual({
      fg: '--fg-primary',
      bg: '--bg-base',
      aaFloor: 4.5,
      aaaTarget: 7,
    })
  })
})

describe.each(themes.map((theme) => [theme.id, theme] as const))('%s', (_id, theme) => {
  const rows = auditTheme(theme).rows

  it('clears AA for every text pair, semantic text on each surface included', () => {
    expect(rows.filter((row) => row.kind === 'text' && row.aa === 'fail')).toEqual([])
  })

  it('audits each semantic text slot on all four solid surfaces', () => {
    const semantic = rows
      .filter((row) => row.fg.endsWith('-text'))
      .map((row) => `${row.fg} ${row.bg}`)
    const expected = ['--success-text', '--warning-text', '--danger-text', '--info-text'].flatMap(
      (fg) =>
        ['--bg-base', '--bg-raised', '--bg-sunken', '--bg-overlay'].map((bg) => `${fg} ${bg}`),
    )
    expect(semantic.sort()).toEqual(expected.sort())
  })
})

describe('auditTheme', () => {
  it('produces a row per declared text pair', () => {
    const theme = themes[0]
    const result = auditTheme(theme)
    expect(result.rows.length).toBeGreaterThanOrEqual(AUDIT_PAIRS.text.length)
  })

  it('text-pair row marks AA pass when ratio ≥ 4.5', () => {
    const result = auditTheme(themes[0]) // default-light: 0a/fa, ratio ≈ 19
    const bodyRow = result.rows.find((r) => r.fg === '--fg-primary' && r.bg === '--bg-base')
    expect(bodyRow?.aa).toBe('pass')
  })

  it('non-text pair fails below 3:1', () => {
    const result = auditTheme(themes[0])
    const nonText = result.rows.filter((r) => r.kind === 'non-text')
    for (const row of nonText) {
      if (row.ratio < 3) expect(row.status).toBe('fail')
    }
  })
})
