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

  it('fails no check on a blank-named new character, which the planner never creates', () => {
    const extra = {
      handle: 'new:extra',
      name: '',
      description: 'x',
      keywords: [],
      sourceTurn: 't1',
    }
    const r = { ...w.ideal, newCharacters: [...w.ideal.newCharacters, extra] }
    expect(failing(null, r, false)).toEqual([])
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

  it('reads its ideal reply back with every ID and turn handle in the brackets the prompt shows', () => {
    const { legend, schema, read } = renderWindow(w, MAX_ENTRIES)
    const placeholders = new Set(legend.values())
    const bracketed: unknown = JSON.parse(JSON.stringify(w.ideal), (key, value: unknown) => {
      if (typeof value !== 'string' || key === 'handle') return value
      const id = legend.get(value) ?? value
      return placeholders.has(id) || /^t\d+$/.test(id) || id.startsWith('new:') ? `[${id}]` : id
    })
    expect(JSON.stringify(bracketed)).toContain('"[t')
    const { reply: back } = read(schema.parse(bracketed))
    expect(back).toEqual(w.ideal)
  })
})

// A relative the prose names after a character is someone else.
describe.each([
  ['learning', 'Tam Rook is a new character', /^tam/i, "Tam Rook's aunt"],
  ['recounted', 'Edric Vane is a new character', /vane/i, 'The son of Count Edric Vane'],
  ['recounted', 'Vane, who gave the order, is involved in the wreck', /vane/i, 'son of Edric Vane'],
] as const)('eval window %s', (window, check, own, relative) => {
  it(`fails "${check}" when only a relative is added`, () => {
    const w = EVAL_WINDOWS.find((x) => x.name === window)!
    const holds = w.checks.find((c) => c.name === check)!.holds
    const target = w.ideal.newCharacters.find((c) => own.test(c.name))!
    const r = {
      ...w.ideal,
      newCharacters: w.ideal.newCharacters.map((c) =>
        c === target ? { ...c, name: relative } : c,
      ),
    }
    expect(holds(w.ideal)).toBe(true)
    expect(holds(r)).toBe(false)
  })
})

// Four replies retired Tam's own new handle, two for "ran the same night".
it('the learning window counts a retirement of Tam as making him dead', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'learning')!
  const holds = w.checks.find((c) => c.name === 'Tam Rook, who fled, is not made dead')!.holds
  const tam = w.ideal.newCharacters.find((c) => c.name === 'Tam Rook')!
  const retired = {
    ...w.ideal,
    statusFlips: [{ ref: tam.handle, to: 'retired' as const, reason: 'ran', sourceTurn: 't2' }],
  }
  expect(holds(w.ideal)).toBe(true)
  expect(holds(retired)).toBe(false)
})

it("the defection window leaves the warrant's signer unscored, and counts the hanged brother", () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'defection')!
  const holds = w.checks.find((c) => c.name.startsWith('no new character but'))!.holds
  const adding = (name: string) => ({
    ...w.ideal,
    newCharacters: [{ handle: 'new:x', name, description: 'x', keywords: [], sourceTurn: 't2' }],
  })
  expect(holds(adding('the man who signed that warrant'))).toBe(true)
  expect(holds(adding("Brann's brother"))).toBe(false)
})
