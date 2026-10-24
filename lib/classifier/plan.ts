import type { PipelineAction } from '@/lib/actions'
import {
  emptyEntityState,
  VISUAL_CATEGORIES,
  type CharacterState,
  type Entity,
  type FactionState,
  type Happening,
  type HappeningAwareness,
  type LocationState,
  type Thread,
} from '@/lib/db'
import { dedupeTerms, newTerms, normalizeTerm } from '@/lib/keyword-terms'
import { boundStateText } from '@/lib/piggyback'
import { isPlotIconKey } from '@/lib/plot'
import { oneLine } from '@/lib/text'
import {
  characterFactionId,
  checkParentChain,
  flagStillHolds,
  matchNewPlace,
  parentOfLocations,
  placeNewLocation,
  realPlacementOf,
  samePlacement,
  settlingOrder,
  stateOf,
  TOP_LEVEL,
  unhiddenLocationView,
  withPlacement,
  type ParentDropCause,
  type PlacePlacement,
  type SettledNewPlace,
} from '@/lib/world'

import type { ReconciledKind, ReconcileDecision } from './reconcile'
import {
  newPlacesOf,
  TOP_LEVEL_TOKEN,
  type ClassifierExtraction,
  type ClassifierReply,
  type Membership,
  type NewCharacter,
  type NewFaction,
  type NewPlace,
  type NewThreadReply,
  type ThreadStatusChange,
} from './schema'
import type { ClassifierWindow } from './window'

/** A delta the phase will emit, with its own survival anchor. */
export type PlannedWrite = { action: PipelineAction; entryId: string }

/**
 * A new place left unplaced although it named a parent, or a reused unplaced place left so because
 * placing it would close a loop.
 */
export type ParentDrop = { handle: string; parent: string; cause: ParentDropCause | 'cycle' }

/** A newPlaces entry that plans nothing: an earlier entry declared its handle, or it has no name. */
export type DroppedPlace = { handle: string; name: string; cause: 'handle-taken' | 'blank-name' }

/** A membership naming a faction retired before the reply: a misreading of a past membership. */
export type DroppedMembership = Pick<Membership, 'character'> & {
  faction: NonNullable<Membership['faction']>
  cause: 'retired-faction'
}

/** A rename to a name another row of the kind holds; `flagged`: this rename raised the flag. */
export type RenameClash = { ref: string; name: string; partnerId: string; flagged: boolean }

/** A write naming a row its list didn't show (data-model.md → Authorship contract). */
export type UnseenRef = {
  list: 'renames' | 'placements' | 'standings' | 'threadStatuses' | 'knownAwareness'
  ref: string
}

/** A standing naming a faction retired before the reply, dropped as memberships are. */
export type DroppedStanding = { faction: string; cause: 'retired-faction' }

/** A happening's or a new thread's icon the catalog lacks: written as none. */
export type UnknownIcon = { title: string; icon: string }

/** A placement that plans nothing: a loop, a retired parent, or top-level marking a placed one. */
export type DroppedPlacement = {
  ref: string
  cause: 'cycle' | 'retired' | 'not-unplaced' | 'chain-broken'
}

export type PlanResult = {
  planned: readonly PlannedWrite[]
  /** Temp handle -> allocated or matched entity id, for refs later in the same reply. */
  handleMap: Map<string, string>
  fellBackCount: number
  unresolvedRefs: readonly string[]
  droppedPlaces: readonly DroppedPlace[]
  parentDrops: readonly ParentDrop[]
  droppedMemberships: readonly DroppedMembership[]
  renameClashes: readonly RenameClash[]
  unseenRefs: readonly UnseenRef[]
  droppedPlacements: readonly DroppedPlacement[]
  droppedStandings: readonly DroppedStanding[]
  unknownIcons: readonly UnknownIcon[]
}

export type PlanDeps = {
  branchId: string
  window: ClassifierWindow
  entities: readonly Entity[]
  /** Reconcile decision per newCharacters handle, resolved before planning. */
  decisions: Map<string, ReconcileDecision>
  /** Per newFactions handle: kept apart, since one handle can name a character and a faction. */
  factionDecisions: ReadonlyMap<string, ReconcileDecision>
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
}

const SOURCE = 'periodic_classifier' as const

/**
 * A kind's reply field, decision map and id prefix. NewCharacter and NewFaction differ only in
 * optional fields, so a hand-made pairing of them still compiles swapped.
 */
export const RECONCILED_KINDS = {
  character: { reply: 'newCharacters', decisions: 'decisions', idPrefix: 'char' },
  faction: { reply: 'newFactions', decisions: 'factionDecisions', idPrefix: 'fact' },
} as const satisfies Record<
  ReconciledKind,
  {
    reply: keyof ClassifierExtraction
    decisions: keyof PlanDeps
    idPrefix: Parameters<PlanDeps['newId']>[0]
  }
>

// An embedded pair composites as `${first} ${second}` and must clear the tightest catalog
// window: MiniLM-L6's 512 tokens (the mobile default), ~4 chars/token, so ~330 per pair.
const MAX_EMBEDDED_NAME = 120
const MAX_EMBEDDED_BODY = 1200

