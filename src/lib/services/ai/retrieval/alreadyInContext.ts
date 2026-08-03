/**
 * Already-In-Context Summary
 *
 * Renders what the narrator's prompt for this turn already contains, for the memory
 * retrieval step to read before it goes looking for anything.
 *
 * Memory retrieval runs after world state and lorebook selection, so it can be told what
 * those two already put in front of the narrator. Without that it re-derives the obvious:
 * the agent greps for a character standing in the current scene, and the static query
 * generator asks about a thread already quoted in the prompt.
 *
 * Two properties matter and neither is negotiable:
 *
 * - **It must be complete.** A partial list is worse than no list, because it is read as a
 *   statement. Naming half of what the narrator has invites work on the other half under
 *   the impression it is missing.
 * - **It must not be read as "these are the relevant entities".** It is a statement about
 *   the prompt, not a judgement about the story. Presented as relevance it anchors: an
 *   agent told what matters stops looking, and this list is capped and priority-pruned.
 *
 * Compact by construction: type and name only, comma-separated, no descriptions. The
 * agent's own prompt baseline is already the largest in the app, and this is paid on every
 * turn that runs retrieval.
 *
 * Pure and dependency-free, so the formatting is testable without an LLM.
 */

/** One entity as it appears in the summary. Both source shapes collapse to this. */
export interface ContextEntity {
  type: string
  name: string
}

/** Lowercased `type\u0000name`, so "Aria" and "aria" of the same type collapse. */
function dedupeKey(entity: ContextEntity): string {
  return `${entity.type.toLowerCase()}\u0000${entity.name.trim().toLowerCase()}`
}

function renderGroup(entities: ContextEntity[], seen: Set<string>): string | null {
  const rendered: string[] = []

  for (const entity of entities) {
    const name = entity.name?.trim()
    if (!name) continue
    const key = dedupeKey({ type: entity.type, name })
    if (seen.has(key)) continue
    seen.add(key)
    rendered.push(`[${entity.type}] ${name}`)
  }

  return rendered.length > 0 ? rendered.join(', ') : null
}

/**
 * Build the summary block. Returns `''` when there is nothing in context, so the caller
 * can leave the section out rather than print an empty heading.
 *
 * Deduping runs across both groups with world state first: an entity tracked live *and*
 * described by a lorebook entry is one thing to the narrator, and listing it twice would
 * suggest two separate pieces of context. World state wins because it is the version that
 * changes -- the live record is what the classifier rewrote last turn.
 */
export function formatAlreadyInContext(
  worldStateEntities: ContextEntity[],
  lorebookEntities: ContextEntity[],
): string {
  const seen = new Set<string>()
  const worldState = renderGroup(worldStateEntities, seen)
  const lorebook = renderGroup(lorebookEntities, seen)

  if (!worldState && !lorebook) return ''

  const lines = ["The narrator's prompt for this turn already contains:"]
  if (worldState) lines.push(`- Live world state: ${worldState}`)
  if (lorebook) lines.push(`- Lorebook entries: ${lorebook}`)
  lines.push(
    'This is what is already there, not a judgement of what matters. Do not spend steps ' +
      'rediscovering it; look for what it does not cover.',
  )

  return lines.join('\n')
}
