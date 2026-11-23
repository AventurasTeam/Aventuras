// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __redoGroupForTest,
  DeltaReplayError,
  type readUndoImpact,
  type readUndoTarget,
  type redoLastAction,
  type undoLastAction,
  type UndoResult,
  type UndoTargetRead,
} from '@/lib/actions'
import type { Delta } from '@/lib/db'
import {
  __resetDiagnosticsGate,
  clearBuffers,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
} from '@/lib/diagnostics'
import { makeLore } from '@/lib/list-modules/__tests__/fixtures'
import {
  entitiesStore,
  generationStore,
  loreStore,
  undoRedoStore,
  type RunState,
} from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { useReaderUndo } from './use-reader-undo'

const actions = vi.hoisted(() => ({
  readUndoTarget: vi.fn<typeof readUndoTarget>(),
  readUndoImpact: vi.fn<typeof readUndoImpact>(),
  undoLastAction: vi.fn<typeof undoLastAction>(),
  redoLastAction: vi.fn<typeof redoLastAction>(),
}))

vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...actions,
}))
// The real confirm renders rn-primitives chrome the unit project can't load; its props are what
// the hook decides.
vi.mock('./undo-confirm', () => ({ UndoConfirm: () => null }))

const ctx = {} as Parameters<typeof undoLastAction>[1]
const OK: UndoResult = { status: 'ok' }

let log = 0
function delta(over: Partial<Delta>): Delta {
  log += 1
  return {
    id: `d${log}`,
    branchId: 'b1',
    actionId: 'act_1',
    op: 'update',
    targetTable: 'entities',
    targetId: 'ent',
    entryId: null,
    source: 'user_edit',
    undoPayload: null,
    logPosition: log,
    encodingVersion: 1,
    createdAt: 1,
    ...over,
  }
}

const TURN: UndoTargetRead = {
  actionId: 'act_turn',
  deltas: [
    delta({ actionId: 'act_turn', op: 'create', targetTable: 'story_entries', targetId: 'e2' }),
  ],
  entryPositions: { e2: 2 },
}

// Newest first, as the log reads a group: an edit, then the delete that followed it.
const LORE_SAVE: UndoTargetRead = {
  actionId: 'act_save',
  deltas: [
    delta({
      actionId: 'act_save',
      op: 'delete',
      targetTable: 'lore',
      targetId: 'lore_1',
      undoPayload: { title: 'The toll' },
    }),
    delta({ actionId: 'act_save', op: 'update', targetTable: 'lore', targetId: 'lore_1' }),
  ],
  entryPositions: {},
}

const CLOSE: UndoTargetRead = {
  actionId: 'act_close',
  deltas: [
    delta({
      actionId: 'act_close',
      source: 'chapter_close',
      op: 'create',
      targetTable: 'chapters',
      targetId: 'ch3',
    }),
  ],
  entryPositions: {},
}

const RERUN: UndoTargetRead = {
  actionId: 'act_rerun',
  deltas: [
    delta({
      actionId: 'act_rerun',
      source: 'chapter_close',
      op: 'update',
      targetTable: 'chapters',
      targetId: 'ch3',
    }),
  ],
  entryPositions: {},
}

const CLOSE_UNDONE: UndoResult = { status: 'ok', closeUndone: { chapterNumber: 3 } }

let toasts: ToastItem[] = []

// An undo that lands pushes the redo group it took onto its branch's stack, as undoLastAction
// does: the target's rows as they stood before it.
function undoLands(read: UndoTargetRead, rowBeforeUndo: Record<string, unknown> | null = null) {
  actions.undoLastAction.mockImplementation(async (branchId) => {
    const snapshots = read.deltas.map((d) => ({ delta: d, rowBeforeUndo }))
    undoRedoStore.pushRedoGroup(__redoGroupForTest(branchId, snapshots, read.actionId))
    return OK
  })
}

type Props = { isFocused: boolean; held: boolean; branchId: string }

function render(initial: Partial<Props> = {}) {
  return renderHook((props: Props) => useReaderUndo({ ctx, ...props }), {
    initialProps: { isFocused: true, held: false, branchId: 'b1', ...initial },
  })
}

const LIVE: Props = { isFocused: true, held: false, branchId: 'b1' }

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  toastStore.__reset()
  toasts = []
  toastStore.subscribe((next) => {
    toasts = next
  })
  undoRedoStore.__reset()
  entitiesStore.__reset()
  loreStore.__reset()
  for (const fn of Object.values(actions)) fn.mockReset()
  actions.readUndoImpact.mockResolvedValue(null)
})
afterEach(() => cleanup())

