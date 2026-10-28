import { describe, expect, it } from 'vitest'

import { knownHappenings } from './known-happenings'

const happening = (id: string, occurredAtEntryId: string | null) => ({ id, occurredAtEntryId })
const ids = (rows: readonly { id: string }[]) => rows.map((h) => h.id)

// classifier.md → What the classifier reads → Known happenings.
describe('knownHappenings', () => {
  const recentEntryIds = new Set(['e5', 'e6'])
  const madeFromRecent = new Set<string>()

  it('lists a happening that occurred in the recent entries, and an older one only if recorded', () => {
    const rows = [
      happening('hap_old', 'e1'),
      happening('hap_recent', 'e6'),
      happening('hap_seated', 'e2'),
    ]
    const listed = knownHappenings(rows, {
      recorded: new Set(['hap_seated']),
      recentEntryIds,
      madeFromRecent,
    })
    expect(ids(listed)).toEqual(['hap_recent', 'hap_seated'])
  })

  it('lists a happening with no narrative position through a record or a recent create', () => {
    const rows = [
      happening('hap_temporal', null),
      happening('hap_told', null),
      happening('hap_made', null),
    ]
    const listed = knownHappenings(rows, {
      recorded: new Set(['hap_told']),
      recentEntryIds,
      madeFromRecent: new Set(['hap_made']),
    })
    expect(ids(listed)).toEqual(['hap_told', 'hap_made'])
  })

  // Placeholders number in walk order, so the prompt keeps the roster's order.
  it("keeps the roster's order and drops a recorded id the branch no longer has", () => {
    const rows = [happening('hap_a', 'e1'), happening('hap_b', 'e5'), happening('hap_c', null)]
    const listed = knownHappenings(rows, {
      recorded: new Set(['hap_gone', 'hap_c', 'hap_a']),
      recentEntryIds,
      madeFromRecent,
    })
    expect(ids(listed)).toEqual(['hap_a', 'hap_b', 'hap_c'])
  })
})
