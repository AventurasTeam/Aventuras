// components/reader/reader-slice.ts
// Pure: the surface imports the cap from here into the reader document's bundle.

/** reader-composer.md → Loaded-set model: the document renders at most this many rows at rest. */
export const SLICE_CAP = 50
/** Half the cap, so the rows a trim removes are always far from the viewport. */
export const SLICE_STEP = 25

export type SliceRow = { id: string; position: number }

/**
 * The document's slice of the store's window, by entry position, so rows the window gains or loses
 * move it no further than they move themselves.
 */
export type SliceState = {
  branchId: string
  top: number
  /** Null while the slice ends at the branch tail, which new turns then extend. */
  bottom: number | null
  /** Rises whenever the bounds change; the document's jumps name the key they wait for. */
  key: number
  /** Rows may exist above the window: a full page means maybe-more, a short one proves the top. */
  windowHasOlder: boolean
}

/** A boundary request from the document, measured on the slice it names. */
export type SliceRequest = {
  sliceKey: number
  /** The farthest row on the trimmed side within a viewport-height of the viewport. */
  keepId: string
}

export type TrimRequest = SliceRequest & { end: 'top' | 'bottom' }

/** Where a jump's target sits: in the slice with its row above, in the window, or to be read. */
export type JumpClass = 'slice' | 'window' | 'read'

export type SliceView<T extends SliceRow> = {
  rows: T[]
  /** Rows may exist above the slice, in the window or above it. */
  hasOlder: boolean
  /** The slice stops short of the branch tail. */
  hasNewer: boolean
  sliceKey: number
  /** A state the caller must store: an open, a fallback or a normalized bottom. */
  next: SliceState | null
}

type Bounds = { topIdx: number; bottomIdx: number }

/** Binary search; window positions only ever rise. */
function firstIndexWhere(
  window: readonly SliceRow[],
  passes: (position: number) => boolean,
): number {
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (passes(window[mid].position)) hi = mid
    else lo = mid + 1
  }
  return lo
}

function boundsOf(state: SliceState, window: readonly SliceRow[]): Bounds {
  const { top, bottom } = state
  const topIdx = firstIndexWhere(window, (position) => position >= top)
  const bottomIdx =
    bottom == null
      ? window.length - 1
      : firstIndexWhere(window, (position) => position > bottom) - 1
  return { topIdx, bottomIdx }
}

const indexOfId = (window: readonly SliceRow[], id: string) =>
  window.findIndex((row) => row.id === id)

// One key bump for any change the document renders: the bounds or the top skeleton.
function commit(
  state: SliceState,
  patch: Partial<Pick<SliceState, 'top' | 'bottom' | 'windowHasOlder'>>,
): SliceState | null {
  const next = { ...state, ...patch }
  if (
    next.top === state.top &&
    next.bottom === state.bottom &&
    next.windowHasOlder === state.windowHasOlder
  )
    return null
  return { ...next, key: state.key + 1 }
}

function withBounds(
  state: SliceState,
  window: readonly SliceRow[],
  topIdx: number,
  bottomIdx: number,
  windowHasOlder = state.windowHasOlder,
): SliceState | null {
  return commit(state, {
    top: window[topIdx].position,
    bottom: bottomIdx >= window.length - 1 ? null : window[bottomIdx].position,
    windowHasOlder,
  })
}

/**
 * On branch open the slice is the window at the tail, or its last {@link SLICE_CAP} rows: a
 * story reopened while its branch is still loaded keeps the window an earlier jump grew.
 */
export function openSlice(
  branchId: string,
  window: readonly SliceRow[],
  windowHasOlder: boolean,
  previousKey: number,
): SliceState {
  return {
    branchId,
    top: window[Math.max(0, window.length - SLICE_CAP)]?.position ?? 0,
    bottom: null,
    key: previousKey + 1,
    windowHasOlder,
  }
}

