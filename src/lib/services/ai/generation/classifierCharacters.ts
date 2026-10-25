/**
 * The classifier's view of existing characters: what it is shown of each one, and which of
 * its rewrites are therefore accepted.
 *
 * Description, traits and appearance are whole-value replacements, so a rewrite is only taken
 * for a field the model was shown. The list and the apply step read the same rule.
 */

import type { Character, VisualDescriptors } from '#lib/types/index.ts'
import type { CharacterUpdate, ShownCharacter } from '../sdk/schemas/classifier'
import { sameEntityName, termKey, uniqueTerms } from '#lib/utils/text.ts'
import {
  DESCRIPTOR_CATEGORIES,
  descriptorsToString,
  hasDescriptors,
} from '#lib/utils/visualDescriptors.ts'

export type ClassifierCharacterView = Omit<ShownCharacter, 'name'>

/**
 * Characters in the scene are shown in full. The protagonist's description and traits are
 * left out: they are usually the reader's own setup, and the protagonist is in every scene.
 */
export function classifierCharacterView(c: Character): ClassifierCharacterView {
  const active = (c.status ?? 'active') === 'active'
  return { appearance: active, profile: active && c.relationship !== 'self' }
}

export function shownCharacters(characters: readonly Character[]): ShownCharacter[] {
  return characters.map((c) => ({ name: c.name, ...classifierCharacterView(c) }))
}

/**
 * `shownCharacters`, if the rendered prompt carries the formatted list. A custom template may
 * leave `existingCharacters` out, and then nothing of the cast was shown.
 */
export function shownInPrompt(
  characters: readonly Character[],
  formatted: string,
  rendered: readonly string[],
): ShownCharacter[] {
  return rendered.some((text) => text.includes(formatted)) ? shownCharacters(characters) : []
}

const CREATED_THIS_RUN: ClassifierCharacterView = { appearance: true, profile: true }
const NOT_SHOWN: ClassifierCharacterView = { appearance: false, profile: false }

/**
 * What the classifier was shown of a character, looked up by name. `shown` is the list the
 * prompt was built from; a result without one showed nobody. A character missing from both
 * the list and the cast was created by this response and has nothing unseen to lose; one that
 * exists but was not listed was not shown.
 */
export function viewsForApply(
  shown: readonly ShownCharacter[] | undefined,
  castBeforeApply: readonly Character[],
): (name: string) => ClassifierCharacterView {
  const listed = shown ?? []
  const existed = castBeforeApply.map((c) => c.name)
  return (name) => {
    const entry = listed.find((s) => sameEntityName(s.name, name))
    if (entry) return { appearance: entry.appearance, profile: entry.profile }
    return existed.some((n) => sameEntityName(n, name)) ? NOT_SHOWN : CREATED_THIS_RUN
  }
}

export type RenameRefusal = 'empty' | 'protagonist' | 'taken'

/**
 * The name `newName` gives `existing`, or why it is refused. Null when it is the name the
 * character already has. A name another character holds is refused: that is a duplicate to
 * merge, not a rename.
 */
export function planRename(
  existing: Character,
  newName: string,
  cast: readonly Character[],
): { name: string } | { refused: RenameRefusal } | null {
  const name = newName.trim()
  if (!name) return { refused: 'empty' }
  if (existing.relationship === 'self') return { refused: 'protagonist' }
  if (sameEntityName(name, existing.name)) return null
  if (cast.some((c) => c.id !== existing.id && sameEntityName(c.name, name)))
    return { refused: 'taken' }
  return { name }
}

// A copy-on-write override has its own id; the row it overrides is the character.
const rootId = (c: Character) => c.overridesId ?? c.id

/**
 * Finds the character a response names, while its renames are applied. The response names
 * characters as they were listed, so a listed name wins over the same name given to someone
 * else by a rename; any other name is looked up in the cast as it is now.
 */
export function responseCast(listed: readonly Character[]) {
  return {
    find(cast: readonly Character[], name: string): Character | undefined {
      const was = listed.find((c) => sameEntityName(c.name, name))
      const now = was && cast.find((c) => rootId(c) === rootId(was))
      return now ?? cast.find((c) => sameEntityName(c.name, name))
    },
    /** The name the classifier was shown for `c`, or its own if it was not listed. */
    listedName: (c: Character) => listed.find((l) => rootId(l) === rootId(c))?.name ?? c.name,
  }
}

/**
 * Format existing characters for the prompt.
 *
 * **The name is the whole of its line.** The model reads this list and writes names back,
 * so a rendered suffix — `- Ada (claimed as a consort) [inactive]` — comes back as the
 * name and mints a second character. Attributes are indented `label: value` lines
 * instead, which a name containing parentheses cannot be confused with.
 *
 * Description, traits and appearance are listed only where `classifierCharacterView`
 * allows a rewrite; on a large cast the omitted ones are also most of the prompt.
 */
