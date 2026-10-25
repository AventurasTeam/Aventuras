/**
 * The classifier's view of existing characters: what it is shown of each one, and which of
 * its rewrites are therefore accepted.
 *
 * Description, traits and appearance are whole-value replacements, so a rewrite is only taken
 * for a field the model was shown. The list and the apply step read the same rule.
 */

import type { Character, VisualDescriptors } from '#lib/types/index.ts'
import type { CharacterUpdate, NewCharacter, ShownCharacter } from '../sdk/schemas/classifier'
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

/** The parts of a classifier response that are about characters. */
export interface CharacterResponse {
  updates: readonly CharacterUpdate[]
  newCharacters: readonly NewCharacter[]
  presentNames: readonly string[]
}

/** What the response sent about a character, in order; the caller reads its runtime variables. */
export type CharacterSource = CharacterUpdate['changes'] | NewCharacter

export type NewCharacterFields = Pick<
  Character,
  'name' | 'description' | 'relationship' | 'traits' | 'visualDescriptors' | 'status'
>

export interface PlannedUpdate {
  /** The row as the response found it. */
  character: Character
  /** Every change the response makes to it, renames included, as one write. */
  changes: Partial<Character>
  ignored: IgnoredRewrite[]
  sources: CharacterSource[]
}

export interface PlannedCreate {
  fields: NewCharacterFields
  sources: CharacterSource[]
}

export interface CharacterResponsePlan {
  updates: PlannedUpdate[]
  creates: PlannedCreate[]
  refusedRenames: Array<{ name: string; newName: string; reason: RenameRefusal }>
  /** Who the response places in the scene, by the names they have once it is applied. */
  presentNames: string[]
  /** The `newCharacters` entries, by the names they have once it is applied. */
  newNames: string[]
  /** The characters an update gave a status, by the names they have once it is applied. */
  explicitStatusNames: string[]
  /** The ids of existing characters the response places in the scene. */
  presentIds: string[]
}

interface Planned {
  /** The existing row, or null for a character the response creates. */
  original: Character | null
  /** The name the classifier was shown, for an existing character. */
  listed: string | null
  /** Other names the response gave a character it creates. */
  aliases: string[]
  row: Character
  changes: Partial<Character>
  ignored: IgnoredRewrite[]
  sources: CharacterSource[]
}

/**
 * What a whole response does to the cast, worked out on a copy so it can be applied, and
 * tested, as one plan. The response names characters as they were listed: a listed name means
 * that character even after a rename in the same response gave the name to someone else, and
 * any other name is looked up by the names the plan has given so far. Renames apply first, so
 * the rest of the response may name a renamed character either way.
 *
 * An update naming no one goes to the character holding its new name, or creates one under it
 * from the `newCharacters` entry filed under either name, and answers to both. A
 * `newCharacters` entry naming a character that exists, by any of its names, adds nothing.
 */
export function planCharacterResponse(
  cast: readonly Character[],
  response: CharacterResponse,
  shown: readonly ShownCharacter[] | undefined,
): CharacterResponsePlan {
  const view = viewsForApply(shown, cast)
  const planned: Planned[] = cast.map((c) => ({
    original: c,
    listed: c.name,
    aliases: [],
    row: { ...c },
    changes: {},
    ignored: [],
    sources: [],
  }))
  const find = (name: string) =>
    planned.find((p) => p.listed !== null && sameEntityName(p.listed, name)) ??
    planned.find(
      (p) => sameEntityName(p.row.name, name) || p.aliases.some((a) => sameEntityName(a, name)),
    )
  const write = (p: Planned, changes: Partial<Character>) => {
    Object.assign(p.row, changes)
    if (p.original) Object.assign(p.changes, changes)
  }
  const create = (
    name: string,
    data: NewCharacter | undefined,
    status: Character['status'],
    aliases: string[] = [],
  ) => {
    const p: Planned = {
      original: null,
      listed: null,
      aliases,
      row: {
        id: `new:${planned.length}`,
        storyId: '',
        name,
        description: data?.description ?? null,
        relationship: data?.relationship ?? null,
        traits: traitList(data?.traits ?? []),
        visualDescriptors: data?.visualDescriptors ?? {},
        status,
        metadata: null,
        portrait: null,
        branchId: null,
      },
      changes: {},
      ignored: [],
      sources: data ? [data] : [],
    }
    planned.push(p)
    return p
  }

  const refusedRenames: CharacterResponsePlan['refusedRenames'] = []
  for (const update of response.updates) {
    const newName = update.changes.newName
    const target = newName ? find(update.name) : undefined
    if (!newName || !target) continue
    const rename = planRename(
      target.row,
      newName,
      planned.map((p) => p.row),
    )
    if (rename && 'refused' in rename)
      refusedRenames.push({ name: target.row.name, newName, reason: rename.refused })
    else if (rename) write(target, { name: rename.name, translatedName: null })
  }

  const used = new Set<NewCharacter>()
  const statusTargets: Planned[] = []
  for (const update of response.updates) {
    const newName = update.changes.newName?.trim()
    let target = find(update.name) ?? (newName ? find(newName) : undefined)
    if (!target) {
      const data = response.newCharacters.find(
        (nc) =>
          !used.has(nc) &&
          (sameEntityName(nc.name, update.name) || (!!newName && sameEntityName(nc.name, newName))),
      )
      if (data) used.add(data)
      target = create(newName || (data?.name ?? update.name), data, data?.status ?? 'active', [
        update.name,
        ...(data ? [data.name] : []),
      ])
    }
    const { changes, ignored } = planCharacterChanges(
      target.row,
      update.changes,
      target.original ? view(target.listed ?? target.row.name) : CREATED_THIS_RUN,
    )
    write(target, changes)
    target.ignored.push(...ignored)
    target.sources.push(update.changes)
    if (update.changes.status !== undefined) statusTargets.push(target)
  }

  for (const nc of response.newCharacters) {
    if (!used.has(nc) && !find(nc.name)) create(nc.name, nc, 'active')
  }

  const finalName = (name: string) => find(name)?.row.name ?? name
  return {
    updates: planned.flatMap((p) =>
      p.original && (Object.keys(p.changes).length > 0 || p.sources.length > 0)
        ? [{ character: p.original, changes: p.changes, ignored: p.ignored, sources: p.sources }]
        : [],
    ),
    creates: planned.flatMap((p) => {
      if (p.original) return []
      const { name, description, relationship, traits, visualDescriptors, status } = p.row
      return [
        {
          fields: { name, description, relationship, traits, visualDescriptors, status },
          sources: p.sources,
        },
      ]
    }),
    refusedRenames,
    presentNames: response.presentNames.map(finalName),
    newNames: response.newCharacters.map((nc) => finalName(nc.name)),
    explicitStatusNames: statusTargets.map((p) => p.row.name),
    presentIds: response.presentNames.flatMap((name) => {
      const original = find(name)?.original
      return original ? [original.id] : []
    }),
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
