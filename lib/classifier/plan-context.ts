import type { PipelineAction } from '@/lib/actions'
import type { Entity, Happening, HappeningAwareness, Thread, VISUAL_CATEGORIES } from '@/lib/db'
import { newTerms } from '@/lib/keyword-terms'
import { boundStateText } from '@/lib/piggyback'
import type { ParentDropCause, PlacedPlacement, PlacementDrop, StoryPlace } from '@/lib/world'

import type { ReconciledKind, ReconcileDecision } from './reconcile'
import type { ClassifierReply, Membership } from './schema'
import type { ClassifierWindow } from './window'

/** A delta the phase will emit, with its own survival anchor. */
export type PlannedWrite = { action: PipelineAction; entryId: string }

/**
 * A new place left unplaced although it named a parent, or a reused unplaced place left so because
 * placing it would close a loop, hang it below a broken chain or put a disabled place around the
 * story.
 */
export type ParentDrop = {
  handle: string
  parent: string
  cause: ParentDropCause | PlacementDrop['cause']
}

/** A newPlaces entry that plans nothing: an earlier entry declared its handle, or it has no name. */
export type DroppedPlace = { handle: string; name: string; cause: 'handle-taken' | 'blank-name' }

/** A newCharacters or newFactions entry that plans nothing, for the causes a DroppedPlace has. */
export type DroppedCreate = DroppedPlace & { kind: ReconciledKind }

/** A membership naming a faction retired before the reply: a misreading of a past membership. */
export type DroppedMembership = Pick<Membership, 'character'> & {
  faction: NonNullable<Membership['faction']>
  cause: 'retired-faction'
}

/** A write naming a row its list didn't show (data-model.md → Authorship contract). */
export type UnseenRef = {
  list: 'renames' | 'placements' | 'standings' | 'threadStatuses' | 'knownAwareness'
  ref: string
}

/** A standing naming no faction, or one retired before the reply, dropped as memberships are. */
export type DroppedStanding = { faction: string; cause: 'retired-faction' | 'not-a-faction' }

/** A return from retirement naming a row that is no character: only a character returns. */
export type DroppedReturn = { ref: string; cause: 'not-a-character' }

/** A happening's or a new thread's icon the catalog lacks: written as none. */
export type UnknownIcon = { title: string; icon: string }

/**
 * A placement that plans nothing: a loop, a broken chain above its parent, a retired parent, a
 * disabled place around the story, top-level marking a placed one, a target that is no place, or a
 * parent that is no listed place (a row of another kind, or one this reply creates, whose create
 * carries its own parent).
 */
export type DroppedPlacement =
  | {
      ref: string
      cause:
        | 'cycle'
        | 'retired'
        | 'story-inside'
        | 'not-unplaced'
        | 'chain-broken'
        | 'not-a-location'
    }
  | { ref: string; parent: string; cause: 'parent-not-a-place' | 'parent-not-listed' }

/** A rename that plans nothing: its name is blank. */
export type DroppedRename = { ref: string; cause: 'blank-name' }

/** A newThreads entry that creates nothing: its title is blank. */
export type DroppedThread = { sourceTurn: string | null; cause: 'blank-title' }

/** A happenings entry that creates nothing, its rows with it: its title is blank. */
export type DroppedHappening = { sourceTurn: string | null; cause: 'blank-title' }

/** A thread these turns open and close, its closing turn before its opening: closed at the open. */
export type EarlyClose = { title: string; resolvedAtTurn: string; sourceTurn: string | null }

type CutLengths = { length: number; keptLength: number }

/** A state text cut at a clause to the 500-char bound (piggyback.md → Trailing block format). */
export type CutText = CutLengths &
  (
    | { kind: 'condition'; handle: string }
    | { kind: 'visual'; handle: string; type: (typeof VISUAL_CATEGORIES)[number] }
    | {
        kind: 'standing'
        /** A new faction's handle, or a listed faction's id. */
        ref: string
      }
  )

/** What the pass logs: the facts that planned nothing, or less than they said. */
type PlanReport = {
  unresolvedRefs: string[]
  droppedPlaces: DroppedPlace[]
  droppedCreates: DroppedCreate[]
  parentDrops: ParentDrop[]
  droppedMemberships: DroppedMembership[]
  unseenRefs: UnseenRef[]
  droppedPlacements: DroppedPlacement[]
  droppedStandings: DroppedStanding[]
  unknownIcons: UnknownIcon[]
  droppedRenames: DroppedRename[]
  droppedReturns: DroppedReturn[]
  droppedThreads: DroppedThread[]
  droppedHappenings: DroppedHappening[]
  earlyCloses: EarlyClose[]
  cutTexts: CutText[]
}

