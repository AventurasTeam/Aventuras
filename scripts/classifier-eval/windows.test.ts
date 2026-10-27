import { describe, expect, it } from 'vitest'

import { reply } from './fixture'
import { EVAL_WINDOWS, renderWindow } from './index'

const MAX_ENTRIES = 20

describe.each(EVAL_WINDOWS.map((w) => [w.name, w] as const))('eval window %s', (_, w) => {
  const failing = (kind: 'expect' | 'avoid' | null, r: typeof w.ideal, holds: boolean) =>
    w.checks
      .filter((c) => (kind == null || c.kind === kind) && c.holds(r) === holds)
      .map((c) => c.name)

  it('its ideal reply passes every check', () => {
    expect(failing(null, w.ideal, false)).toEqual([])
  })

  it('an empty reply fails every expect check', () => {
    expect(failing('expect', reply({}), true)).toEqual([])
  })

  it('its bad reply fails every avoid check', () => {
    expect(failing('avoid', w.bad, true)).toEqual([])
  })

  it('shows every turn and no fixture id in the prompt', () => {
    const { prompt } = renderWindow(w, MAX_ENTRIES)
    for (const entry of w.entries) expect(prompt.user).toContain(entry.content)
    expect(prompt.user).not.toMatch(/\b(char|fact|loc|hap|thr)_/)
  })

  it('reads its ideal reply, written in placeholders, back as the ideal reply', () => {
    const { legend, schema, read } = renderWindow(w, MAX_ENTRIES)
    const inPlaceholders: unknown = JSON.parse(JSON.stringify(w.ideal), (_key, value: unknown) =>
      typeof value === 'string' ? (legend.get(value) ?? value) : value,
    )
    expect(inPlaceholders).not.toEqual(w.ideal)
    const { reply: back, malformed } = read(schema.parse(inPlaceholders))
    expect(malformed).toEqual([])
    expect(back).toEqual(w.ideal)
  })
})
