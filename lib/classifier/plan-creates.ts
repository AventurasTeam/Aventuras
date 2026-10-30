import {
  emptyEntityState,
  VISUAL_CATEGORIES,
  type CharacterState,
  type FactionState,
} from '@/lib/db'
import { dedupeTerms } from '@/lib/keyword-terms'

import {
  clampEmbedded,
  MAX_EMBEDDED_BODY,
  MAX_EMBEDDED_NAME,
  nonBlank,
  SOURCE,
  stateText,
  type CutText,
  type PlanContext,
  type PlanDeps,
} from './plan-context'
import type { ReconciledKind, ReconcileDecision } from './reconcile'
import type { ClassifierExtraction, NewCharacter, NewFaction } from './schema'

/**
 * A kind's reply field and id prefix, keyed like `PlanDeps.decisions`. NewCharacter and NewFaction
 * differ only in optional fields, so a hand-made pairing compiles swapped.
 */
export const RECONCILED_KINDS = {
  character: { reply: 'newCharacters', idPrefix: 'char' },
  faction: { reply: 'newFactions', idPrefix: 'fact' },
} as const satisfies Record<
  ReconciledKind,
  { reply: keyof ClassifierExtraction; idPrefix: Parameters<PlanDeps['newId']>[0] }
>

/**
 * A new row's embedded name and description as stored. Layer B (reconcile.ts) matches the stored
 * row, so unclamped text mis-measures: a long name stops matching, a long description can leave
 * TAU_HIGH. Both bounds live here so write path and reconcile key can't diverge.
 */
export function clampEmbeddedText(candidate: { name: string; description: string }): {
  name: string
  description: string
} {
  return {
    name: clampEmbedded(candidate.name.trim(), MAX_EMBEDDED_NAME),
    description: clampEmbedded(candidate.description, MAX_EMBEDDED_BODY),
  }
}

// data-model.md → Soft caps + compaction discipline: Zod degradation bounds a create's state must
// pass, else the handler refuses the row and the pass fails. Soft caps are the prompt's.
const MAX_VOICE = 2000
const MAX_STATE_LIST = 50

function stateList(items: readonly string[] | undefined): string[] {
  return dedupeTerms(items ?? []).slice(0, MAX_STATE_LIST)
}

/** classifier.md → What the classifier writes → First profiles: a new character's. */
function characterProfile(candidate: NewCharacter, cutTexts: CutText[]): CharacterState {
  const visual: CharacterState['visual'] = {}
  for (const type of VISUAL_CATEGORIES) {
    const text = stateText(candidate.visual?.[type], (cut) =>
      cutTexts.push({ kind: 'visual', handle: candidate.handle, type, ...cut }),
    )
    if (text !== undefined) visual[type] = text
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
function factionProfile(candidate: NewFaction, cutTexts: CutText[]): FactionState {
  const standing = stateText(candidate.standing, (cut) =>
    cutTexts.push({ kind: 'standing', ref: candidate.handle, ...cut }),
  )
  const agenda = stateList(candidate.agenda)
  return {
    ...(standing === undefined ? {} : { standing }),
    ...(agenda.length === 0 ? {} : { agenda }),
  }
}

/** A new character or faction that kept its handle, and what reconciliation decided for it. */
export type ClaimedEntity = {
  kind: ReconciledKind
  candidate: NewCharacter | NewFaction
  decision: ReconcileDecision
}

/**
 * classifier.md → ID handling in classifier output: entries that keep their handles, in reply
 * order. The phase reconciles a handle's first declaration, so a repeat never reaches the queue.
 */
export function claimNewEntities(ctx: PlanContext, kind: ReconciledKind): ClaimedEntity[] {
  const { extraction, deps, handleMap, claimed, report } = ctx
  const decisionOf = deps.decisions[kind]
  const claims: ClaimedEntity[] = []
  for (const candidate of extraction[RECONCILED_KINDS[kind].reply]) {
    const { handle, name } = candidate
    if (nonBlank(name) == null) {
      report.droppedCreates.push({ kind, handle, name, cause: 'blank-name' })
      continue
    }
    // A reused handle would silently rebind every earlier ref to the later row: keep the first.
    if (claimed.has(handle)) {
      report.droppedCreates.push({ kind, handle, name, cause: 'handle-taken' })
      continue
    }
    const decision = decisionOf.get(handle)
    if (!decision) {
      report.unresolvedRefs.push(handle)
      continue
    }
    claimed.add(handle)
    // Names a row that exists, so it binds now: a flip of an earlier turn sees that row as it is.
    if (decision.kind !== 'create') handleMap.set(handle, decision.entityId)
    claims.push({ kind, candidate, decision })
  }
  return claims
}

/** classifier.md → Disambiguation and → Factions: absorb, promote or create, by the decision. */
export function planNewEntity(ctx: PlanContext, claim: ClaimedEntity): void {
  const { deps, planned, handleMap, index, report } = ctx
  const { kind, candidate, decision } = claim
  const { branchId, now, newId } = deps
  // A known mention writes only its new terms, so it anchors only when one writes.
  const at = ctx.anchorOnce(candidate.sourceTurn)
  const proseEntryId = ctx.proseSource(candidate.sourceTurn)
  if (decision.kind === 'promote') {
    // Sent whatever the view says, as the handler may have refused the facts that moved it.
    const promoted = index.get(decision.entityId)
    if (promoted?.status === 'staged')
      index.set(decision.entityId, { ...promoted, status: 'active' })
    planned.push({
      action: {
        kind: 'promoteStagedEntity',
        source: SOURCE,
        payload: { branchId, id: decision.entityId, proseEntryId },
      },
      entryId: at(),
    })
  }
  if (decision.kind !== 'create') {
    ctx.appendTerms(decision.entityId, candidate.keywords, proseEntryId, at)
    return
  }
  const id = newId(RECONCILED_KINDS[kind].idPrefix)
  const timestamp = now()
  const keywords = dedupeTerms(candidate.keywords)
  const stored = clampEmbeddedText(candidate)
  handleMap.set(candidate.handle, id)
  index.set(id, { kind, status: 'active', name: stored.name, createdAt: timestamp, keywords })
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
          // Classifier's one description write; never amended afterwards (authorship contract).
          description: stored.description,
          keywords,
          status: 'active',
          injectionMode: 'auto',
          // The claim's kind picks the list, so the cast can't pair the wrong profile.
          state:
            kind === 'character'
              ? characterProfile(candidate as NewCharacter, report.cutTexts)
              : factionProfile(candidate as NewFaction, report.cutTexts),
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
    entryId: at(),
  })
}
