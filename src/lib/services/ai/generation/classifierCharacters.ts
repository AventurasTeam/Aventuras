/**
 * The classifier's view of existing characters: what it is shown of each one, and which of
 * its rewrites are therefore accepted.
 *
 * Description, traits and appearance are whole-value replacements, so a rewrite is only taken
 * for a field the model was shown. The list and the apply step read the same rule.
 */

import type { Character } from '#lib/types/index.ts'
import type { CharacterUpdate } from '../sdk/schemas/classifier'
import { sameEntityName, uniqueTerms } from '#lib/utils/text.ts'

export interface ClassifierCharacterView {
  /** `appearance:` is listed, so `visualDescriptors` may be rewritten. */
  appearance: boolean
  /** `description:` and `traits:` are listed, so both may be rewritten. */
  profile: boolean
}

/**
 * Characters in the scene are shown in full. The protagonist's description and traits are
 * left out: they are usually the reader's own setup, and the protagonist is in every scene.
 */
export function classifierCharacterView(c: Character): ClassifierCharacterView {
  const active = (c.status ?? 'active') === 'active'
  return { appearance: active, profile: active && c.relationship !== 'self' }
}

/** A character created by the same response has nothing unseen to lose. */
const CREATED_THIS_RUN: ClassifierCharacterView = { appearance: true, profile: true }

/**
 * The view each character had when the classifier was prompted, looked up by name. Taken
 * before any update is applied, so a status changed earlier in the same response does not
 * widen it. A name not found was created by this response.
 */
export function viewsBeforeApply(
  characters: readonly Character[],
): (name: string) => ClassifierCharacterView {
  const views = characters.map((c) => ({ name: c.name, view: classifierCharacterView(c) }))
  return (name) => views.find((v) => sameEntityName(v.name, name))?.view ?? CREATED_THIS_RUN
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
      if (c.relationship) entry += `\n  relationship: ${c.relationship}`
      // `active` is printed too, or the list is asymmetric: the model would be reminded to
      // report a return and never a departure.
      entry += `\n  status: ${status}`
      if (view.profile) {
        const description = c.description?.trim()
        if (description) entry += `\n  description: ${indentContinuation(description)}`
        const traits = uniqueTerms(c.traits ?? [])
        if (traits.length > 0) entry += `\n  traits: ${traits.join(', ')}`
      }
      if (view.appearance && hasDescriptors(c.visualDescriptors)) {
        entry += `\n  appearance: ${formatVisualDescriptors(c.visualDescriptors)}`
      }
      return entry
    })
    .join('\n')
}

// A line break inside a value must not start a line the model could read as a name.
function indentContinuation(text: string): string {
  return text.replace(/\s*\n\s*/g, '\n    ')
}

function hasDescriptors(descriptors: Character['visualDescriptors'] | undefined): boolean {
  return !!descriptors && Object.values(descriptors).some((v) => !!v?.trim())
}

function formatVisualDescriptors(descriptors: Character['visualDescriptors']): string {
  if (!descriptors) return ''

  const parts: string[] = []
  if (descriptors.face) parts.push(`Face: ${descriptors.face}`)
  if (descriptors.hair) parts.push(`Hair: ${descriptors.hair}`)
  if (descriptors.eyes) parts.push(`Eyes: ${descriptors.eyes}`)
  if (descriptors.build) parts.push(`Build: ${descriptors.build}`)
  if (descriptors.clothing) parts.push(`Clothing: ${descriptors.clothing}`)
  if (descriptors.accessories) parts.push(`Accessories: ${descriptors.accessories}`)
  if (descriptors.distinguishing) parts.push(`Distinguishing: ${descriptors.distinguishing}`)

  return parts.join(', ')
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

  if (update.status) changes.status = update.status
  // The protagonist's relationship is only changed by an explicit swap.
  if (update.relationship && existing.relationship !== 'self' && update.relationship !== 'self') {
    changes.relationship = update.relationship
  }

  if (update.description !== undefined) {
    const description = update.description.trim()
    if (!description) ignored.push({ field: 'description', reason: 'empty' })
    else if (!view.profile) hidden('description')
    else if (description !== existing.description?.trim()) changes.description = description
  }

  if (update.traits !== undefined) {
    const traits = uniqueTerms(update.traits)
    if (traits.length === 0) ignored.push({ field: 'traits', reason: 'empty' })
    else if (!view.profile) hidden('traits')
    else if (!sameTerms(traits, existing.traits ?? [])) changes.traits = traits
  }

  if (update.visualDescriptors !== undefined) {
    const descriptors = withoutBlanks(update.visualDescriptors)
    if (Object.keys(descriptors).length === 0) {
      ignored.push({ field: 'visualDescriptors', reason: 'empty' })
    } else if (!view.appearance) hidden('visualDescriptors')
    else changes.visualDescriptors = descriptors
  }

  return { changes, ignored }
}

function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((term, i) => term === b[i]?.trim())
}

function withoutBlanks(
  descriptors: Character['visualDescriptors'],
): Character['visualDescriptors'] {
  const out: Character['visualDescriptors'] = {}
  for (const [key, value] of Object.entries(descriptors)) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) out[key as keyof Character['visualDescriptors']] = text
  }
  return out
}
