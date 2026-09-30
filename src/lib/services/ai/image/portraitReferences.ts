import type { Character } from '$lib/types'
import { branchScopeKey, type BranchScope } from '$lib/utils/branchScope'
import { normalizeImageDataUrl } from '$lib/utils/image'
import type { ImageableScene } from '../sdk/schemas/imageanalysis'

/** A saved portrait, or one still generating (null when it failed). */
export type PortraitSource = string | Promise<string | null>

const MAX_REFERENCES = 3

const canonicalId = (c: Character) => c.overridesId ?? c.id

/** The live entry for the same character, matched on canonical id so a copy-on-write swap can't miss. */
export function refreshCharacter(character: Character, live: Character[]): Character {
  const id = canonicalId(character)
  return live.find((c) => canonicalId(c) === id) ?? character
}

const normalizeName = (name: string) => name.trim().toLowerCase()

function characterNamed(name: string, characters: Character[]): Character | undefined {
  const wanted = normalizeName(name)
  return characters.find((c) => normalizeName(c.name) === wanted)
}

/** A scene whose character names are resolved against the characters present. */
export type ResolvedScene = ImageableScene & {
  /** Characters the scene depicts, in the model's order; names that match nobody are dropped. */
  depicted: Character[]
  /** Who the portrait is for; unset when the first name matches nobody. */
  portraitOf?: Character
}

/** Resolves each scene's character names once, then keeps only the first portrait per character. */
export function resolveScenes(scenes: ImageableScene[], present: Character[]): ResolvedScene[] {
  // Each portrait is its own save; two for one character race to copy it onto the branch.
  const portraitKeys = new Set<string>()
  const resolved: ResolvedScene[] = []
  for (const scene of scenes) {
    const depicted: Character[] = []
    for (const name of scene.characters) {
      const character = characterNamed(name, present)
      if (character && !depicted.some((c) => canonicalId(c) === canonicalId(character))) {
        depicted.push(character)
      }
    }

    let portraitOf: Character | undefined
    if (scene.generatePortrait && scene.characters.length > 0) {
      portraitOf = characterNamed(scene.characters[0], present)
      const key = portraitOf ? canonicalId(portraitOf) : normalizeName(scene.characters[0])
      if (portraitKeys.has(key)) continue
      portraitKeys.add(key)
    }
    resolved.push({ ...scene, depicted, portraitOf })
  }
  return resolved
}

/**
 * Portraits that are generating but not yet saved. A promise is only dropped once it settles,
 * which for a portrait is after the store has been handed the result.
 */
export class PendingPortraits {
  private pending = new Map<string, Promise<string | null>>()

  private key(scope: BranchScope, character: Character): string {
    return `${branchScopeKey(scope.storyId, scope.branchId)}:${canonicalId(character)}`
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

/** One source per depicted character that has, or is about to have, a portrait. Order is kept. */
export function referencePortraitSources(
  depicted: Character[],
  pendingFor: (character: Character) => Promise<string | null> | undefined,
): PortraitSource[] {
  const sources: PortraitSource[] = []
  for (const character of depicted.slice(0, MAX_REFERENCES)) {
    const source = character.portrait || pendingFor(character)
    if (source) sources.push(source)
  }
  return sources
}

export async function resolveReferenceUrls(sources: PortraitSource[]): Promise<string[]> {
  const resolved = await Promise.all(sources)
  return resolved.map((r) => normalizeImageDataUrl(r)).filter((url): url is string => !!url)
}