// Model free text can come back blank instead of omitted; a blank never reaches a row.
function nonBlank(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

// Past the embedder's window the tail is absent from the vector while `sourceHash` still
// covers the whole string, so nothing re-embeds or reports it. Not a schema `.max()` —
// a violation is a parse failure and the retry re-reads the same prose (cf. schema.ts).
function clampEmbedded(text: string, limit: number): string {
  if (text.length <= limit) return text
  // A lone surrogate half would be stored, hashed into sourceHash and rendered
  // as a replacement character.
  const lead = text.charCodeAt(limit - 1)
  const cut = lead >= 0xd800 && lead <= 0xdbff ? limit - 1 : limit
  return text.slice(0, cut).trimEnd()
}

/**
 * A candidate character as its row will store it.
 *
 * Layer B decides against the stored row (reconcile.ts), so an unclamped candidate is
 * measured against text that will never exist: an unbounded name stops matching the row
 * it created, an unbounded description can carry a genuine match out of TAU_HIGH. Both
 * bounds live here so write path and reconcile key cannot be given one without the other.
 */
export function clampEmbeddedCharacter(candidate: { name: string; description: string }): {
  name: string
  description: string
} {
  return {
    name: clampEmbedded(candidate.name.trim(), MAX_EMBEDDED_NAME),
    description: clampEmbedded(candidate.description, MAX_EMBEDDED_BODY),
  }
}

// classifier.md → Mentioned places → Parent: a parent the planner can't use leaves it unplaced.
const UNPLACED: PlacePlacement = { kind: 'unplaced' }

const isTopLevel = (parent: string | undefined): boolean =>
  parent?.trim().toLowerCase() === TOP_LEVEL_TOKEN

// The schema's "top-level" is the shared placement helpers' TOP_LEVEL.
function declaredPlace(place: NewPlace): NewPlace {
  return isTopLevel(place.parent) ? { ...place, parent: TOP_LEVEL } : place
}

// data-model.md → LocationState shape: a machine writer walks a placement first and drops a loop.
function placementLoop(
  id: string,
  parentId: string,
  parentOf: (id: string) => string | null,
): { parent: string; cause: 'cycle' | 'chain-broken' } | null {
  const walk = checkParentChain(id, parentId, parentOf)
  if (walk === 'ok') return null
  return { parent: parentId, cause: walk === 'cycle' ? 'cycle' : 'chain-broken' }
}

// data-model.md → Soft caps + compaction discipline: the Zod degradation bounds a create's state
// must pass, else the handler refuses the row and the pass fails. The soft caps are the prompt's.
const MAX_VOICE = 2000
const MAX_STATE_LIST = 50

// A 500-character field, cut at a clause as a per-turn visual value is (piggyback.md).
function stateText(text: string | undefined): string | undefined {
  const trimmed = nonBlank(text)
  return trimmed === undefined ? undefined : boundStateText(trimmed).text
}

function stateList(items: readonly string[] | undefined): string[] {
  return dedupeTerms(items ?? []).slice(0, MAX_STATE_LIST)
}

/** classifier.md → What the classifier writes → First profiles: a new character's. */
function characterProfile(candidate: NewCharacter): CharacterState {
  const visual: CharacterState['visual'] = {}
  for (const key of VISUAL_CATEGORIES) {
    const text = stateText(candidate.visual?.[key])
    if (text !== undefined) visual[key] = text
  }
  const voiceText = nonBlank(candidate.voice)
  const voice = voiceText === undefined ? undefined : clampEmbedded(voiceText, MAX_VOICE)
  return {
    ...emptyEntityState('character'),
    visual,
    traits: stateList(candidate.traits),
    drives: stateList(candidate.drives),
    ...(voice === undefined ? {} : { voice }),
  }
}

/** A new faction's first profile; `{}`, the empty faction state, when the turns gave none. */
function factionProfile(candidate: NewFaction): FactionState {
  const standing = stateText(candidate.standing)
  const agenda = stateList(candidate.agenda)
  return {
    ...(standing === undefined ? {} : { standing }),
    ...(agenda.length === 0 ? {} : { agenda }),
  }
}

export function buildClassifierActions(extraction: ClassifierReply, deps: PlanDeps): PlanResult {
  const { branchId, window, entities, now, newId } = deps
  const planned: PlannedWrite[] = []
  const handleMap = new Map<string, string>()
  const unresolvedRefs: string[] = []
  let fellBackCount = 0

  const anchor = (turn: string | undefined): string => {
    const { entryId, fellBack } = window.resolveHandle(turn)
    if (fellBack) fellBackCount++
    return entryId
  }

  // One anchor per fact, taken only when the fact writes, so a no-op never counts as a fallback.
  const anchorOnce = (turn: string | undefined): (() => string) => {
    let entryId: string | undefined
    return () => (entryId ??= anchor(turn))
  }

  // An unattributed fact's prose dates to the window's oldest turn while its survival
  // anchor stays the newest: dating the prose too late would outrank the user's edits.
  const oldestEntryId = window.turns[0]?.entryId ?? ''
  const proseSource = (turn: string | undefined): string => {
    const { entryId, fellBack } = window.resolveHandle(turn)
    return fellBack ? oldestEntryId : entryId
  }

  const rowById = new Map(entities.map((e) => [e.id, e]))
  // What this reply creates and where it puts a place, for the placements walk after the creates.
  const createdPlaces: Pick<Entity, 'id' | 'kind' | 'state'>[] = []
  const placedParents = new Map<string, string | null>()
  // Mutable, not a frozen snapshot: rows this pass plans are visible to later
  // facts in the same reply, so the flip guards read post-plan status and a ref
  // to a just-created character resolves.
  const index = new Map<
    string,
    { kind: Entity['kind']; status: Entity['status']; keywords: string[] }
  >(entities.map((e) => [e.id, { kind: e.kind, status: e.status, keywords: e.keywords }]))

  const resolveRef = (ref: string, expectedKind?: Entity['kind']): string | null => {
    const id = handleMap.get(ref) ?? (index.has(ref) ? ref : null)
    // A kind mismatch is unresolvable, not merely wrong: the awareness and
    // relationship tables are FK-less and their handlers don't re-check kind, so
    // a location landing in character_id would never be caught downstream.
    if (id == null || (expectedKind != null && index.get(id)?.kind !== expectedKind)) {
      unresolvedRefs.push(ref)
      return null
    }
    return id
  }

  // New terms only, so a term the row already holds plans no write.
  const appendTerms = (
    id: string,
    terms: readonly string[],
    proseEntryId: string,
    entryId: () => string,
  ): void => {
    const row = index.get(id)
    if (row == null) return
    const added = newTerms(row.keywords, terms)
    if (added.length === 0) return
    index.set(id, { ...row, keywords: [...row.keywords, ...added] })
    planned.push({
      action: {
        kind: 'appendEntityKeywords',
        source: SOURCE,
        payload: { branchId, id, keywords: added, proseEntryId },
      },
      entryId: entryId(),
    })
  }
  // Anchored only when it writes, so a no-op never counts as a window-head fallback.
  const appendNewTerms = (id: string, terms: readonly string[], sourceTurn?: string): void =>
    appendTerms(id, terms, proseSource(sourceTurn), () => anchor(sourceTurn))

  // A known or promoted mention's new keywords, written in turn order with the row's other
  // keyword writes (planKeywordWrites).
  const mentionTerms: {
    id: string
    terms: readonly string[]
    sourceTurn?: string
    proseEntryId: string
    entryId: string
  }[] = []

  // classifier.md → Mentioned places. After characters and factions, so the handle namespace
  // they share keeps their bindings; before anything that names a place by its handle.
  const planNewPlaces = (): { droppedPlaces: DroppedPlace[]; parentDrops: ParentDrop[] } => {
    const droppedPlaces: DroppedPlace[] = []
    const parentDrops: ParentDrop[] = []
    // The pass saw every place, so matching is over real children: nothing is hidden.
    const view = unhiddenLocationView(entities)
    const placed: SettledNewPlace[] = []
    // The rows this reply placed, as matching must see them: no longer unplaced.
    const placedRows = new Map<string, Entity>()

    const declared: NewPlace[] = []
    for (const place of newPlacesOf(extraction)) {
      const { handle, name } = place
      if (nonBlank(name) == null) droppedPlaces.push({ handle, name, cause: 'blank-name' })
      else if (handleMap.has(handle)) droppedPlaces.push({ handle, name, cause: 'handle-taken' })
      else declared.push(declaredPlace(place))
    }

    const { order, duplicates } = settlingOrder(
      declared,
      (id) => rowById.get(id)?.kind === 'location',
    )
    for (const { handle, name } of duplicates)
      droppedPlaces.push({ handle, name, cause: 'handle-taken' })
    for (const settling of order) {
      const place = settling.emission
      const storedParentOf = parentOfLocations([...entities, ...createdPlaces])
      const parentOf = (id: string): string | null =>
        placedParents.has(id) ? (placedParents.get(id) ?? null) : storedParentOf(id)
      const placement = placeNewLocation({
        place: settling,
        resolve: (parent) => handleMap.get(parent) ?? parent,
        statusOf: (id) => index.get(id)?.status,
        parentOf,
      })
      if (placement.kind === 'dropped')
        parentDrops.push({ handle: place.handle, parent: placement.parent, cause: placement.cause })
      const candidate = placement.kind === 'kept' ? placement.placement : UNPLACED

      const stored = clampEmbeddedCharacter({
        name: place.name,
        description: place.description.trim(),
      })
      // Stale hiddenBetween for a row placed here is harmless: a twin match reaches it first.
      const match = matchNewPlace(
        { name: stored.name, placement: candidate, keywords: place.keywords },
        placed,
        placedRows.size === 0
          ? view
          : { ...view, locations: view.locations.map((e) => placedRows.get(e.id) ?? e) },
        placedParents,
      )

      let id: string
      if (match.kind !== 'create') {
        // A reused place keeps its description and its status: a mention doesn't enter it.
        id = match.id
        appendNewTerms(id, place.keywords, place.sourceTurn)
        // `match.place`: an unplaced reused row, or this reply's own create taken over.
        if (match.place && candidate.kind !== 'unplaced') {
          const loop =
            candidate.kind === 'under' ? placementLoop(id, candidate.parentId, parentOf) : null
          if (loop === null) {
            placedParents.set(id, candidate.kind === 'under' ? candidate.parentId : null)
            const row = rowById.get(id)
            if (row !== undefined)
              placedRows.set(id, {
                ...row,
                state: withPlacement(row.state as LocationState, candidate),
              })
            planned.push({
              action: {
                kind: 'placeLocation',
                source: SOURCE,
                payload: {
                  branchId,
                  id,
                  placement: candidate,
                  proseEntryId: proseSource(place.sourceTurn),
                },
              },
              entryId: anchor(place.sourceTurn),
            })
          } else parentDrops.push({ handle: place.handle, ...loop })
        }
      } else {
        id = newId('loc')
        const { flag } = match
        const keywords = dedupeTerms(place.keywords)
        const timestamp = now()
        // classifier.md → What the classifier writes → First profiles: a place's condition.
        const condition = stateText(place.condition)
        const state = withPlacement(
          condition === undefined
            ? { parent_location_id: null }
            : { parent_location_id: null, condition },
          candidate,
        )
        index.set(id, { kind: 'location', status: 'active', keywords })
        createdPlaces.push({ id, kind: 'location', state })
        planned.push({
          action: {
            kind: 'createEntity',
            source: SOURCE,
            payload: {
              entry: {
                id,
                branchId,
                kind: 'location',
                name: stored.name,
                description: stored.description === '' ? null : stored.description,
                keywords,
                status: 'active',
                injectionMode: 'auto',
                state,
                nameCollisionFlag: flag === null ? 0 : 1,
                nameCollisionPartnerId: flag?.partnerId ?? null,
                nameCollisionReason: flag?.reason ?? null,
                embeddingStale: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            },
          },
          entryId: anchor(place.sourceTurn),
        })
      }
      handleMap.set(place.handle, id)
      placed.push({ name: stored.name, placement: candidate, id })
    }
    return { droppedPlaces, parentDrops }
  }

  // classifier.md → Disambiguation and → Factions: absorb, promote or create, by the decision.
  const planNewEntities = (kind: ReconciledKind): void => {
    const { reply, decisions, idPrefix } = RECONCILED_KINDS[kind]
    const decisionOf = deps[decisions]
    for (const candidate of extraction[reply]) {
      if (nonBlank(candidate.name) == null) {
        unresolvedRefs.push(candidate.handle)
        continue
      }
      const decision = decisionOf.get(candidate.handle)
      if (!decision) {
        unresolvedRefs.push(candidate.handle)
        continue
      }
      // A handle reused for a second row would silently rebind every earlier
      // ref to the later row. Keep the first binding and report the collision.
      if (handleMap.has(candidate.handle)) {
        unresolvedRefs.push(candidate.handle)
        continue
      }
      const entryId = anchor(candidate.sourceTurn)
      const proseEntryId = proseSource(candidate.sourceTurn)
      // New terms only, so a term the row already holds plans no write.
      if (decision.kind === 'promote' || decision.kind === 'known') {
        handleMap.set(candidate.handle, decision.entityId)
        mentionTerms.push({
          id: decision.entityId,
          terms: candidate.keywords,
          sourceTurn: candidate.sourceTurn,
          proseEntryId,
          entryId,
        })
      }
      if (decision.kind === 'known') continue
      if (decision.kind === 'promote') {
        const promoted = index.get(decision.entityId)
        if (promoted != null) index.set(decision.entityId, { ...promoted, status: 'active' })
        planned.push({
          action: {
            kind: 'promoteStagedEntity',
            source: SOURCE,
            payload: { branchId, id: decision.entityId, proseEntryId },
          },
          entryId,
        })
        continue
      }
      const id = newId(idPrefix)
      const timestamp = now()
      const keywords = dedupeTerms(candidate.keywords)
      const stored = clampEmbeddedCharacter(candidate)
      handleMap.set(candidate.handle, id)
      index.set(id, { kind, status: 'active', keywords })
      planned.push({
        action: {
          kind: 'createEntity',
          source: SOURCE,
          payload: {
            entry: {
              id,
              branchId,
              kind,
              name: stored.name,
              // First introduction is the classifier's one description write; it
              // never amends a description afterwards (authorship contract).
              description: stored.description,
              keywords,
              status: 'active',
              injectionMode: 'auto',
              // The loop's kind picks the list, so the cast can't pair the wrong profile.
              state:
                kind === 'character'
                  ? characterProfile(candidate as NewCharacter)
                  : factionProfile(candidate as NewFaction),
              nameCollisionFlag: decision.flag == null ? 0 : 1,
              nameCollisionPartnerId: decision.flag?.partnerId ?? null,
              nameCollisionReason: decision.flag?.reason ?? null,
              // Nothing embeds on the write path: the sync stage owns the vector.
              embeddingStale: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
        },
        entryId,
      })
    }
  }

  // New characters first: later refs in the same reply resolve through handleMap,
  // and involvements/awareness rows must not precede the row they point at. Factions next,
  // so a handle a character claimed stays the character's.
  planNewEntities('character')
  planNewEntities('faction')

  const { droppedPlaces, parentDrops } = planNewPlaces()

  // Facts about one row apply in source-turn order, ties in reply order, so the latest prose wins.
  const entryPosition = (entryId: string): number =>
    window.turns.findIndex((t) => t.entryId === entryId)
  const turnPosition = (turn: string | undefined): number =>
    entryPosition(window.resolveHandle(turn).entryId)
  const inTurnOrder = <T extends { sourceTurn?: string }>(facts: readonly T[]): T[] =>
    facts
      .map((fact, order) => ({ fact, order, at: turnPosition(fact.sourceTurn) }))
      .sort((a, b) => a.at - b.at || a.order - b.order)
      .map(({ fact }) => fact)

  // data-model.md → Authorship contract → Seen before written.
  const unseenRefs: UnseenRef[] = []

  // classifier.md → What the classifier writes → Names. A name is taken when a row of the kind
  // holds it, one this reply creates or renames included. A keyword write's undo is the whole
  // prior list, so a row's renames, aliases and mention terms plan in turn order: reversing a turn
  // then never writes an earlier turn's terms away (classifier.md → Provenance attribution).
  const planKeywordWrites = (): RenameClash[] => {
    const nameRows = new Map(
      entities.map((e) => [e.id, { kind: e.kind, name: e.name, createdAt: e.createdAt }]),
    )
    for (const { action } of planned)
      if (action.kind === 'createEntity') {
        const { entry } = action.payload
        nameRows.set(entry.id, { kind: entry.kind, name: entry.name, createdAt: entry.createdAt })
      }
    // piggyback.md → Matching before creating: a place is compared with its real siblings, the top
    // level counting as one parent, and with every place when either is unplaced.
    const storedPlacement = realPlacementOf([
      ...entities.filter((e) => e.kind === 'location'),
      ...createdPlaces,
    ])
    const placementAt = (id: string): PlacePlacement => {
      if (!placedParents.has(id)) return storedPlacement(id)
      const parentId = placedParents.get(id) ?? null
      return parentId === null ? { kind: 'top' } : { kind: 'under', parentId }
    }
    const placesCompared = (a: string, b: string): boolean => {
      const [first, second] = [placementAt(a), placementAt(b)]
      return first.kind === 'unplaced' || second.kind === 'unplaced' || samePlacement(first, second)
    }
    // A listed row as this reply's planned writes leave it, for World's pairing rule.
    const asPlanned = (id: string): Entity | undefined => {
      const stored = rowById.get(id)
      if (stored === undefined) return undefined
      const placed = stored.kind === 'location' && placedParents.has(id)
      return {
        ...stored,
        name: nameRows.get(id)?.name ?? stored.name,
        keywords: index.get(id)?.keywords ?? stored.keywords,
        state: placed
          ? withPlacement(stored.state as LocationState, placementAt(id))
          : stored.state,
      }
    }
    const renameClashes: RenameClash[] = []
    const raisedFlags = new Set<string>()
    const planRename = (rename: ClassifierExtraction['renames'][number]): void => {
      const row = rowById.get(rename.ref)
      if (row === undefined) {
        unseenRefs.push({ list: 'renames', ref: rename.ref })
        return
      }
      // Both hold every listed row; the check narrows their lookups.
      const current = nameRows.get(row.id)
      const known = index.get(row.id)
      if (current === undefined || known === undefined) return
      const name = clampEmbedded(rename.name.trim(), MAX_EMBEDDED_NAME)
      const key = normalizeTerm(name)
      // A case-only change is no reveal, as renameEntity judges it.
      if (key === '' || key === normalizeTerm(current.name)) return
      const holders = [...nameRows]
        .filter(
          ([id, r]) =>
            id !== row.id &&
            r.kind === row.kind &&
            normalizeTerm(r.name) === key &&
            (row.kind !== 'location' || placesCompared(row.id, id)),
        )
        .sort(([idA, a], [idB, b]) => a.createdAt - b.createdAt || (idA < idB ? -1 : 1))
      const at = anchorOnce(rename.sourceTurn)
      const proseEntryId = proseSource(rename.sourceTurn)
      const holder = holders[0]
      if (holder === undefined) {
        nameRows.set(row.id, { ...current, name })
        // renameEntity keeps the old name as a keyword, so a later alias of it plans nothing.
        index.set(row.id, {
          ...known,
          keywords: [...known.keywords, ...newTerms(known.keywords, [current.name])],
        })
        planned.push({
          action: {
            kind: 'renameEntity',
            source: SOURCE,
            payload: { branchId, id: row.id, name, proseEntryId },
          },
          entryId: at(),
        })
        return
      }
      const [partnerId] = holder
      // The revealed name is one the prose used for it, so the pair stays namesakes (world.md →
      // Surfacing) and the user merges them.
      const added = newTerms(known.keywords, [name])
      if (added.length > 0) {
        index.set(row.id, { ...known, keywords: [...known.keywords, ...added] })
        planned.push({
          action: {
            kind: 'appendEntityKeywords',
            source: SOURCE,
            payload: { branchId, id: row.id, keywords: added, proseEntryId },
          },
          entryId: at(),
        })
      }
      // One partner per row: a flag that still holds, its keyword landed, keeps its partner; a
      // dormant one counts as none (classifier.md → Names), as raiseCollisionFlag judges it.
      const landed = asPlanned(row.id)
      const partnerOf = row.nameCollisionPartnerId
      const holds =
        landed !== undefined &&
        flagStillHolds(landed, partnerOf === null ? undefined : asPlanned(partnerOf))
      const flagged = !holds && !raisedFlags.has(row.id)
      if (flagged) {
        raisedFlags.add(row.id)
        planned.push({
          action: {
            kind: 'raiseCollisionFlag',
            source: SOURCE,
            payload: { branchId, id: row.id, partnerId, reason: 'name-taken', proseEntryId },
          },
          entryId: at(),
        })
      }
      renameClashes.push({ ref: rename.ref, name, partnerId, flagged })
    }
    // Index is keyed by row id, so a handle this reply declares misses: its row already carries
    // its keywords. newTerms drops a term the snapshot or an earlier write in this reply holds.
    const planAlias = (alias: ClassifierExtraction['aliases'][number]): void => {
      if (!index.has(alias.ref)) unresolvedRefs.push(alias.ref)
      else appendNewTerms(alias.ref, alias.terms, alias.sourceTurn)
    }
    // Ties keep this order: a mention's terms, then a rename, then an alias.
    const facts = [
      ...mentionTerms.map((mention) => ({ sourceTurn: mention.sourceTurn, mention })),
      ...extraction.renames.map((rename) => ({ sourceTurn: rename.sourceTurn, rename })),
      ...extraction.aliases.map((alias) => ({ sourceTurn: alias.sourceTurn, alias })),
    ]
    for (const fact of inTurnOrder(facts)) {
      if ('mention' in fact) {
        const { id, terms, proseEntryId, entryId } = fact.mention
        appendTerms(id, terms, proseEntryId, () => entryId)
      } else if ('rename' in fact) planRename(fact.rename)
      else planAlias(fact.alias)
    }
    return renameClashes
  }

  // classifier.md → What the classifier writes → Where a place sits. Planned against this reply's
  // own creates and placements; a loop or a retired parent is dropped before the handler sees it.
  const planPlacements = (): DroppedPlacement[] => {
    const droppedPlacements: DroppedPlacement[] = []
    const parentOfRows = parentOfLocations([...entities, ...createdPlaces])
    const placeParentOf = (id: string): string | null =>
      placedParents.has(id) ? (placedParents.get(id) ?? null) : parentOfRows(id)
    const realPlacement = realPlacementOf(entities.filter((e) => e.kind === 'location'))
    for (const fact of inTurnOrder(extraction.placements)) {
      const row = rowById.get(fact.ref)
      if (row === undefined) {
        unseenRefs.push({ list: 'placements', ref: fact.ref })
        continue
      }
      if (row.kind !== 'location') {
        unresolvedRefs.push(fact.ref)
        continue
      }
      const { id } = row
      let placement: { kind: 'under'; parentId: string } | { kind: 'top' }
      if (isTopLevel(fact.parent)) {
        // Only an unplaced place is marked top-level (data-model.md → Authorship contract).
        if (placedParents.has(id) || realPlacement(id).kind !== 'unplaced') {
          droppedPlacements.push({ ref: fact.ref, cause: 'not-unplaced' })
          continue
        }
        placement = { kind: 'top' }
      } else {
        // An ID from Places: a new place's handle names none, its create carrying its own parent.
        const parentId = fact.parent
        const parent = rowById.get(parentId)
        if (parent?.kind !== 'location') {
          unresolvedRefs.push(fact.parent)
          continue
        }
        if (placeParentOf(id) === parentId) continue
        if (parent.status === 'retired') {
          droppedPlacements.push({ ref: fact.ref, cause: 'retired' })
          continue
        }
        const loop = placementLoop(id, parentId, placeParentOf)
        if (loop !== null) {
          droppedPlacements.push({ ref: fact.ref, cause: loop.cause })
          continue
        }
        placement = { kind: 'under', parentId }
      }
      placedParents.set(id, placement.kind === 'under' ? placement.parentId : null)
      planned.push({
        action: {
          kind: 'placeLocation',
          source: SOURCE,
          payload: { branchId, id, placement, proseEntryId: proseSource(fact.sourceTurn) },
        },
        entryId: anchor(fact.sourceTurn),
      })
    }
    return droppedPlacements
  }

  // classifier.md → Factions: a listed faction's standing, on a change. Bounded as the handler
  // bounds it, so a restatement compares what it would store, on one line as the prompt shows it.
  const planStandings = (): DroppedStanding[] => {
    const droppedStandings: DroppedStanding[] = []
    const standingOf = new Map<string, string | undefined>()
    for (const fact of inTurnOrder(extraction.standings)) {
      const row = rowById.get(fact.ref)
      if (row === undefined) {
        unseenRefs.push({ list: 'standings', ref: fact.ref })
        continue
      }
      if (row.kind !== 'faction') {
        unresolvedRefs.push(fact.ref)
        continue
      }
      // The pre-reply row, so a faction this reply retires keeps the standings from its turns.
      if (row.status === 'retired') {
        droppedStandings.push({ faction: fact.ref, cause: 'retired-faction' })
        continue
      }
      const standing = stateText(fact.standing)
      const current = standingOf.has(row.id)
        ? standingOf.get(row.id)
        : stateOf(row, 'faction').standing
      if (
        standing === undefined ||
        (current !== undefined && oneLine(standing) === oneLine(current))
      )
        continue
      standingOf.set(row.id, standing)
      planned.push({
        action: {
          kind: 'setFactionStanding',
          source: SOURCE,
          payload: { branchId, id: row.id, standing, proseEntryId: proseSource(fact.sourceTurn) },
        },
        entryId: anchor(fact.sourceTurn),
      })
    }
    return droppedStandings
  }

  // Placements first, so a place's rename clash is judged where this reply leaves it; they read
  // no names or keywords, and `name-taken` ignores parents downstream.
  const droppedPlacements = planPlacements()
  const renameClashes = planKeywordWrites()
  const droppedStandings = planStandings()

  // classifier.md → What the classifier writes → Happenings: an icon from the catalog, or none.
  const unknownIcons: UnknownIcon[] = []
  const iconOf = (icon: string | undefined, title: string): string | null => {
    const key = nonBlank(icon)?.toLowerCase()
    if (key === undefined) return null
    if (isPlotIconKey(key)) return key
    unknownIcons.push({ title, icon: key })
    return null
  }

  for (const happening of extraction.happenings) {
    // Its involvements and awareness nest under it, so dropping it strands nothing.
    const title = nonBlank(happening.title)
    if (title == null) continue
    const parentAnchor = anchor(happening.sourceTurn)
    const happeningId = newId('hap')
    const timestamp = now()
    // Deliberately not through anchor(): occurred_at_entry_id is a story-time
    // claim retrieval and the Plot screen read as fact, not a survival anchor, so
    // a head-fallback would assert the happening occurred at the newest window
    // turn. A bogus handle degrades to the temporal string instead.
    let occurredAtEntryId: string | null = null
    if (happening.occurredAtTurn != null) {
      const resolved = window.resolveHandle(happening.occurredAtTurn)
      if (resolved.fellBack) unresolvedRefs.push(happening.occurredAtTurn)
      else occurredAtEntryId = resolved.entryId
    }
    const description = nonBlank(happening.description)
    planned.push({
      action: {
        kind: 'createHappening',
        source: SOURCE,
        payload: {
          entry: {
            id: happeningId,
            branchId,
            title: clampEmbedded(title, MAX_EMBEDDED_NAME),
            description: description == null ? null : clampEmbedded(description, MAX_EMBEDDED_BODY),
            category: nonBlank(happening.category) ?? null,
            icon: iconOf(happening.icon, title),
            // Mutually exclusive per the table CHECK: an entry ref wins.
            temporal: occurredAtEntryId == null ? (nonBlank(happening.temporal) ?? null) : null,
            occurredAtEntryId,
            embeddingStale: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
      entryId: parentAnchor,
    })

    for (const involvement of happening.involvements) {
      // Unrestricted by kind: happening_involvements is polymorphic — a location,
      // item or faction is valid subject matter.
      const entityId = resolveRef(involvement.ref)
      if (entityId == null) continue
      planned.push({
        action: {
          kind: 'createHappeningInvolvement',
          source: SOURCE,
          payload: {
            entry: {
              id: newId('hinv'),
              branchId,
              happeningId,
              entityId,
              role: nonBlank(involvement.role) ?? null,
            },
          },
        },
        // Sub-rows inherit the parent's anchor unless independently sourced.
        entryId: parentAnchor,
      })
    }

    for (const row of happening.awareness) {
      const characterId = resolveRef(row.ref, 'character')
      if (characterId == null) continue
      // A character learning of an OLD happening anchors to the turn that
      // narrated the learning, not the happening's.
      const learnedEntryId = row.learnedAtTurn != null ? anchor(row.learnedAtTurn) : parentAnchor
      planned.push({
        action: {
          kind: 'upsertHappeningAwareness',
          source: SOURCE,
          payload: {
            branchId,
            characterId,
            happeningId,
            learnedAtEntryId: learnedEntryId,
            // Clamped here, not in the schema: the wire contract must stay
            // JSON-Schema-representable, so it carries the raw number.
            decayResistance: Math.min(1, Math.max(0, row.severity)),
            // Undefined, not null: a blank re-emit must leave an existing source alone.
            source: nonBlank(row.source),
            proseEntryId: proseSource(happening.sourceTurn),
          },
        },
        entryId: learnedEntryId,
      })
    }
  }

  // classifier.md → What the classifier writes → Happenings. Create-only: the upsert would merge a
  // stored pair's source and decay resistance, which chapter close tunes.
  const listedHappenings = new Set(deps.happenings.map((h) => h.id))
  const pairKey = (characterId: string, happeningId: string): string =>
    `${characterId} ${happeningId}`
  const storedPairs = new Set(deps.awareness.map((a) => pairKey(a.characterId, a.happeningId)))
  for (const known of extraction.knownAwareness) {
    // An unknown placeholder passes substituteClassifierIds untouched, so only this check sees it.
    if (!listedHappenings.has(known.happening)) {
      unseenRefs.push({ list: 'knownAwareness', ref: known.happening })
      continue
    }
    const characterId = resolveRef(known.ref, 'character')
    if (characterId == null) continue
    const pair = pairKey(characterId, known.happening)
    if (storedPairs.has(pair)) continue
    storedPairs.add(pair)
    const learnedEntryId = anchor(known.learnedAtTurn)
    planned.push({
      action: {
        kind: 'upsertHappeningAwareness',
        source: SOURCE,
        payload: {
          branchId,
          characterId,
          happeningId: known.happening,
          learnedAtEntryId: learnedEntryId,
          decayResistance: Math.min(1, Math.max(0, known.severity)),
          source: nonBlank(known.source),
          proseEntryId: proseSource(known.learnedAtTurn),
        },
      },
      entryId: learnedEntryId,
    })
  }

  for (const relationship of extraction.relationships) {
    const subjectId = resolveRef(relationship.subject, 'character')
    const objectId = resolveRef(relationship.object, 'character')
    if (subjectId == null || objectId == null || subjectId === objectId) continue
    // A blank kind would be rejected or stored as whitespace, and a null view could make a later
    // CTRL-Z refuse (generation-pipeline.md → Reverse-replay): drop the fact instead of failing.
    const kind = nonBlank(relationship.kind)
    if (kind == null) continue
    planned.push({
      action: {
        kind: 'upsertCharacterRelationship',
        source: SOURCE,
        // Canonical a_id < b_id ordering and the POV merge live in the action
        // (lib/actions/relationships/register.ts) — emit the raw perspective.
        payload: {
          branchId,
          subjectId,
          objectId,
          kind,
          proseEntryId: proseSource(relationship.sourceTurn),
        },
      },
      entryId: anchor(relationship.sourceTurn),
    })
  }

  // classifier.md → Factions → Memberships. Retired per the pre-reply `rowById`, not `index`, so
  // the reply's own flips never count. Anchor-ordered: a head-turn reversal undoes only the latest.
  const droppedMemberships: DroppedMembership[] = []
  // Only the stored faction rules a fact out: the handler may refuse an earlier planned one.
  const sentFor = new Set<string>()
  const storedFaction = (id: string): string | null => {
    const row = rowById.get(id)
    return row == null ? null : characterFactionId(row)
  }
  for (const fact of inTurnOrder(extraction.memberships)) {
    const characterId = resolveRef(fact.character, 'character')
    if (characterId == null) continue
    let factionId: string | null = null
    if (fact.faction !== null) {
      factionId = resolveRef(fact.faction, 'faction')
      if (factionId == null) continue
      if (rowById.get(factionId)?.status === 'retired') {
        droppedMemberships.push({
          character: fact.character,
          faction: fact.faction,
          cause: 'retired-faction',
        })
        continue
      }
    }
    if (!sentFor.has(characterId) && storedFaction(characterId) === factionId) continue
    sentFor.add(characterId)
    planned.push({
      action: {
        kind: 'setCharacterFaction',
        source: SOURCE,
        payload: {
          branchId,
          id: characterId,
          factionId,
          proseEntryId: proseSource(fact.sourceTurn),
        },
      },
      entryId: anchor(fact.sourceTurn),
    })
  }

  for (const flip of inTurnOrder(extraction.statusFlips)) {
    const id = resolveRef(flip.ref)
    if (id == null) continue
    const current = index.get(id)
    if (current == null) continue
    // classifier.md → What the classifier writes → Status transitions: only a character returns.
    const returning = flip.to === 'active' && current.status === 'retired'
    if (returning && current.kind !== 'character') {
      unresolvedRefs.push(flip.ref)
      continue
    }
    // Monotonic staged->active (the other writer may have landed it already), a return, and
    // hard-finality retirement only.
    if (flip.to === 'active' && current.status !== 'staged' && !returning) continue
    if (flip.to === 'retired' && current.status !== 'active') continue
    // A destroyed place stays active, its destruction a condition: only the user retires one.
    if (flip.to === 'retired' && current.kind === 'location') continue
    index.set(id, { ...current, status: flip.to })
    const proseEntryId = proseSource(flip.sourceTurn)
    planned.push({
      action:
        flip.to === 'retired'
          ? {
              kind: 'retireEntity',
              source: SOURCE,
              payload: {
                branchId,
                id,
                retiredReason: nonBlank(flip.reason) ?? null,
                proseEntryId,
              },
            }
          : returning
            ? {
                kind: 'returnFromRetirement',
                source: SOURCE,
                payload: { branchId, id, proseEntryId },
              }
            : {
                kind: 'promoteStagedEntity',
                source: SOURCE,
                payload: { branchId, id, proseEntryId },
              },
      entryId: anchor(flip.sourceTurn),
    })
  }

  // classifier.md → Threads.
  const threadStatusWrite = (
    id: string,
    status: ThreadStatusChange['status'],
    entryId: string,
    proseEntryId: string,
  ): PlannedWrite => ({
    action: {
      kind: 'setThreadStatus',
      source: SOURCE,
      payload: {
        branchId,
        id,
        status,
        resolvedAtEntryId: status === 'active' ? null : entryId,
        proseEntryId,
      },
    },
    entryId,
  })
  // A status change can't precede its thread, so a closing turn before the open closes it there.
  const closingTurnOf = (
    thread: NewThreadReply,
    openedAt: string,
  ): { entryId: string; proseEntryId: string } => {
    if (thread.resolvedAtTurn !== undefined) {
      const closed = window.resolveHandle(thread.resolvedAtTurn)
      if (closed.fellBack) unresolvedRefs.push(thread.resolvedAtTurn)
      else if (entryPosition(closed.entryId) >= entryPosition(openedAt))
        return { entryId: closed.entryId, proseEntryId: closed.entryId }
    }
    return { entryId: openedAt, proseEntryId: proseSource(thread.sourceTurn) }
  }
  for (const thread of extraction.newThreads) {
    const title = nonBlank(thread.title)
    if (title == null) continue
    const entryId = anchor(thread.sourceTurn)
    // Opened and closed here: the create and the close are two writes, each kept by its own turn,
    // so reversing the closing turn alone reopens the thread.
    const closedAs =
      thread.status === 'resolved' || thread.status === 'failed' ? thread.status : null
    const id = newId('thr')
    const description = nonBlank(thread.description)
    const timestamp = now()
    planned.push({
      action: {
        kind: 'createThread',
        source: SOURCE,
        payload: {
          entry: {
            id,
            branchId,
            title: clampEmbedded(title, MAX_EMBEDDED_NAME),
            description: description == null ? null : clampEmbedded(description, MAX_EMBEDDED_BODY),
            category: nonBlank(thread.category) ?? null,
            icon: iconOf(thread.icon, title),
            status: closedAs === null ? thread.status : 'active',
            injectionMode: 'auto',
            // Non-null on every thread a pass creates: setThreadStatus resolves only those.
            triggeredAtEntryId: entryId,
            resolvedAtEntryId: null,
            embeddingStale: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
      entryId,
    })
    if (closedAs !== null) {
      const closing = closingTurnOf(thread, entryId)
      planned.push(threadStatusWrite(id, closedAs, closing.entryId, closing.proseEntryId))
    }
  }
  const threadStatusOf = new Map<string, Thread['status']>(
    deps.threads.map((t) => [t.id, t.status]),
  )
  for (const change of inTurnOrder(extraction.threadStatuses)) {
    const current = threadStatusOf.get(change.thread)
    if (current === undefined) {
      unseenRefs.push({ list: 'threadStatuses', ref: change.thread })
      continue
    }
    if (current === change.status) continue
    threadStatusOf.set(change.thread, change.status)
    planned.push(
      threadStatusWrite(
        change.thread,
        change.status,
        anchor(change.sourceTurn),
        proseSource(change.sourceTurn),
      ),
    )
  }

  return {
    planned,
    handleMap,
    fellBackCount,
    unresolvedRefs,
    droppedPlaces,
    parentDrops,
    droppedMemberships,
    renameClashes,
    unseenRefs,
    droppedPlacements,
    droppedStandings,
    unknownIcons,
  }
}
