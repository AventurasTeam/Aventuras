import { describe, expect, it } from 'vitest'

import { TEMPLATE_IDS } from './ids'
import {
  CLOSE_ONLY_CHAPTER_VARIABLES,
  DISPLAY_GROUPS,
  MERGE_ONLY_CHAPTER_VARIABLES,
  TEMPLATE_GROUPS,
  VARIABLES,
  validateRegistry,
  type VariableDef,
} from './templateContextMap'

const ALL_VARIABLES = Object.values(VARIABLES).flat()

// validateRegistry only walks display groups toward variables, leaving both
// reverse directions unchecked: a defined variable in no group, and a
// `category` naming no group. DISPLAY_GROUPS and `category` are two
// hand-maintained copies of one grouping with nothing tying them together.
const ungroupedNames = (defs: readonly VariableDef[]) => {
  const grouped = new Set(Object.values(DISPLAY_GROUPS).flat())
  return defs.filter((v) => !grouped.has(v.name)).map((v) => v.name)
}

const strayCategories = (defs: readonly VariableDef[]) => {
  const groups = new Set(Object.keys(DISPLAY_GROUPS))
  return defs.filter((v) => !groups.has(v.category)).map((v) => `${v.name} -> ${v.category}`)
}

// Positive control for both checks above: one variable that is wrong in both
// directions at once, so neither assertion can pass by finding nothing to look at.
const GHOST: VariableDef = {
  name: 'ghostVariable',
  type: 'string',
  category: 'Bogus Group That Does Not Exist',
  description: 'Defined nowhere, grouped nowhere.',
}

describe('templateContextMap', () => {
  it('maps every shipped template id to a group', () => {
    for (const id of Object.values(TEMPLATE_IDS)) {
      expect(TEMPLATE_GROUPS[id]).toBeDefined()
    }
  })

  // C3: a close's templates read their own group, not generationContext's budgeted entries.
  it("maps the chapter metadata templates, a part's and the merge's too, to the chapter group", () => {
    expect(TEMPLATE_GROUPS[TEMPLATE_IDS.chapterMetadata]).toBe('chapter')
    expect(TEMPLATE_GROUPS[TEMPLATE_IDS.chapterMetadataPart]).toBe('chapter')
    expect(TEMPLATE_GROUPS[TEMPLATE_IDS.chapterMetadataMerge]).toBe('chapter')
  })

  it("defines the chapter group's variables: the metadata builders' and a close task's own", () => {
    expect(VARIABLES.chapter.map((v) => v.name)).toEqual([
      'entries',
      'previousChapterSummary',
      'threads',
      'mode',
      'partSummaries',
      'closeTurns',
      'closeCharacters',
      'closeFactions',
      'closeThreads',
      'closeWritesSoFar',
      'closeSoftCaps',
    ])
  })

  // Only a close task's render sets them, so the metadata call may leave them unset.
  it('lists the close-only chapter variables, none of them required', () => {
    const closeOnly: readonly string[] = CLOSE_ONLY_CHAPTER_VARIABLES
    expect(CLOSE_ONLY_CHAPTER_VARIABLES).toEqual([
      'closeTurns',
      'closeCharacters',
      'closeFactions',
      'closeThreads',
      'closeWritesSoFar',
      'closeSoftCaps',
    ])
    expect(
      VARIABLES.chapter.filter((v) => closeOnly.includes(v.name)).map((v) => [v.name, v.required]),
    ).toEqual([
      ['closeTurns', false],
      ['closeCharacters', false],
      ['closeFactions', false],
      ['closeThreads', false],
      ['closeWritesSoFar', false],
      ['closeSoftCaps', false],
    ])
  })

  // Only the merge of a chapter closed in parts sets it; every other metadata call leaves it unset.
  it('lists the merge-only chapter variable, not required, filed under Story', () => {
    expect(MERGE_ONLY_CHAPTER_VARIABLES).toEqual(['partSummaries'])
    expect(VARIABLES.chapter.find((v) => v.name === 'partSummaries')).toMatchObject({
      type: 'string[]',
      category: 'Story',
      required: false,
    })
    expect(DISPLAY_GROUPS.Story).toContain('partSummaries')
  })

  it("maps the close's task templates to the chapter group", () => {
    expect(TEMPLATE_GROUPS[TEMPLATE_IDS.closeIdentity]).toBe('chapter')
    expect(TEMPLATE_GROUPS[TEMPLATE_IDS.closeThreads]).toBe('chapter')
  })

  // The editor files a variable by its display group; `category` must name the same one.
  it('files each close-only variable under the display group its category names', () => {
    const closeOnly: readonly string[] = CLOSE_ONLY_CHAPTER_VARIABLES
    const categories = Object.fromEntries(
      VARIABLES.chapter.filter((v) => closeOnly.includes(v.name)).map((v) => [v.name, v.category]),
    )
    expect(categories).toEqual({
      closeTurns: 'Story',
      closeCharacters: 'Entities',
      closeFactions: 'Entities',
      closeThreads: 'Plot',
      closeWritesSoFar: 'Story',
      closeSoftCaps: 'Story Config',
    })
    for (const [name, category] of Object.entries(categories))
      expect(DISPLAY_GROUPS[category], name).toContain(name)
  })

  it('passes integrity validation on the shipped registry', () => {
    expect(validateRegistry(Object.values(TEMPLATE_IDS))).toEqual([])
  })

  it('reports an unmapped template id', () => {
    const issues = validateRegistry([...Object.values(TEMPLATE_IDS), 'tmpl_ghost'])
    expect(issues).toContainEqual({ kind: 'unmapped-template', id: 'tmpl_ghost' })
  })

  it('surfaces every defined variable in some display group', () => {
    expect(ungroupedNames(ALL_VARIABLES)).toEqual([])
    expect(ungroupedNames([GHOST])).toEqual(['ghostVariable'])
  })

  it('gives every variable a category that names a display group', () => {
    expect(strayCategories(ALL_VARIABLES)).toEqual([])
    expect(strayCategories([GHOST])).toEqual(['ghostVariable -> Bogus Group That Does Not Exist'])
  })

  // Every variable whose rows carry an entity's `state` documents the view's structure.
  it('documents the state view on every variable that carries one', () => {
    const carriers = [
      'entities',
      'structuralLocation',
      'structuralPinnedEntities',
      'structuralSceneFactions',
      'retrievedEntities',
      'looseItems',
      'namedCharacters',
    ]
    const defs = VARIABLES.generationContext.filter((v) => carriers.includes(v.name))
    expect(defs.map((v) => v.name).sort()).toEqual([...carriers].sort())
    for (const def of defs) {
      expect(
        def.infoFields?.map((f) => f.name),
        def.name,
      ).toContain('state.holdings')
    }
  })

  it('gives every infoFields entry a name, a type and a description', () => {
    const blanks = ALL_VARIABLES.flatMap((v) =>
      (v.infoFields ?? [])
        .filter((f) => !f.name.trim() || !f.type.trim() || !f.description.trim())
        .map((f) => `${v.name}.${f.name}`),
    )
    expect(blanks).toEqual([])
  })

  it('reports a dangling display variable', () => {
    const issues = validateRegistry(Object.values(TEMPLATE_IDS), { Bogus: ['nonexistent_var'] })
    expect(issues).toContainEqual({
      kind: 'dangling-display-variable',
      displayGroup: 'Bogus',
      name: 'nonexistent_var',
    })
  })
})