describe('useReaderUndo — the label', () => {
  it('reads Undo last action until the target resolves as the menu opens', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    const r = render()
    expect(r.result.current.undoLabel).toBe('Undo last action')

    act(() => r.result.current.onMenuOpenChange(true))
    await waitFor(() => expect(r.result.current.undoLabel).toBe('Undo the turn at entry #2'))
  })

  it('ends an unseen target in an ellipsis, since it opens a confirm', async () => {
    actions.readUndoTarget.mockResolvedValue(CLOSE)
    entitiesStore.__reset()
    const r = render()
    act(() => r.result.current.onMenuOpenChange(true))
    // No chapter row is loaded, so the target falls to the catch-all, still unseen.
    await waitFor(() => expect(r.result.current.undoLabel).toBe('Undo the latest change…'))
  })

  it('drops a resolution that lands after the menu closed', async () => {
    let finish!: (read: UndoTargetRead) => void
    actions.readUndoTarget.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const r = render()
    act(() => r.result.current.onMenuOpenChange(true))
    act(() => r.result.current.onMenuOpenChange(false))
    await act(async () => finish(TURN))
    expect(r.result.current.undoLabel).toBe('Undo last action')
  })

  it('names Redo from the stack top, and has none with the stack empty', () => {
    const r = render()
    expect(r.result.current.redoLabel).toBeNull()
    act(() =>
      undoRedoStore.pushRedoGroup(
        __redoGroupForTest(
          'b1',
          [{ delta: TURN.deltas[0], rowBeforeUndo: { id: 'e2', position: 2 } }],
          'act_turn',
        ),
      ),
    )
    expect(r.result.current.redoLabel).toBe('Redo the turn at entry #2')
  })
})

describe('useReaderUndo — a seen target', () => {
  it('undoes the action its label named, at once, and shows the notice with Redo', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.onMenuOpenChange(true))
    await waitFor(() => expect(r.result.current.undoLabel).toContain('entry #2'))

    act(() => r.result.current.undo('menu'))
    await settle()

    expect(actions.undoLastAction).toHaveBeenCalledWith('b1', ctx, { expectedActionId: 'act_turn' })
    expect(r.result.current.confirmOpen).toBe(false)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ severity: 'info', message: 'Undid the turn at entry #2' })
    expect(toasts[0].action?.label).toBe('Redo')
  })

  it('reads the target itself on the keyboard path', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(actions.undoLastAction).toHaveBeenCalledWith('b1', ctx, { expectedActionId: 'act_turn' })
  })

  it('offers no Redo when the undo left nothing to redo', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    actions.undoLastAction.mockResolvedValue(OK)
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].action).toBeUndefined()
  })

  it("replaces an older notice with a newer undo's", async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(actions.undoLastAction).toHaveBeenCalledTimes(2)
    expect(toasts).toHaveLength(1)
  })

  it('redoes through the notice, pinned to what the undo reversed', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    actions.redoLastAction.mockResolvedValue(OK)
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()

    act(() => toasts[0].action?.onPress())
    await settle()

    expect(actions.redoLastAction).toHaveBeenCalledWith('b1', ctx, { expectedActionId: 'act_turn' })
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Redid the turn at entry #2')
    expect(toasts[0].action).toBeUndefined()
  })
})