export type PlanResult = {
  planned: readonly PlannedWrite[]
  /** Temp handle -> allocated or matched entity id, for refs later in the same reply. */
  handleMap: Map<string, string>
  fellBackCount: number
} & { readonly [K in keyof PlanReport]: Readonly<PlanReport[K]> }

export type PlanDeps = {
  branchId: string
  window: ClassifierWindow
  entities: readonly Entity[]
  /**
   * Reconcile decision per handle, resolved before planning, one map per kind: one handle can
   * name a character and a faction.
   */
  decisions: Readonly<Record<ReconciledKind, ReadonlyMap<string, ReconcileDecision>>>
  now: () => number
  // 'haw' is absent on purpose: the upsertHappeningAwareness handler in
  // lib/actions/happenings/register-awareness.ts allocates the awareness id
  // itself, so the planner must not.
  newId: (kind: 'hap' | 'char' | 'fact' | 'hinv' | 'loc' | 'thr') => string
  threads: readonly Thread[]
  /** The happenings the prompt listed: the same set the phase passes to buildClassifierContext. */
  happenings: readonly Pick<Happening, 'id'>[]
  /** The branch's stored pairs; a listed happening's stored pair plans nothing. */
  awareness: readonly Pick<HappeningAwareness, 'characterId' | 'happeningId'>[]
  /** Where the story is, which a placement may not hide (data-model.md → Disabled places). */
  story: StoryPlace
}

/** A row as the reply's facts so far leave it. */
type RowView = Pick<Entity, 'kind' | 'status' | 'name' | 'createdAt'> & { keywords: string[] }

export type PlanContext = {
  extraction: ClassifierReply
  deps: PlanDeps
  planned: PlannedWrite[]
  handleMap: Map<string, string>
  /** Every handle an entry of the reply keeps, bound or not yet: the queue reorders the creates. */
  claimed: Set<string>
  report: PlanReport
  rowById: ReadonlyMap<string, Entity>
  /**
   * Mutable, not a frozen snapshot: rows this pass plans are visible to later facts in the same
   * reply, so the flip guards read post-plan status and a ref to a just-created character resolves.
   */
  index: Map<string, RowView>
  /** What this reply creates and where it puts a place, which later creates and placements walk. */
  createdPlaces: Pick<Entity, 'id' | 'kind' | 'state'>[]
  placedHere: Map<string, PlacedPlacement>
  anchor: (turn: string | undefined) => string
  /** One anchor per fact, taken only when the fact writes, so a no-op never counts as a fallback. */
  anchorOnce: (turn: string | undefined) => () => string
  /**
   * An unattributed fact's prose dates to the window's oldest turn while its survival anchor stays
   * the newest: dating the prose too late would outrank the user's edits.
   */
  proseSource: (turn: string | undefined) => string
  entryPosition: (entryId: string) => number
  turnPosition: (turn: string | undefined) => number
  /** Ascending by position, ties in the list's order. */
  byPosition: <T>(facts: readonly T[], positionOf: (fact: T) => number) => T[]
  /** Facts about one row apply in source-turn order, ties in reply order: latest prose wins. */
  inTurnOrder: <T extends { sourceTurn?: string }>(facts: readonly T[]) => T[]
  resolveRef: (ref: string, expectedKind?: Entity['kind']) => string | null
  appendTerms: (
    id: string,
    terms: readonly string[],
    proseEntryId: string,
    entryId: () => string,
  ) => void
  /** Anchored only when it writes, so a no-op never counts as a window-head fallback. */
  appendNewTerms: (id: string, terms: readonly string[], sourceTurn?: string) => void
  fellBackCount: () => number
}

export const SOURCE = 'periodic_classifier' as const

// An embedded pair composites as `${first} ${second}` and must clear the tightest catalog
// window: MiniLM-L6's 512 tokens (the mobile default), ~4 chars/token, so ~330 per pair.
export const MAX_EMBEDDED_NAME = 120
export const MAX_EMBEDDED_BODY = 1200

