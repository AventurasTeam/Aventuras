import type { Character } from '$lib/types'
import { branchScopeKey, type BranchScope } from '$lib/utils/branchScope'
import { normalizeImageDataUrl } from '$lib/utils/image'

/** A saved portrait, or one still generating (null when it failed). */
export type PortraitSource = string | Promise<string | null>

const MAX_REFERENCES = 3

/** The live entry for the same character, matched on canonical id so a copy-on-write swap can't miss. */
export function refreshCharacter(character: Character, live: Character[]): Character {
  const canonicalId = character.overridesId ?? character.id
  return live.find((c) => (c.overridesId ?? c.id) === canonicalId) ?? character
}

/**
 * Portraits that are generating but not yet saved. A promise is only dropped once it settles,
 * which for a portrait is after the store has been handed the result.
 */
export class PendingPortraits {
  private pending = new Map<string, Promise<string | null>>()

  private key(scope: BranchScope, character: Character): string {
    return `${branchScopeKey(scope.storyId, scope.branchId)}:${character.overridesId ?? character.id}`
  }

  track(scope: BranchScope, character: Character, portrait: Promise<string | null>): void {
    const key = this.key(scope, character)
    this.pending.set(key, portrait)
    const clear = () => {
      if (this.pending.get(key) === portrait) this.pending.delete(key)
    }
    portrait.then(clear, clear)
  }

  get(scope: BranchScope, character: Character): Promise<string | null> | undefined {
    return this.pending.get(this.key(scope, character))
  }
}

/** One source per named character that has, or is about to have, a portrait. Order is kept. */
export function referencePortraitSources(
  names: string[],
  characters: Character[],
  pendingFor: (character: Character) => Promise<string | null> | undefined,
): PortraitSource[] {
  const sources: PortraitSource[] = []
  for (const name of names.slice(0, MAX_REFERENCES)) {
    const character = characters.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (!character) continue
    const source = character.portrait || pendingFor(character)
    if (source) sources.push(source)
  }
  return sources
}

export async function resolveReferenceUrls(sources: PortraitSource[]): Promise<string[]> {
  const resolved = await Promise.all(sources)
  return resolved.map((r) => normalizeImageDataUrl(r)).filter((url): url is string => !!url)
}
