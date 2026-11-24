// components/reader/reader-document-types.ts
import type { CalendarFrame } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'

import type { ChapterBreaks } from './chapter-breaks'
import type { SliceRequest, TrimRequest } from './reader-slice'
import type { StreamingTokens } from './streaming-tokens'
import type { WorldTimeDecoration } from './worldtime-decoration'

/** The live reply; `tokens` are the reply and reasoning counted per chunk as they arrive. */
export type StreamingPayload = {
  content: string
  reasoning: string
  tokens: StreamingTokens
}

// `code` is the action layer's rejection code, so a caller can say WHY rather than
// offering a retry the refusal will never accept.
export type EditResult = { ok: true } | { ok: false; code?: string }

/** An open inline editor: the entry it edits, and whether the draft differs from the stored text. */
export type EditSession = { entryId: string; dirty: boolean }

/** An editor's row outside the slice: its id and stored text. */
export type EditingRow = { id: string; content: string }

/**
 * The jumps name the slice key they land on: rows and a call cross the bridge apart, so the
 * document holds a jump until it has committed a slice at that key or past it.
 */
export type ReaderSurfaceHandle = {
  jumpToBottom: (sliceKey: number) => void
  jumpToEntry: (entryId: string, sliceKey: number) => void
  /** The open editor's session, read now; null with no editor open. */
  editSession: () => EditSession | null
  /** The editor's plain Save (never Save & regenerate). With no editor open it counts as clean. */
  commitDraft: () => Promise<EditResult>
  /** Closes the editor and drops its draft. */
  discardDraft: () => void
}

/**
 * What the row controls may do: `open` lets everything through; `interruptible` (only a pass or a
 * close holds the gate) lets the head reversals through — ↻, × and the head turn's pencil — each
 * interrupting it; `closed` gates every control.
 */
export type EditGate = 'open' | 'interruptible' | 'closed'

/**
 * Bridge contract (reader-document.md → Bridge contract): every field must be
 * JSON-serializable and every function must be async — on native these cross
 * the expo-dom bridge. Web consumes the identical shape inline.
 */
export type ReaderSurfaceProps = {
  /** The window's slice (reader-composer.md → Loaded-set model): at most 50 rows at rest. */
  rows: StoryEntry[]
  /** Host-computed world-time labels + monotonicity flags, by entry id. Side table, not merged
   *  into `rows`: merging hands ReaderRow fresh objects each patch and voids its memo on web. */
  worldTimeDecorations: Record<string, WorldTimeDecoration>
  /** By end entry id; a side table, for the same reason as worldTimeDecorations. */
  chapterBreaks: ChapterBreaks
  /** Rows that may end a chapter; a side table, as worldTimeDecorations. */
  closeHereEntryIds: Record<string, true>
  /** Registry-resolved calendar + story origin (fallback applied) — null hides/inerts footers. */
  worldTimeFrame: CalendarFrame | null
  /** Non-null only while the streaming row should be visible (host-gated). */
  streaming: StreamingPayload | null
  /** Branch identity: a change resets edit state and re-lands at the bottom. */
  branchKey: string
  /**
   * Rows may exist above the slice: in the window, or above it by window-size math (a short load
   * proves the branch top is in the window). Drives the top boundary shimmer and gates onNearTop.
   */
  hasOlder: boolean
  /**
   * The slice stops short of the branch tail: drives the bottom shimmer, gates onNearBottom, keeps
   * the jump button up and turns the bottom-anchored behaviors off.
   */
  hasNewer: boolean
  /** Rises whenever the slice's bounds change; the imperative jumps name the one they expect. */
  sliceKey: number
  /** The open editor's row while it is in the window but not the slice, else null. */
  editingRow: EditingRow | null
  editGate: EditGate
  /** The tooltip on the row controls `editGate` disables; undefined while it is `open`. */
  gateReason?: string
  /** A re-run holds ↻ and × on every chapter-stamped row (`rerunHoldsReversal`), disabled with
   * `gateReason` whatever `editGate` allows. */
  stampedReversalsHeld?: boolean
  jumpButtonEnabled: boolean
  /** Present when the system entry has a kind-specific fix route (host-derived label). */
  systemFixLabel?: string
  /** `Fix profile`'s label for a cut-off notice; the notice shows no action when unset. */
  cutOffFixLabel?: string
  /** Extend the slice up; fired at scroll rest while hasOlder holds. */
  onNearTop: (request: SliceRequest) => Promise<void>
  /** Extend the slice down; fired at scroll rest while hasNewer holds. */
  onNearBottom: (request: SliceRequest) => Promise<void>
  /** The slice holds more than 50 rows: trim the end farther from the viewport. */
  onTrim: (request: TrimRequest) => Promise<void>
  /** The document's Jump to bottom short of the tail: the host swaps the slice and jumps. */
  onJumpToBottom: () => Promise<void>
  onCommitEdit: (entryId: string, content: string) => Promise<EditResult>
  onRequestRollback: (entryId: string) => Promise<void>
  onEditWorldTime: (entryId: string, nextWorldTime: number) => Promise<EditResult>
  /** Phone tier: the document requests; the host presents the native Sheet. */
  onRequestEditWorldTime: (entryId: string) => Promise<void>
  /** Resolution pool for every id the world-state panel renders. Stable identity on web. */
  entityNames: readonly { id: string; name?: string }[]
  /** Candidate pool for the scene editor's selects. Stable identity on web. */
  sceneOptions: {
    characters: { id: string; name: string }[]
    items: { id: string; name: string }[]
    locations: { id: string; name: string }[]
  }
  /** Scene fields are editable on the last entry only; null on an empty branch. */
  tailEntryId: string | null
  onEditScene: (
    entryId: string,
    next: { sceneEntities: string[]; currentLocationId: string | null },
  ) => Promise<EditResult>
  /** Phone tier: the document requests; the host presents the native Sheet. */
  onRequestEditScene: (entryId: string) => void
  onRegenerate: (entryId: string) => Promise<void>
  /** Opens the close modal with this entry picked. */
  onCloseChapterHere: (entryId: string) => Promise<void>
  /** ⎇ on a reply or the opening: opens the creation modal. Must settle, never reject. */
  onBranch: (entryId: string) => Promise<void>
  /** Undefined when the system entry offers no Retry (a branch held `running`). */
  onRetrySystemEntry: (() => Promise<void>) | undefined
  onDismissSystemEntry: () => Promise<void>
  /** A system entry's kept text or detail: the host writes the clipboard and toasts. */
  onCopySystemText: (text: string) => Promise<void>
  onFixSystemEntry: () => Promise<void>
  onFixCutOff: () => Promise<void>
  /** A landing's first frame has painted, or its target was dropped. Must settle, never reject. */
  onEntryLanded: (entryId: string) => Promise<void>
  /**
   * The inline editor's session on each transition (opened, closed, dirty flipped), never per
   * keystroke. Must settle, never reject.
   */
  onEditSession: (session: EditSession | null) => Promise<void>
}