describe('useReaderUndo — an unseen target', () => {
  it('asks first, then undoes exactly the action the confirm named', async () => {
    actions.readUndoTarget.mockResolvedValue(LORE_SAVE)
    undoLands(LORE_SAVE)
    const r = render()

    act(() => r.result.current.undo('keyboard'))
    await settle()

    expect(actions.undoLastAction).not.toHaveBeenCalled()
    expect(r.result.current.confirmOpen).toBe(true)
    const confirm = r.result.current.confirm?.props
    expect(confirm?.title).toBe('Undo deleting The toll?')
    expect(confirm?.lines).toEqual(['The toll: Modified', 'The toll: Deleted'])

    act(() => confirm?.onConfirm())
    await settle()

    expect(actions.undoLastAction).toHaveBeenCalledWith('b1', ctx, { expectedActionId: 'act_save' })
    expect(r.result.current.confirmOpen).toBe(false)
    expect(toasts[0].message).toBe('Undid deleting The toll')
  })

  it("lists a close's impact in the delete confirm's lines", async () => {
    actions.readUndoTarget.mockResolvedValue(CLOSE)
    actions.readUndoImpact.mockResolvedValue({
      createdLore: { count: 2, userEdited: true },
      otherChanges: 4,
    })
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()

    expect(actions.readUndoImpact).toHaveBeenCalledWith('b1', 'act_close', ctx)
    expect(r.result.current.confirm?.props.lines).toEqual([
      '2 lore rows removed, your edits included',
      '4 other changes reversed',
    ])
  })

  it('Cancel undoes nothing', async () => {
    actions.readUndoTarget.mockResolvedValue(LORE_SAVE)
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()
    act(() => r.result.current.confirm?.props.onCancel())
    expect(r.result.current.confirmOpen).toBe(false)
    expect(actions.undoLastAction).not.toHaveBeenCalled()
  })

  // A close a background pass started can commit under the confirm: the pin refuses it.
  it('toasts a refusal after the confirm even on the keyboard path, and shows no notice', async () => {
    actions.readUndoTarget.mockResolvedValue(LORE_SAVE)
    actions.undoLastAction.mockResolvedValue({
      status: 'rejected',
      code: 'target-moved',
      reason: 'moved',
    })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    act(() => r.result.current.confirm?.props.onConfirm())
    await settle()

    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('A newer change landed, so nothing was undone.')
    expect(toasts[0].action).toBeUndefined()
  })

  it('drops an open confirm when the screen loses focus', async () => {
    actions.readUndoTarget.mockResolvedValue(LORE_SAVE)
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()
    r.rerender({ ...LIVE, isFocused: false })
    r.rerender(LIVE)
    expect(r.result.current.confirmOpen).toBe(false)
  })
})

describe('useReaderUndo — refusals', () => {
  it('stays silent on the keyboard and toasts from the menu', async () => {
    actions.readUndoTarget.mockResolvedValue(null)
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(toasts).toHaveLength(0)

    act(() => r.result.current.undo('menu'))
    await settle()
    expect(toasts.map((toast) => toast.message)).toEqual(['Nothing to undo.'])
  })

  it('shows Redo refusals from the menu only', async () => {
    const r = render()
    act(() => r.result.current.redo('keyboard'))
    await settle()
    expect(toasts).toHaveLength(0)
    act(() => r.result.current.redo('menu'))
    await settle()
    expect(toasts.map((toast) => toast.message)).toEqual(['Nothing to redo.'])
  })

  it('redoes the stack top, pinned to it', async () => {
    undoRedoStore.pushRedoGroup(
      __redoGroupForTest(
        'b1',
        [{ delta: TURN.deltas[0], rowBeforeUndo: { id: 'e2', position: 2 } }],
        'act_turn',
      ),
    )
    actions.redoLastAction.mockResolvedValue(OK)
    const r = render()
    act(() => r.result.current.redo('menu'))
    await settle()
    expect(actions.redoLastAction).toHaveBeenCalledWith('b1', ctx, { expectedActionId: 'act_turn' })
    expect(toasts[0].message).toBe('Redid the turn at entry #2')
  })
})

