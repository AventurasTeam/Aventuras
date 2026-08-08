/**
 * What retrieval put in the prompt for one turn, in the shape the debug panel reads.
 *
 * Stored on the narration entry's metadata rather than kept in memory: the in-memory copy
 * belongs to the run that produced it, so the panel was empty on every fresh start and
 * after every story switch — exactly when you most want to know what the narrator is
 * being told.
 *
 * Names and tiers only. This is a diagnostic, not a cache: nothing reads it back into a
 * prompt, and it has to stay small enough to sit on every narration row.
 */

export interface RetrievalSnapshotEntry {
  /** The record's own id, so the panel can act on it — change a mode, open an editor. */
  id: string
  tier: number
  type: string
  name: string
  /** Why it came in — the match reason, where the source has one. */
  reason?: string
  /** Tier 1 only: pinned by the author rather than carried over from a recent turn. */
  alwaysInject?: boolean
  /** Tier 1 only: story positions of carry-over left. Two per turn. */
  stickyPositionsLeft?: number
  /** Tier 1 only: the full window for this type, so the panel can show progress. */
  stickyPositionsTotal?: number
  /** Tier 3 only: the model picked this, rather than it fitting under the budget. */
  llmSelected?: boolean
  /** Tier 2 only: matched on the second pass, through something the first pass found. */
  viaScene?: boolean
}

/** Tokens the two blocks cost in the prompt, counted once when they were built. */
export interface RetrievalSnapshotTokens {
  lorebook: number
  worldState: number
}

export interface RetrievalSnapshot {
  lorebook: RetrievalSnapshotEntry[]
  worldState: RetrievalSnapshotEntry[]
  tokens?: RetrievalSnapshotTokens
}

/** The two source shapes, reduced to what they have in common. */
interface TieredLorebook {
  all: {
    tier: number
    matchReason?: string
    stickyPositionsLeft?: number
    stickyPositionsTotal?: number
    llmSelected?: boolean
    viaScene?: boolean
    entry: { id: string; type: string; name: string; injection: { mode: string } }
  }[]
  contextBlock?: string
}
interface TieredWorldState {
  all: {
    id: string
    tier: number
    type: string
    name: string
    stickyPositionsLeft?: number
    stickyPositionsTotal?: number
    llmSelected?: boolean
    viaScene?: boolean
  }[]
  contextBlock?: string
}

/**
 * Build the snapshot, and price the two blocks while their text is still in hand.
 *
 * Counted here rather than when the panel opens because the blocks themselves are not
 * stored — they are several KB each and would sit on every narration row — so on a fresh
 * start there would be nothing left to count. Two `countTokens` calls per turn, on strings
 * already about to be sent to a model, after the generation they belong to.
 */
export function toRetrievalSnapshot(
  lorebook: TieredLorebook | null | undefined,
  worldState: TieredWorldState | null | undefined,
  countTokens: (text: string) => number = () => 0,
): RetrievalSnapshot | null {
  const snapshot: RetrievalSnapshot = {
    lorebook: (lorebook?.all ?? []).map((r) => ({
      id: r.entry.id,
      tier: r.tier,
      type: r.entry.type,
      name: r.entry.name,
      reason: r.matchReason,
      alwaysInject: r.entry.injection.mode === 'always',
      stickyPositionsLeft: r.stickyPositionsLeft,
      stickyPositionsTotal: r.stickyPositionsTotal,
      llmSelected: r.llmSelected,
      viaScene: r.viaScene,
    })),
    worldState: (worldState?.all ?? []).map((e) => ({
      id: e.id,
      tier: e.tier,
      type: e.type,
      name: e.name,
      // World state Tier 1 is pinned by live state (present, carried, active), not authored.
      stickyPositionsLeft: e.stickyPositionsLeft,
      stickyPositionsTotal: e.stickyPositionsTotal,
      llmSelected: e.llmSelected,
      viaScene: e.viaScene,
    })),
    tokens: {
      lorebook: lorebook?.contextBlock ? countTokens(lorebook.contextBlock) : 0,
      worldState: worldState?.contextBlock ? countTokens(worldState.contextBlock) : 0,
    },
  }

  // Nothing retrieved is not worth a row on disk, and an empty snapshot would overwrite a
  // useful one from the previous turn.
  if (snapshot.lorebook.length === 0 && snapshot.worldState.length === 0) return null
  return snapshot
}

/**
 * Story positions as turns, rounded up.
 *
 * A turn appends a user action and a narration, so every duration in this system is two
 * positions long. The panel says "turns" because that is what the player counts; the
 * services stay in positions because that is what they measure.
 */
export function positionsToTurns(positions: number): number {
  return Math.ceil(positions / 2)
}

/** Total entries in a snapshot, for the header badge. */
export function snapshotSize(snapshot: RetrievalSnapshot | null | undefined): number {
  if (!snapshot) return 0
  return snapshot.lorebook.length + snapshot.worldState.length
}

/**
 * Split Tier 2 by which pass found it.
 *
 * A second-pass hit is relevance at one remove — it came in because something *else* the
 * scene named refers to it. Worth seeing apart, since it is the one that can widen the
 * prompt without anyone having mentioned the entry.
 */
export function splitTier2(entries: RetrievalSnapshotEntry[]): {
  direct: RetrievalSnapshotEntry[]
  viaScene: RetrievalSnapshotEntry[]
} {
  const tier2 = entries.filter((e) => e.tier === 2)
  return {
    direct: tier2.filter((e) => !e.viaScene),
    viaScene: tier2.filter((e) => e.viaScene),
  }
}

/**
 * Split Tier 3 by how it got there.
 *
 * Both branches land in the same tier and behave nothing alike: one is "the leftover was
 * small enough to send", which costs prompt and no call; the other is "the model was paid
 * to choose", which is a relevance judgement. Labelling both "LLM Selected" says a call was
 * made on turns where none was.
 *
 * A missing flag therefore reads as *wholesale*, not as selected. All four producers set it
 * explicitly (the two budget branches in `EntryRetrievalService` and `WorldStateInjector`),
 * so this only decides how a row from some later source reads — and the two errors are not
 * symmetric. "LLM Selected" asserts a call was paid for; "Included Whole" asserts only that
 * the leftover fitted the budget. An ambiguous row belongs in the weaker claim.
 */
export function splitTier3(entries: RetrievalSnapshotEntry[]): {
  selected: RetrievalSnapshotEntry[]
  wholesale: RetrievalSnapshotEntry[]
} {
  const tier3 = entries.filter((e) => e.tier === 3)
  return {
    selected: tier3.filter((e) => e.llmSelected === true),
    wholesale: tier3.filter((e) => e.llmSelected !== true),
  }
}

/**
 * Split Tier 1 into what the author pinned and what a recent turn carried over.
 *
 * They read as one list and behave nothing alike: an always-inject entry is in every prompt
 * until someone changes it, a carry-over leaves on its own within a few turns.
 */
export function splitTier1(entries: RetrievalSnapshotEntry[]): {
  always: RetrievalSnapshotEntry[]
  carried: RetrievalSnapshotEntry[]
  pinnedByState: RetrievalSnapshotEntry[]
} {
  const tier1 = entries.filter((e) => e.tier === 1)
  return {
    always: tier1.filter((e) => e.alwaysInject),
    carried: tier1.filter((e) => !e.alwaysInject && e.stickyPositionsLeft !== undefined),
    pinnedByState: tier1.filter((e) => !e.alwaysInject && e.stickyPositionsLeft === undefined),
  }
}
