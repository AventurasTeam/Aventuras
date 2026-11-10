import type { CloseIds } from './ids'

// A bracketed token or a bare handle: the tokens nameIdsInProse reads in prose.
const HANDLE_TOKEN = /\[([^[\]\s]+)\]|\b[a-z]{1,2}\d+\b/g
const TURN_PREFIX = 'entry_'

function handlesIn(text: string, ids: CloseIds): { handle: string; id: string }[] {
  const found: { handle: string; id: string }[] = []
  for (const match of text.matchAll(HANDLE_TOKEN)) {
    const handle = match[1] ?? match[0]
    const id = ids.idOf(handle)
    if (id !== undefined) found.push({ handle, id })
  }
  return found
}

/**
 * classifier.md → ID handling: the first handle in `text` naming one of this close's turns, bare. A
 * stored one names another turn in a later prompt, and a turn has no name to put in its place.
 */
export function turnHandleIn(text: string, ids: CloseIds): string | undefined {
  return handlesIn(text, ids).find(({ id }) => id.startsWith(TURN_PREFIX))?.handle
}

/** The first handle in a keyword term naming any row or turn this close showed, bare. */
export function handleInTerm(term: string, ids: CloseIds): string | undefined {
  return handlesIn(term, ids)[0]?.handle
}

export function turnInTextReason(handle: string): string {
  return `${handle} is a turn: cite turns in turns, never in the text`
}