describe('useReaderUndo — review fixes', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it("holds the notice's Redo while an editor is open", async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    r.rerender({ ...LIVE, held: true })

    act(() => toasts[0].action?.onPress())
    await settle()

    expect(actions.redoLastAction).not.toHaveBeenCalled()
    expect(toasts.at(-1)?.message).toBe('Finish or cancel the edit first.')
  })

  it("dismisses the notice when the branch changes, its Redo being the old branch's", async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(toasts).toHaveLength(1)

    r.rerender({ ...LIVE, branchId: 'b2' })
    expect(toasts).toHaveLength(0)
  })

  // A pass or close holding the gate refuses every undo but a turn's, and a turn is always seen.
  it('refuses an unseen target under a run without asking first', async () => {
    actions.readUndoTarget.mockResolvedValue(LORE_SAVE)
    const run: RunState = {
      runId: 'run_pass',
      kind: 'periodic-classifier',
      gateBehavior: 'hard-gate',
      actionId: 'act_pass',
      storyId: 's1',
      branchId: 'b1',
      abortController: new AbortController(),
      currentPhase: 'classify',
      intermediates: {},
      terminal: new Promise<void>(() => {}),
      resolveTerminal: () => {},
      interruptible: 'pass',
      beforeTurn: false,
    }
    generationStore.startRun(run)
    const r = render()

    act(() => r.result.current.undo('menu'))
    await settle()

    expect(r.result.current.confirmOpen).toBe(false)
    expect(actions.undoLastAction).not.toHaveBeenCalled()
    expect(toasts.map((toast) => toast.message)).toEqual(['Unavailable while generating.'])
    generationStore.__reset()
  })

  it('drops a confirm whose lines resolve after the screen lost focus', async () => {
    actions.readUndoTarget.mockResolvedValue(CLOSE)
    const impact = deferred<Awaited<ReturnType<typeof readUndoImpact>>>()
    actions.readUndoImpact.mockReturnValue(impact.promise)
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()
    r.rerender({ ...LIVE, isFocused: false })

    await act(async () =>
      impact.resolve({ createdLore: { count: 1, userEdited: false }, otherChanges: 0 }),
    )
    await settle()
    r.rerender(LIVE)

    expect(r.result.current.confirmOpen).toBe(false)
  })

  it('holds a seen undo when an editor opened while its target was read', async () => {
    const read = deferred<UndoTargetRead | null>()
    actions.readUndoTarget.mockReturnValue(read.promise)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    r.rerender({ ...LIVE, held: true })

    await act(async () => read.resolve(TURN))
    await settle()

    expect(actions.undoLastAction).not.toHaveBeenCalled()
    expect(toasts).toHaveLength(0)
  })

  it('names a created row in the notice although the undo removed it', async () => {
    const created: UndoTargetRead = {
      actionId: 'act_add',
      deltas: [
        delta({ actionId: 'act_add', op: 'create', targetTable: 'lore', targetId: 'lore_new' }),
      ],
      entryPositions: {},
    }
    loreStore.hydrate('b1', [makeLore({ id: 'lore_new', title: 'The new toll' })])
    actions.readUndoTarget.mockResolvedValue(created)
    actions.undoLastAction.mockImplementation(async () => {
      loreStore.hydrate('b1', [])
      return OK
    })
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()
    expect(r.result.current.confirm?.props.title).toBe('Undo adding The new toll?')

    act(() => r.result.current.confirm?.props.onConfirm())
    await settle()

    expect(toasts.map((toast) => toast.message)).toEqual(['Undid adding The new toll'])
  })

  it('names a redone delete in its notice although the redo removed the row', async () => {
    loreStore.hydrate('b1', [makeLore({ id: 'lore_1', title: 'The toll' })])
    const snapshots = LORE_SAVE.deltas.map((d) => ({ delta: d, rowBeforeUndo: null }))
    undoRedoStore.pushRedoGroup(__redoGroupForTest('b1', snapshots, LORE_SAVE.actionId))
    actions.redoLastAction.mockImplementation(async () => {
      loreStore.hydrate('b1', [])
      return OK
    })
    const r = render()
    act(() => r.result.current.redo('menu'))
    await settle()

    expect(toasts.map((toast) => toast.message)).toEqual(['Redid deleting The toll'])
  })

  it('lists the rows when the impact read fails, rather than failing the undo', async () => {
    actions.readUndoTarget.mockResolvedValue(CLOSE)
    actions.readUndoImpact.mockRejectedValue(new Error('locked'))
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()

    expect(r.result.current.confirmOpen).toBe(true)
    expect(r.result.current.confirm?.props.lines).toEqual(['and 1 more'])
  })
})