/** The tail's last {@link SLICE_CAP} rows; null when the slice is already that. */
export function resetToTail(state: SliceState, window: readonly SliceRow[]): SliceState | null {
  if (window.length === 0) return null
  return withBounds(state, window, Math.max(0, window.length - SLICE_CAP), window.length - 1)
}

/** A reload replaced the window with its recent page: the tail's last rows, and its top anew. */
export function reloadSlice(
  state: SliceState,
  window: readonly SliceRow[],
  windowHasOlder: boolean,
): SliceState | null {
  if (window.length === 0) return commit(state, { windowHasOlder })
  return withBounds(
    state,
    window,
    Math.max(0, window.length - SLICE_CAP),
    window.length - 1,
    windowHasOlder,
  )
}

/**
 * What a read proved about rows above the window, on its own key: a landing named after a proven
 * top waits for the commit that drops the top skeleton instead of shifting when it goes.
 */
export function markWindowTop(state: SliceState, windowHasOlder: boolean): SliceState | null {
  return commit(state, { windowHasOlder })
}

/**
 * Extends the slice up by {@link SLICE_STEP} and trims its bottom back to {@link SLICE_CAP} in the
 * same write, never past the keep row; after a read, `windowHasOlder` is what it proved, same key.
 * Null when the request names another slice or nothing changes.
 */
export function extendUp(
  state: SliceState,
  window: readonly SliceRow[],
  request: SliceRequest,
  windowHasOlder = state.windowHasOlder,
): SliceState | null {
  if (request.sliceKey !== state.key) return null
  const { topIdx, bottomIdx } = boundsOf(state, window)
  if (topIdx > bottomIdx) return null
  const nextTopIdx = Math.max(0, topIdx - SLICE_STEP)
  return withBounds(
    state,
    window,
    nextTopIdx,
    trimmedBottom(window, nextTopIdx, bottomIdx, request),
    windowHasOlder,
  )
}

/** Extends the slice down by {@link SLICE_STEP} rows and trims its top back to the cap. */
export function extendDown(
  state: SliceState,
  window: readonly SliceRow[],
  request: SliceRequest,
): SliceState | null {
  if (request.sliceKey !== state.key || state.bottom == null) return null
  const { topIdx, bottomIdx } = boundsOf(state, window)
  if (topIdx > bottomIdx) return null
  const nextBottomIdx = Math.min(window.length - 1, bottomIdx + SLICE_STEP)
  return withBounds(
    state,
    window,
    trimmedTop(window, topIdx, nextBottomIdx, request),
    nextBottomIdx,
  )
}

/** Trims the named end back to the cap, never past the keep row. */
export function trimSlice(
  state: SliceState,
  window: readonly SliceRow[],
  request: TrimRequest,
): SliceState | null {
  if (request.sliceKey !== state.key) return null
  const { topIdx, bottomIdx } = boundsOf(state, window)
  if (topIdx > bottomIdx) return null
  return request.end === 'top'
    ? withBounds(state, window, trimmedTop(window, topIdx, bottomIdx, request), bottomIdx)
    : withBounds(state, window, topIdx, trimmedBottom(window, topIdx, bottomIdx, request))
}

// A keep row gone from the window trims nothing: the next rest measures again.
function trimmedBottom(
  window: readonly SliceRow[],
  topIdx: number,
  bottomIdx: number,
  request: SliceRequest,
): number {
  if (bottomIdx - topIdx + 1 <= SLICE_CAP) return bottomIdx
  const keepIdx = indexOfId(window, request.keepId)
  if (keepIdx < 0) return bottomIdx
  return Math.min(bottomIdx, Math.max(topIdx + SLICE_CAP - 1, keepIdx))
}