// Model free text can come back blank instead of omitted; a blank never reaches a row.
export function nonBlank(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

// Past the embedder's window the tail is absent from the vector while `sourceHash` still
// covers the whole string, so nothing re-embeds or reports it. Not a schema `.max()` —
// a violation is a parse failure and the retry re-reads the same prose (cf. schema.ts).
export function clampEmbedded(text: string, limit: number): string {
  if (text.length <= limit) return text
  // A lone surrogate half would be stored, hashed into sourceHash and rendered
  // as a replacement character.
  const lead = text.charCodeAt(limit - 1)
  const cut = lead >= 0xd800 && lead <= 0xdbff ? limit - 1 : limit
  return text.slice(0, cut).trimEnd()
}

// Cut and reported as the per-turn writer does (piggyback.md → Trailing block format).
export function stateText(
  text: string | undefined,
  onCut: (lengths: CutLengths) => void,
): string | undefined {
  const trimmed = nonBlank(text)
  if (trimmed === undefined) return undefined
  const bounded = boundStateText(trimmed)
  if (bounded.cut) onCut({ length: trimmed.length, keptLength: bounded.text.length })
  return bounded.text
}

export function createPlanContext(extraction: ClassifierReply, deps: PlanDeps): PlanContext {
  const { branchId, window, entities } = deps
  const planned: PlannedWrite[] = []
  const handleMap = new Map<string, string>()
  const report: PlanReport = {
    unresolvedRefs: [],
    droppedPlaces: [],
    droppedCreates: [],
    parentDrops: [],
    droppedMemberships: [],
    unseenRefs: [],
    droppedPlacements: [],
    droppedStandings: [],
    unknownIcons: [],
    droppedRenames: [],
    droppedReturns: [],
    droppedThreads: [],
    droppedHappenings: [],
    earlyCloses: [],
    cutTexts: [],
  }
  let fellBackCount = 0

  const anchor = (turn: string | undefined): string => {
    const { entryId, fellBack } = window.resolveHandle(turn)
    if (fellBack) fellBackCount++
    return entryId
  }
  const anchorOnce = (turn: string | undefined): (() => string) => {
    let entryId: string | undefined
    return () => (entryId ??= anchor(turn))
  }

  const oldestEntryId = window.turns[0]?.entryId ?? ''
  const proseSource = (turn: string | undefined): string => {
    const { entryId, fellBack } = window.resolveHandle(turn)
    return fellBack ? oldestEntryId : entryId
  }

  const rowById = new Map(entities.map((e) => [e.id, e]))
  const index = new Map<string, RowView>(
    entities.map((e) => [
      e.id,
      {
        kind: e.kind,
        status: e.status,
        name: e.name,
        createdAt: e.createdAt,
        keywords: e.keywords,
      },
    ]),
  )

  const resolveRef = (ref: string, expectedKind?: Entity['kind']): string | null => {
    const id = handleMap.get(ref) ?? (index.has(ref) ? ref : null)
    // A kind mismatch is unresolvable, not merely wrong: the awareness and
    // relationship tables are FK-less and their handlers don't re-check kind, so
    // a location landing in character_id would never be caught downstream.
    if (id == null || (expectedKind != null && index.get(id)?.kind !== expectedKind)) {
      report.unresolvedRefs.push(ref)
      return null
    }
    return id
  }

  // Only a term the stored row holds plans no write: the handler may refuse an earlier write of
  // this reply that sent one. A row this reply creates has no user edit to yield to.
  const appendTerms: PlanContext['appendTerms'] = (id, terms, proseEntryId, entryId) => {
    const row = index.get(id)
    if (row == null) return
    const added = newTerms(rowById.get(id)?.keywords ?? row.keywords, terms)
    if (added.length === 0) return
    index.set(id, { ...row, keywords: [...row.keywords, ...newTerms(row.keywords, added)] })
    planned.push({
      action: {
        kind: 'appendEntityKeywords',
        source: SOURCE,
        payload: { branchId, id, keywords: added, proseEntryId },
      },
      entryId: entryId(),
    })
  }
  const appendNewTerms: PlanContext['appendNewTerms'] = (id, terms, sourceTurn) =>
    appendTerms(id, terms, proseSource(sourceTurn), () => anchor(sourceTurn))

  const entryPosition = (entryId: string): number =>
    window.turns.findIndex((t) => t.entryId === entryId)
  const turnPosition = (turn: string | undefined): number =>
    entryPosition(window.resolveHandle(turn).entryId)
  const byPosition = <T>(facts: readonly T[], positionOf: (fact: T) => number): T[] =>
    facts
      .map((fact, order) => ({ fact, order, at: positionOf(fact) }))
      .sort((a, b) => a.at - b.at || a.order - b.order)
      .map(({ fact }) => fact)
  const inTurnOrder = <T extends { sourceTurn?: string }>(facts: readonly T[]): T[] =>
    byPosition(facts, (fact) => turnPosition(fact.sourceTurn))

  return {
    extraction,
    deps,
    planned,
    handleMap,
    claimed: new Set(),
    report,
    rowById,
    index,
    createdPlaces: [],
    placedHere: new Map(),
    anchor,
    anchorOnce,
    proseSource,
    entryPosition,
    turnPosition,
    byPosition,
    inTurnOrder,
    resolveRef,
    appendTerms,
    appendNewTerms,
    fellBackCount: () => fellBackCount,
  }
}
