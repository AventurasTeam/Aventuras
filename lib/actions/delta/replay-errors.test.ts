import { describe, expect, it } from 'vitest'

import { DeltaReplayError, ReversalIntegrityError } from './replay-errors'
import {
  DeltaReplayError as ReexportedReplayError,
  ReversalIntegrityError as ReexportedIntegrityError,
  describeDeltaReplayError,
} from './reverse-replay'

describe('DeltaReplayError', () => {
  it('reads as committed only when the store sync failed after the commit', () => {
    const sync = new DeltaReplayError('sync', {
      cause: 'x',
      actionId: 'act_1',
      stage: 'store-sync',
    })
    const tx = new DeltaReplayError('tx', { cause: 'x', actionId: 'act_1', stage: 'transaction' })

    expect(sync.committed).toBe(true)
    expect(tx.committed).toBe(false)
  })
})

describe('ReversalIntegrityError', () => {
  it('is an uncommitted DeltaReplayError naming its refusal and detail', () => {
    const e = new ReversalIntegrityError('no-create', 'character_relationships:rel_x', 'act_run')

    expect(e).toBeInstanceOf(DeltaReplayError)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('ReversalIntegrityError')
    expect(e.refusal).toBe('no-create')
    expect(e.actionId).toBe('act_run')
    expect(e.stage).toBe('transaction')
    expect(e.committed).toBe(false)
    expect(e.message).toBe('Reversal refused (no-create): character_relationships:rel_x')
    // The full message, so describeDeltaReplayError keeps the refusal kind in abort diagnostics.
    expect(e.cause).toBe('Reversal refused (no-create): character_relationships:rel_x')
  })

  it('is described for the pipeline port as an uncommitted failure naming its refusal', () => {
    const e = new ReversalIntegrityError('write-back', 'entities:char_x', 'act_g')

    expect(describeDeltaReplayError(e)).toEqual({
      detail: 'Reversal refused (write-back): entities:char_x',
      committed: false,
      refusal: 'write-back',
    })
  })
})

describe('describeDeltaReplayError and a re-run journal', () => {
  it('carries a re-run group’s journal outcome for the pipeline port', () => {
    const e = new DeltaReplayError('Post-commit patch sync failed', {
      cause: 'boom',
      actionId: 'act_rerun',
      stage: 'store-sync',
      journal: 'undone',
      chapterNumber: 2,
    })

    expect(describeDeltaReplayError(e)).toEqual({
      detail: 'boom',
      committed: true,
      refusal: null,
      journal: 'undone',
      chapterNumber: 2,
    })
  })

  it('leaves the journal fields off any other failure', () => {
    const e = new DeltaReplayError('tx', { cause: 'x', actionId: 'act_1', stage: 'transaction' })

    expect(describeDeltaReplayError(e)).not.toHaveProperty('journal')
    expect(describeDeltaReplayError(e)).not.toHaveProperty('chapterNumber')
  })
})

describe('reverse-replay re-exports', () => {
  it('hands existing importers the same classes', () => {
    expect(ReexportedReplayError).toBe(DeltaReplayError)
    expect(ReexportedIntegrityError).toBe(ReversalIntegrityError)
  })
})
