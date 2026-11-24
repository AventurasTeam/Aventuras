import { describe, expect, it } from 'vitest'

import { readerUndoRedoGates } from './undo-redo-gates'

const LOADING = 'Loading story…'
const HELD = 'Finish or cancel the edit first.'

// The route computes no reason while nothing blocks: both gate-reason helpers answer undefined.
const IDLE = {
  hydrated: true,
  headReversalBlocked: false,
  rerunRunning: false,
  actionsBlocked: false,
  editorOpen: false,
  reasons: { gate: undefined, headReversal: undefined },
}

// A pass holds the gate; a head reversal passes through it by interrupting it.
const PASS = {
  ...IDLE,
  actionsBlocked: true,
  reasons: { gate: 'Updating memory. Cancel to edit.', headReversal: undefined },
}

// A run head reversals can't pass through holds both.
const TURN = {
  ...IDLE,
  actionsBlocked: true,
  headReversalBlocked: true,
  reasons: {
    gate: 'Generation is in flight. Cancel to edit.',
    headReversal: 'Chapter close in progress. Cancel to edit.',
  },
}

describe('readerUndoRedoGates', () => {
  it('disables both while the reader hydrates', () => {
    expect(readerUndoRedoGates({ ...IDLE, hydrated: false })).toEqual({
      undo: { disabled: true, reason: LOADING },
      redo: { disabled: true, reason: LOADING },
    })
  })

  it('names the load over every other reason while it hydrates', () => {
    expect(
      readerUndoRedoGates({ ...TURN, rerunRunning: true, editorOpen: true, hydrated: false }),
    ).toEqual({
      undo: { disabled: true, reason: LOADING },
      redo: { disabled: true, reason: LOADING },
    })
  })

  it('leaves both live on a hydrated reader nothing holds', () => {
    expect(readerUndoRedoGates(IDLE)).toEqual({
      undo: { disabled: false, reason: undefined },
      redo: { disabled: false, reason: undefined },
    })
  })

  it("holds both for an open editor, with the editor's reason", () => {
    expect(readerUndoRedoGates({ ...IDLE, editorOpen: true })).toEqual({
      undo: { disabled: true, reason: HELD },
      redo: { disabled: true, reason: HELD },
    })
  })

  it("lets Undo through a pass and holds Redo with the pass's reason", () => {
    expect(readerUndoRedoGates(PASS)).toEqual({
      undo: { disabled: false, reason: undefined },
      redo: { disabled: true, reason: 'Updating memory. Cancel to edit.' },
    })
  })

  it("keeps the gate's reason over the editor's", () => {
    expect(readerUndoRedoGates({ ...PASS, editorOpen: true })).toEqual({
      undo: { disabled: true, reason: HELD },
      redo: { disabled: true, reason: 'Updating memory. Cancel to edit.' },
    })
  })

  it('holds Undo with the head-reversal reason when a run blocks head reversals', () => {
    expect(readerUndoRedoGates({ ...TURN, editorOpen: true })).toEqual({
      undo: { disabled: true, reason: 'Chapter close in progress. Cancel to edit.' },
      redo: { disabled: true, reason: 'Generation is in flight. Cancel to edit.' },
    })
  })

  it("holds Undo while a re-run runs, naming the gate's run", () => {
    const rerun = {
      ...IDLE,
      rerunRunning: true,
      actionsBlocked: true,
      reasons: { gate: "Re-running the chapter's close. Cancel to edit.", headReversal: undefined },
    }
    expect(readerUndoRedoGates(rerun)).toEqual({
      undo: { disabled: true, reason: "Re-running the chapter's close. Cancel to edit." },
      redo: { disabled: true, reason: "Re-running the chapter's close. Cancel to edit." },
    })
  })
})