describe('useReaderUndo — the reversal meter', () => {
  beforeEach(() => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    // The meter reads the monotonic clock, which setSystemTime doesn't move; tie it to the fake
    // Date so a setSystemTime still holds the thread with no tick run.
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    __resetDiagnosticsGate()
  })

  // The fake clock stands in for settle()'s real timeout; past the tail, the entry has landed.
  const settle = () => act(() => vi.advanceTimersByTimeAsync(0))
  const pastTail = () => act(() => vi.advanceTimersByTimeAsync(1_000))

  const measured = () =>
    getDiagnosticsSnapshot()
      .logEntries.filter(
        ({ kind }) => kind === 'reader.undo_measured' || kind === 'reader.redo_measured',
      )
      .map(({ kind, fields }) => ({ kind, fields }))

  it("times the undo's own wait, never the confirm before it", async () => {
    actions.readUndoTarget.mockResolvedValue(LORE_SAVE)
    actions.undoLastAction.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 700)
      return OK
    })
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()
    // The user reads the confirm for five seconds.
    vi.setSystemTime(Date.now() + 5_000)
    act(() => r.result.current.confirm?.props.onConfirm())
    await settle()
    await pastTail()

    expect(measured()).toEqual([
      {
        kind: 'reader.undo_measured',
        fields: { wallMs: 700, longestGapMs: 700, tailGapMs: 16, actionId: 'act_save' },
      },
    ])
  })

  it("times a redo the notice's Redo starts", async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    actions.redoLastAction.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 640)
      return OK
    })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    await pastTail()
    act(() => toasts[0].action?.onPress())
    await settle()
    await pastTail()

    expect(measured()).toEqual([
      {
        kind: 'reader.undo_measured',
        fields: { wallMs: 0, longestGapMs: 0, tailGapMs: 16, actionId: 'act_turn' },
      },
      {
        kind: 'reader.redo_measured',
        fields: { wallMs: 640, longestGapMs: 640, tailGapMs: 16, actionId: 'act_turn' },
      },
    ])
  })

  it('logs nothing for a refused undo', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    actions.undoLastAction.mockResolvedValue({
      status: 'rejected',
      code: 'target-moved',
      reason: 'moved',
    })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    await pastTail()

    expect(actions.undoLastAction).toHaveBeenCalledTimes(1)
    expect(measured()).toEqual([])
  })

  it('starts no meter while the debug level is off, and still undoes', async () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => false })
    const ticks = vi.spyOn(globalThis, 'setInterval')
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()

    expect(actions.undoLastAction).toHaveBeenCalledWith('b1', ctx, { expectedActionId: 'act_turn' })
    expect(ticks).not.toHaveBeenCalled()
  })

  it('starts no meter while diagnostics are off, whatever the debug level', async () => {
    configureDiagnosticsGate({ isEnabled: () => false, isDebugEnabled: () => true })
    const ticks = vi.spyOn(globalThis, 'setInterval')
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    await pastTail()

    expect(actions.undoLastAction).toHaveBeenCalledTimes(1)
    expect(ticks).not.toHaveBeenCalled()
    expect(measured()).toEqual([])
  })

  it('starts the meter with the gate on', async () => {
    const ticks = vi.spyOn(globalThis, 'setInterval')
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()

    expect(ticks).toHaveBeenCalledWith(expect.any(Function), 16)
  })

  it("reports a stall after the reversal resolves as tailGapMs, not in the reversal's own gap", async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(measured()).toEqual([])
    vi.setSystemTime(Date.now() + 400)
    await pastTail()

    expect(measured()).toEqual([
      {
        kind: 'reader.undo_measured',
        fields: { wallMs: 0, longestGapMs: 0, tailGapMs: 416, actionId: 'act_turn' },
      },
    ])
  })

  it('logs the tail after an unmount, and leaves no timer behind', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    r.unmount()
    await pastTail()

    expect(measured()).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the meter when the reversal throws, and logs nothing', async () => {
    const ticks = vi.spyOn(globalThis, 'setInterval')
    const cleared = vi.spyOn(globalThis, 'clearInterval')
    actions.readUndoTarget.mockResolvedValue(TURN)
    actions.undoLastAction.mockRejectedValue(new Error('boom'))
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    await pastTail()

    expect(ticks).toHaveBeenCalledTimes(1)
    expect(cleared).toHaveBeenCalledWith(ticks.mock.results[0].value)
    expect(measured()).toEqual([])
  })
})

// reader-composer.md → Undo and redo: the confirm says when the undo will take the close too.
describe("useReaderUndo — a re-run's confirm", () => {
  const TAKES_CLOSE = "This also undoes chapter 3's close: its earlier close can't be restored."

  it("adds the close's line when the re-run's earlier close can't be restored", async () => {
    actions.readUndoTarget.mockResolvedValue(RERUN)
    actions.readUndoImpact.mockResolvedValue({
      createdLore: { count: 2, userEdited: false },
      otherChanges: 4,
      closeUndone: { chapterNumber: 3 },
    })
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()

    expect(r.result.current.confirm?.props.lines).toEqual([
      '2 lore rows removed',
      '4 other changes reversed',
      TAKES_CLOSE,
    ])
  })

  it("adds it under the group's own rows when there are no counts to list", async () => {
    actions.readUndoTarget.mockResolvedValue(RERUN)
    actions.readUndoImpact.mockResolvedValue({
      createdLore: { count: 0, userEdited: false },
      otherChanges: 0,
      closeUndone: { chapterNumber: 3 },
    })
    const r = render()
    act(() => r.result.current.undo('menu'))
    await settle()

    expect(r.result.current.confirm?.props.lines.at(-1)).toBe(TAKES_CLOSE)
    expect(r.result.current.confirm?.props.lines.length).toBeGreaterThan(1)
  })
})