export function formatExistingCharacters(characters: Character[]): string {
  if (characters.length === 0) return '(none)'

  return characters
    .map((c) => {
      const status = c.status ?? 'active'
      const view = classifierCharacterView(c)
      let entry = `- ${c.name}`
      if (c.relationship) entry += attribute('relationship', c.relationship)
      // `active` is printed too, or the list is asymmetric: the model would be reminded to
      // report a return and never a departure.
      entry += attribute('status', status)
      if (view.profile) {
        const description = c.description?.trim()
        if (description) entry += attribute('description', description)
        // A JSON list, since a trait may hold a comma and the model writes the list back whole.
        const traits = uniqueTerms(c.traits ?? [])
        if (traits.length > 0) entry += attribute('traits', JSON.stringify(traits))
      }
      if (view.appearance && hasDescriptors(c.visualDescriptors)) {
        entry += attribute('appearance', descriptorsToString(c.visualDescriptors))
      }
      return entry
    })
    .join('\n')
}

// Every further line of a value is indented, so none can be read as a name; blank lines stay.
// `trimLines` takes the indent off what the model writes back.
function attribute(label: string, value: string): string {
  const [first, ...rest] = trimLines(value).split('\n')
  return [`\n  ${label}: ${first}`, ...rest.map((line) => (line ? `    ${line}` : ''))].join('\n')
}

function trimLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

export type RewriteField = 'description' | 'traits' | 'visualDescriptors'

export interface IgnoredRewrite {
  field: RewriteField
  reason: 'empty' | 'not shown' | 'protagonist'
}

export interface CharacterChangePlan {
  changes: Partial<Character>
  ignored: IgnoredRewrite[]
}

/**
 * The writes one `characterUpdates` element makes to `existing`. Runtime variables are the
 * caller's: they need the pack's definitions.
 *
 * A rewrite of a field the classifier was not shown is ignored, and so is an empty one: an
 * empty value never erases what is recorded. A rewrite equal to the current value is no change.
 * A rewritten field drops its translation, which would otherwise be shown in its place.
 */
export function planCharacterChanges(
  existing: Character,
  update: CharacterUpdate['changes'],
  view: ClassifierCharacterView,
): CharacterChangePlan {
  const changes: Partial<Character> = {}
  const ignored: IgnoredRewrite[] = []
  const hidden = (field: RewriteField) =>
    ignored.push({
      field,
      reason:
        field !== 'visualDescriptors' && existing.relationship === 'self'
          ? 'protagonist'
          : 'not shown',
    })

  if (update.status && update.status !== (existing.status ?? 'active')) {
    changes.status = update.status
  }
  // The protagonist's relationship is only changed by an explicit swap.
  if (
    update.relationship &&
    existing.relationship !== 'self' &&
    update.relationship !== 'self' &&
    update.relationship !== existing.relationship
  ) {
    changes.relationship = update.relationship
    changes.translatedRelationship = null
  }

  if (update.description !== undefined) {
    const description = trimLines(update.description)
    if (!description) ignored.push({ field: 'description', reason: 'empty' })
    else if (!view.profile) hidden('description')
    else if (description !== trimLines(existing.description ?? '')) {
      changes.description = description
      changes.translatedDescription = null
    }
  }

  if (update.traits !== undefined) {
    const traits = traitList(update.traits)
    if (traits.length === 0) ignored.push({ field: 'traits', reason: 'empty' })
    else if (!view.profile) hidden('traits')
    else if (!sameTerms(traits, existing.traits ?? [])) {
      changes.traits = traits
      changes.translatedTraits = null
    }
  }

  if (update.visualDescriptors !== undefined) {
    const descriptors = withoutBlanks(update.visualDescriptors)
    if (!hasDescriptors(descriptors)) ignored.push({ field: 'visualDescriptors', reason: 'empty' })
    else if (!view.appearance) hidden('visualDescriptors')
    else if (!sameDescriptors(descriptors, withoutBlanks(existing.visualDescriptors ?? {}))) {
      changes.visualDescriptors = descriptors
      changes.translatedVisualDescriptors = null
    }
  }

  return { changes, ignored }
}

// The same traits in any order or spelling variant `termKey` folds are no change.
function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  const keys = new Set(uniqueTerms(b).map(termKey))
  return a.length === keys.size && a.every((term) => keys.has(termKey(term)))
}

export const MAX_TRAITS = 8

/** Traits as stored: deduplicated, and no more than the prompt allows. */
export function traitList(traits: readonly string[]): string[] {
  return uniqueTerms(traits).slice(0, MAX_TRAITS)
}

function sameDescriptors(a: VisualDescriptors, b: VisualDescriptors): boolean {
  return DESCRIPTOR_CATEGORIES.every((k) => a[k] === b[k])
}

// Only the known categories, so a stray key the model adds is dropped.
function withoutBlanks(descriptors: VisualDescriptors): VisualDescriptors {
  const out: VisualDescriptors = {}
  for (const key of DESCRIPTOR_CATEGORIES) {
    const value = descriptors[key]
    const text = typeof value === 'string' ? trimLines(value) : ''
    if (text) out[key] = text
  }
  return out
}
