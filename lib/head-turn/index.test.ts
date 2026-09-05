import { describe, expect, it } from 'vitest'

import { resolveHeadTurn, type TurnEntry } from './index'

function entry(id: string, kind: string): TurnEntry {
  return { id, kind, position: 0 }
}

describe('resolveHeadTurn', () => {
  it('has no head turn on a branch with no entries', () => {
    expect(resolveHeadTurn([])).toBeNull()
  })

  it('has no head turn on a branch holding nothing but a banner', () => {
    expect(resolveHeadTurn([entry('e1', 'system')])).toBeNull()
  })

  it('pairs an ai_reply tail with the user_action it answers', () => {
    const rows = [entry('e1', 'opening'), entry('e2', 'user_action'), entry('e3', 'ai_reply')]
    expect(resolveHeadTurn(rows)).toEqual({
      tail: rows[2],
      previous: rows[1],
      origin: rows[1],
    })
  })

  it('reads past a trailing banner to the narrative tail', () => {
    const rows = [entry('e1', 'user_action'), entry('e2', 'ai_reply'), entry('e3', 'system')]
    // The banner sits at MAX(position) + 1, so counting it would take the tail off the
    // real last entry and downgrade a head-turn edit to a bare text write.
    expect(resolveHeadTurn(rows)?.tail).toBe(rows[1])
    expect(resolveHeadTurn(rows)?.origin).toBe(rows[0])
  })

  it('offers no origin when the tail is a standing user action', () => {
    const rows = [entry('e1', 'ai_reply'), entry('e2', 'user_action')]
    const head = resolveHeadTurn(rows)
    // `previous` is the entry before the tail whatever its kind; `origin` is the narrower
    // claim that the two form a turn, which scene metadata inheritance must not conflate.
    expect(head?.previous).toBe(rows[0])
    expect(head?.origin).toBeNull()
  })

  it('offers no origin when the tail reply follows the opening rather than an action', () => {
    const rows = [entry('e1', 'opening'), entry('e2', 'ai_reply')]
    const head = resolveHeadTurn(rows)
    expect(head?.previous).toBe(rows[0])
    expect(head?.origin).toBeNull()
  })

  it('offers no origin when the tail is the only entry loaded', () => {
    const head = resolveHeadTurn([entry('e9', 'ai_reply')])
    expect(head?.previous).toBeNull()
    expect(head?.origin).toBeNull()
  })

  it('skips a banner sitting between the tail and its origin', () => {
    // Unreachable while the banner is a trailing singleton, but the rule is positional:
    // a surface handing over unfiltered rows must not lose the pair to one.
    const rows = [entry('e1', 'user_action'), entry('e2', 'system'), entry('e3', 'ai_reply')]
    expect(resolveHeadTurn(rows)?.origin).toBe(rows[0])
  })
})