// reader-composer.md → Undo and redo: an undo that raises its own warning shows it instead.
describe('useReaderUndo — a re-run undone with no journal to write back', () => {
  it.each(['menu', 'keyboard'] as const)(
    'shows the warning instead of the notice, from the %s',
    async (origin) => {
      actions.readUndoTarget.mockResolvedValue(RERUN)
      actions.undoLastAction.mockResolvedValue(CLOSE_UNDONE)
      const r = render()
      act(() => r.result.current.undo(origin))
      await settle()
      act(() => r.result.current.confirm?.props.onConfirm())
      await settle()

      expect(actions.undoLastAction).toHaveBeenCalledWith('b1', ctx, {
        expectedActionId: 'act_rerun',
      })
      expect(
        toasts.map(({ severity, message, action }) => ({ severity, message, action })),
      ).toEqual([
        {
          severity: 'warning',
          message: "Chapter 3's earlier close couldn't be restored, so its close was undone.",
          action: undefined,
        },
      ])
    },
  )

  it('dismisses an older notice, whose Redo the undo cleared', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(toasts.map((item) => item.message)).toEqual(['Undid the turn at entry #2'])

    actions.readUndoTarget.mockResolvedValue(RERUN)
    actions.undoLastAction.mockResolvedValue(CLOSE_UNDONE)
    act(() => r.result.current.undo('keyboard'))
    await settle()
    act(() => r.result.current.confirm?.props.onConfirm())
    await settle()

    expect(toasts.map((item) => item.severity)).toEqual(['warning'])
  })
})

// A store sync that failed after the undo committed: the close is undone whatever the error says.
describe('useReaderUndo — a re-run undone, then its store sync fails', () => {
  const syncFailure = (rerun?: DeltaReplayError['rerun']) =>
    new DeltaReplayError('store sync boom', {
      cause: 'store sync boom',
      actionId: 'act_rerun',
      stage: 'store-sync',
      rerun,
    })

  async function undoRerunThrowing(error: Error) {
    actions.readUndoTarget.mockResolvedValue(RERUN)
    actions.undoLastAction.mockRejectedValue(error)
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    act(() => r.result.current.confirm?.props.onConfirm())
    await settle()
  }

  beforeEach(() => {
    clearBuffers()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => false })
  })
  afterEach(() => __resetDiagnosticsGate())

  const shown = () => toasts.map(({ severity, message }) => ({ severity, message }))

  it('shows the close-undone warning for a committed undone outcome, and logs the failure', async () => {
    await undoRerunThrowing(syncFailure({ journal: 'undone', chapterNumber: 3 }))

    expect(shown()).toEqual([
      {
        severity: 'warning',
        message: "Chapter 3's earlier close couldn't be restored, so its close was undone.",
      },
    ])
    expect(
      getDiagnosticsSnapshot()
        .logEntries.filter(({ kind }) => kind === 'reader.undo_failed')
        .map(({ level, fields }) => ({ level, fields })),
    ).toEqual([
      { level: 'error', fields: { branchId: 'b1', committed: true, error: 'store sync boom' } },
    ])
  })

  it('dismisses an older notice, whose Redo the undo cleared', async () => {
    actions.readUndoTarget.mockResolvedValue(TURN)
    undoLands(TURN, { id: 'e2', position: 2 })
    const r = render()
    act(() => r.result.current.undo('keyboard'))
    await settle()
    expect(toasts).toHaveLength(1)

    actions.readUndoTarget.mockResolvedValue(RERUN)
    actions.undoLastAction.mockRejectedValue(syncFailure({ journal: 'undone', chapterNumber: 3 }))
    act(() => r.result.current.undo('keyboard'))
    await settle()
    act(() => r.result.current.confirm?.props.onConfirm())
    await settle()

    expect(toasts.map((item) => item.severity)).toEqual(['warning'])
  })

  it.each([
    [
      'an undo that never committed',
      new DeltaReplayError('x', { cause: 'x', actionId: 'a', stage: 'transaction' }),
    ],
    ['a committed restore', syncFailure({ journal: 'restored' })],
    ['a committed failure carrying no outcome', syncFailure()],
    ['an error that is no replay failure', new Error('boom')],
  ])('keeps the generic failure for %s', async (_label, error) => {
    await undoRerunThrowing(error)

    expect(shown()).toEqual([{ severity: 'error', message: "Couldn't undo. Please try again." }])
  })
})