function trimmedTop(
  window: readonly SliceRow[],
  topIdx: number,
  bottomIdx: number,
  request: SliceRequest,
): number {
  if (bottomIdx - topIdx + 1 <= SLICE_CAP) return topIdx
  const keepIdx = indexOfId(window, request.keepId)
  if (keepIdx < 0) return topIdx
  return Math.max(topIdx, Math.min(bottomIdx - SLICE_CAP + 1, keepIdx))
}

/**
 * A jump lands at once when its target and the row above it (whose break the landing opens under)
 * are in the slice, or the target is the proven branch top; an unproven window top needs a read.
 */
export function classifyJump(
  state: SliceState,
  window: readonly SliceRow[],
  targetId: string,
): JumpClass {
  const idx = indexOfId(window, targetId)
  if (idx < 0 || (idx === 0 && state.windowHasOlder)) return 'read'
  const { topIdx, bottomIdx } = boundsOf(state, window)
  const inSlice = (i: number) => i >= topIdx && i <= bottomIdx
  return inSlice(idx) && (idx === 0 || inSlice(idx - 1)) ? 'slice' : 'window'
}

/**
 * {@link SLICE_CAP} rows from the row above the target down, or the tail's last {@link SLICE_CAP}
 * when they'd reach the tail. Null when the jump lands at once or the target isn't in the window.
 */
export function placeJump(
  state: SliceState,
  window: readonly SliceRow[],
  targetId: string,
): SliceState | null {
  const idx = indexOfId(window, targetId)
  if (idx < 0 || classifyJump(state, window, targetId) === 'slice') return null
  const startIdx = Math.max(0, idx - 1)
  const n = window.length
  const [topIdx, bottomIdx] =
    n - startIdx <= SLICE_CAP
      ? [Math.max(0, n - SLICE_CAP), n - 1]
      : [startIdx, startIdx + SLICE_CAP - 1]
  return withBounds(state, window, topIdx, bottomIdx)
}

/**
 * Another branch's state opens the slice; an emptied slice falls back to the tail's last cap;
 * a bottom with nothing below becomes the tail, so new turns extend it. Each returns `next`.
 */
export function deriveSlice<T extends SliceRow>(
  state: SliceState | null,
  branchId: string,
  window: readonly T[],
  pageSize: number,
): SliceView<T> {
  if (state == null || state.branchId !== branchId) {
    if (window.length === 0)
      return { rows: [], hasOlder: false, hasNewer: false, sliceKey: state?.key ?? 0, next: null }
    const opened = openSlice(branchId, window, window.length >= pageSize, state?.key ?? 0)
    return { ...viewOf(opened, window), next: opened }
  }
  if (window.length === 0) return { ...viewOf(state, window), next: null }
  const { topIdx, bottomIdx } = boundsOf(state, window)
  let next: SliceState | null = null
  if (topIdx > bottomIdx) next = resetToTail(state, window)
  else if (state.bottom != null && bottomIdx === window.length - 1)
    next = { ...state, bottom: null, key: state.key + 1 }
  return { ...viewOf(next ?? state, window), next }
}

function viewOf<T extends SliceRow>(
  state: SliceState,
  window: readonly T[],
): Omit<SliceView<T>, 'next'> {
  const { topIdx, bottomIdx } = boundsOf(state, window)
  return {
    rows: window.slice(topIdx, bottomIdx + 1),
    hasOlder: state.windowHasOlder || topIdx > 0,
    hasNewer: bottomIdx < window.length - 1,
    sliceKey: state.key,
  }
}

/**
 * reader-document.md → Bridge contract: the open editor's row while it is in the window but not
 * the slice, so its draft, dirty check and Save survive the row leaving the slice.
 */
export function editingRowOf<T extends SliceRow & { content: string }>(
  window: readonly T[],
  slice: readonly T[],
  entryId: string | null,
): { id: string; content: string } | null {
  if (entryId == null || slice.some((row) => row.id === entryId)) return null
  const row = window.find((candidate) => candidate.id === entryId)
  return row == null ? null : { id: row.id, content: row.content }
}
