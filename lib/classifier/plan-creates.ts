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
import type { ReconciledKind } from './reconcile'
import type { ClassifierExtraction, NewCharacter, NewFaction } from './schema'

/**
 * A kind's reply field and id prefix, as `PlanDeps.decisions` keys its decision map. NewCharacter
 * and NewFaction differ only in optional fields, so a hand-made pairing of them still compiles
 * swapped.
 */
export const RECONCILED_KINDS = {
  character: { reply: 'newCharacters', idPrefix: 'char' },
  faction: { reply: 'newFactions', idPrefix: 'fact' },
} as const satisfies Record<
  ReconciledKind,
  { reply: keyof ClassifierExtraction; idPrefix: Parameters<PlanDeps['newId']>[0] }
>

/**
 * A new row's embedded name and description as the row will store them, whatever its kind.
 *
 * Layer B decides against the stored row (reconcile.ts), so an unclamped candidate is
 * measured against text that will never exist: an unbounded name stops matching the row
 * it created, an unbounded description can carry a genuine match out of TAU_HIGH. Both
 * bounds live here so write path and reconcile key cannot be given one without the other.
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

// data-model.md → Soft caps + compaction discipline: the Zod degradation bounds a create's state
// must pass, else the handler refuses the row and the pass fails. The soft caps are the prompt's.
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

/** classifier.md → Disambiguation and → Factions: absorb, promote or create, by the decision. */
export function planNewEntities(ctx: PlanContext, kind: ReconciledKind): void {
  const { extraction, deps, planned, handleMap, index, report, anchorOnce, proseSource } = ctx
  const { branchId, now, newId } = deps
  const { reply, idPrefix } = RECONCILED_KINDS[kind]
  const decisionOf = deps.decisions[kind]
  for (const candidate of extraction[reply]) {
    const { handle, name } = candidate
    if (nonBlank(name) == null) {
      report.droppedCreates.push({ kind, handle, name, cause: 'blank-name' })
      continue
    }
    // A handle reused for a second row would silently rebind every earlier
    // ref to the later row. Keep the first binding and report the collision.
    if (handleMap.has(handle)) {
      report.droppedCreates.push({ kind, handle, name, cause: 'handle-taken' })
      continue
    }
    const decision = decisionOf.get(handle)
    if (!decision) {
      report.unresolvedRefs.push(handle)
      continue
    }
    // A known mention writes only its new terms, so it anchors only when one writes.
    const at = anchorOnce(candidate.sourceTurn)
    const proseEntryId = proseSource(candidate.sourceTurn)
    if (decision.kind === 'promote' || decision.kind === 'known') {
      handleMap.set(handle, decision.entityId)
      ctx.mentionTerms.push({
        id: decision.entityId,
        terms: candidate.keywords,
        sourceTurn: candidate.sourceTurn,
        proseEntryId,
        entryId: at,
      })
    }
    if (decision.kind === 'known') continue
    const entryId = at()
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
    const stored = clampEmbeddedText(candidate)
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
      entryId,
    })
  }
}
