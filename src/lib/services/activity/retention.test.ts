import { describe, it, expect } from 'vitest'
import { findTurnByEntryId, retainTurns, RETAINED_TURNS } from './retention'
import type { ActivityTurn } from './types'

const turn = (id: string): ActivityTurn => ({
  id,
  entryId: `entry-${id}`,
  startedAt: 0,
  steps: [],
})

describe('retainTurns', () => {
  it('keeps everything below the bound', () => {
    const turns = [turn('1'), turn('2')]
    expect(retainTurns(turns, 5)).toEqual(turns)
  })

  it('discards oldest first once the bound is exceeded', () => {
    const turns = ['1', '2', '3', '4', '5', '6', '7'].map(turn)

    expect(retainTurns(turns, 5).map((t) => t.id)).toEqual(['3', '4', '5', '6', '7'])
  })

  it('defaults to the retention bound', () => {
    const turns = Array.from({ length: RETAINED_TURNS + 3 }, (_, i) => turn(String(i)))

    expect(retainTurns(turns)).toHaveLength(RETAINED_TURNS)
  })

  it('keeps nothing for a bound of zero', () => {
    expect(retainTurns([turn('1')], 0)).toEqual([])
  })
})

describe('findTurnByEntryId', () => {
  it('finds a retained turn', () => {
    const turns = [turn('1'), turn('2')]

    expect(findTurnByEntryId(turns, 'entry-2')?.id).toBe('2')
  })

  it('misses an evicted entry', () => {
    const turns = retainTurns(['1', '2', '3', '4', '5', '6'].map(turn), 5)

    expect(findTurnByEntryId(turns, 'entry-1')).toBeNull()
  })
})
