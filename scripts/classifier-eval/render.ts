import {
  buildClassifierWindow,
  classifierReplySchema,
  foldOwnAwareness,
  idNames,
  nameIdsInProse,
  readClassifierReply,
  substituteClassifierIds,
  type ClassifierExtraction,
} from '@/lib/classifier'
import { canonicalSeedId, remapSeedIds } from '@/lib/db/devtools/seed-ids'
import { IdBiMap } from '@/lib/ids'
import { buildClassifierContext } from '@/lib/pipeline/definitions/classifier-context'
import { renderTemplate, TEMPLATE_IDS, type RenderedPrompt } from '@/lib/prompts'

import type { EvalWindow } from './fixture'

type Read = ReturnType<typeof readClassifierReply>

function walkStrings(value: unknown, visit: (s: string) => string): unknown {
  if (typeof value === 'string') return visit(value)
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, visit))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walkStrings(v, visit)]))
  return value
}

const TURN_FIELDS = new Set(['sourceTurn', 'learnedAtTurn', 'resolvedAtTurn'])

function walkFields(value: unknown, visit: (key: string, s: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => walkFields(v, visit))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        typeof v === 'string' ? visit(k, v) : walkFields(v, visit),
      ]),
    )
  return value
}

export type RenderedWindow = {
  prompt: RenderedPrompt
  schema: ReturnType<typeof classifierReplySchema>
  /** Each fixture id the prompt shows, to the placeholder it shows it as. */
  legend: ReadonlyMap<string, string>
  /** The parsed reply read as the pass reads it, its ids back in the fixture's readable form. */
  read: (parsed: Parameters<typeof readClassifierReply>[0]) => {
    reply: ClassifierExtraction
    malformed: Read['malformed']
  }
}

// The pass's own path from rows to prompt, mentioned places off as a story's default.
export function renderWindow(w: EvalWindow, maxEntries: number): RenderedWindow {
  const readable = new Map<string, string>()
  walkStrings([w.entities, w.happenings, w.relationships, w.threads, w.entries], (s) => {
    const real = canonicalSeedId(s)
    if (real != null) readable.set(real, s)
    return s
  })
  const rows = remapSeedIds({
    entities: w.entities,
    happenings: w.happenings,
    relationships: w.relationships,
    threads: w.threads,
    entries: w.entries,
  })
  const window = buildClassifierWindow({ entries: rows.entries, processedThrough: 0, maxEntries })
  const idMap = new IdBiMap()
  const prompt = renderTemplate(
    TEMPLATE_IDS.periodicClassifier,
    buildClassifierContext({
      window,
      entities: rows.entities,
      happenings: rows.happenings,
      relationships: rows.relationships,
      threads: rows.threads,
      mentionedPlaces: false,
      leadId: w.lead == null ? null : canonicalSeedId(w.lead),
      idMap,
    }),
  )
  const handleOf = new Map(window.turns.map((t) => [t.entryId, t.handle]))
  const legend = new Map<string, string>()
  for (const [real, id] of readable) {
    const placeholder = idMap.getPlaceholderFor(real)
    if (placeholder != null) legend.set(id, placeholder)
  }
  return {
    prompt,
    schema: classifierReplySchema(false),
    legend,
    read: (parsed) => {
      const { reply: read, malformed } = readClassifierReply(parsed)
      const reply = foldOwnAwareness(nameIdsInProse(read, idNames(idMap, rows, read)))
      const substituted = substituteClassifierIds(
        reply,
        idMap,
        new Set([
          ...reply.newCharacters.map((c) => c.handle),
          ...reply.newFactions.map((f) => f.handle),
        ]),
      )
      // A turn handle as the pass resolves it, so a check reads the turn the planner anchors to.
      const turned = walkFields(substituted, (key, s) => {
        if (!TURN_FIELDS.has(key)) return s
        const { entryId, fellBack } = window.resolveHandle(s)
        return fellBack ? s : (handleOf.get(entryId) ?? s)
      })
      return {
        reply: walkStrings(turned, (s) => readable.get(s) ?? s) as ClassifierExtraction,
        malformed,
      }
    },
  }
}
