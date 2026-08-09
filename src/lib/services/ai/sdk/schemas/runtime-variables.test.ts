import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import type { RuntimeVariable } from '$lib/services/packs/types'
import { buildExtendedClassificationSchema, salvageClassification } from './runtime-variables'

function variable(overrides: Partial<RuntimeVariable> & Pick<RuntimeVariable, 'variableName'>) {
  return {
    id: overrides.variableName,
    packId: 'pack',
    entityType: 'character',
    displayName: overrides.variableName,
    variableType: 'number',
    color: '#fff',
    pinned: false,
    sortOrder: 0,
    createdAt: 0,
    ...overrides,
  } as RuntimeVariable
}

/** A well-formed response, matching what the classifier is asked to produce. */
function response() {
  return {
    entryUpdates: {
      characterUpdates: [{ name: 'Accompanying Knight', changes: { health: 80 } }],
      newCharacters: [{ name: 'Man at The Drunken Dragon', status: 'active', health: 100 }],
      newLocations: [{ name: 'Blackwood', visited: true, current: true }],
      newItems: [{ name: 'Letter from Peter', quantity: 1, location: 'inventory' }],
      newStoryBeats: [{ title: 'Restore the forge', type: 'quest', status: 'active' }],
    },
    scene: {
      currentLocationName: 'Blackwood',
      presentCharacterNames: ['Kaelen Voss'],
      timeProgression: 'minutes',
    },
  }
}

describe('buildExtendedClassificationSchema', () => {
  const health = variable({ variableName: 'health', entityType: 'character', maxValue: 100 })
  const danger = variable({ variableName: 'danger_level', entityType: 'location', maxValue: 10 })

  it('accepts inline runtime variables on updates and new entities', () => {
    const schema = buildExtendedClassificationSchema({ character: [health] }) as z.ZodType
    const parsed = schema.parse(response()) as ReturnType<typeof response>

    expect(parsed.entryUpdates.characterUpdates[0].changes).toEqual({ health: 80 })
    expect(parsed.entryUpdates.newCharacters[0]).toMatchObject({ health: 100 })
  })

  // A variable with no defaultValue used to be a required field on every new entity of
  // its type, so one the model left out threw away the whole turn's world update.
  it('does not require a variable the model omitted on a new entity', () => {
    const schema = buildExtendedClassificationSchema({
      character: [health],
      location: [danger],
    }) as z.ZodType

    const result = schema.safeParse(response())

    expect(result.success).toBe(true)
    const parsed = result.data as ReturnType<typeof response>
    expect(parsed.entryUpdates.newLocations[0].name).toBe('Blackwood')
    expect(parsed.entryUpdates.newCharacters[0]).toMatchObject({ health: 100 })
  })

  // Nothing stops a pack from calling a variable `status`, and `.extend()` lets the last
  // shape win — so without a guard the variable would decide what the entity's own field
  // means, and its value would be written into the native column.
  it('lets the native field win over a variable that shares its name', () => {
    const status = variable({
      variableName: 'status',
      entityType: 'character',
      variableType: 'text',
    })
    const schema = buildExtendedClassificationSchema({ character: [status] }) as z.ZodType

    // 'wounded' is a valid value for the pack's text variable, but not for the native enum.
    const raw = response()
    raw.entryUpdates.newCharacters = [
      { name: 'Man at The Drunken Dragon', status: 'wounded' } as never,
    ]
    expect(schema.safeParse(raw).success).toBe(false)

    raw.entryUpdates.characterUpdates = [
      { name: 'Accompanying Knight', changes: { status: 'wounded' } } as never,
    ]
    expect(schema.safeParse(raw).success).toBe(false)
  })

  it('still rejects a wrongly typed variable, so salvage can drop that element alone', () => {
    const schema = buildExtendedClassificationSchema({ character: [health] }) as z.ZodType
    const bad = response()
    ;(bad.entryUpdates.newCharacters[0] as Record<string, unknown>).health = 'full'

    expect(schema.safeParse(bad).success).toBe(false)
  })
})

describe('salvageClassification', () => {
  const health = variable({ variableName: 'health', entityType: 'character', maxValue: 100 })

  it('keeps the elements that validate and drops only the ones that do not', () => {
    const raw = response()
    // Invalid: `type` is not one of the story beat types.
    raw.entryUpdates.newStoryBeats.push({
      title: 'Find the Legendary Blade',
      type: 'objective',
      status: 'active',
    })

    const salvaged = salvageClassification(raw, { character: [health] })

    expect(salvaged).not.toBeNull()
    expect(salvaged!.entryUpdates.newLocations).toHaveLength(1)
    expect(salvaged!.entryUpdates.newItems).toHaveLength(1)
    expect(salvaged!.entryUpdates.newCharacters).toHaveLength(1)
    expect(salvaged!.entryUpdates.newStoryBeats.map((b) => b.title)).toEqual(['Restore the forge'])
    expect(salvaged!.scene.timeProgression).toBe('minutes')
    expect(salvaged!.scene.currentLocationName).toBe('Blackwood')
  })

  it('fills the arrays the model omitted entirely', () => {
    const salvaged = salvageClassification(response(), {})

    expect(salvaged!.entryUpdates.locationUpdates).toEqual([])
    expect(salvaged!.entryUpdates.itemUpdates).toEqual([])
    expect(salvaged!.entryUpdates.storyBeatUpdates).toEqual([])
  })

  // A bad timeProgression must not cost the current location: the scene's three fields
  // are independent claims, like the arrays around them.
  it('salvages the scene field by field', () => {
    const raw = response()
    ;(raw.scene as Record<string, unknown>).timeProgression = 'a while'

    const salvaged = salvageClassification(raw, {})

    expect(salvaged!.scene.currentLocationName).toBe('Blackwood')
    expect(salvaged!.scene.presentCharacterNames).toEqual(['Kaelen Voss'])
    expect(salvaged!.scene.timeProgression).toBe('none')
  })

  // `timeProgression` carries .default('none'), so an omitted one parses successfully with
  // undefined as its input. Reading the input back instead of the parse result put undefined
  // in the field and left the emptiness check below unable to see an empty scene.
  it("defaults an omitted timeProgression to 'none' when the scene fails for another reason", () => {
    const raw = response()
    const scene = raw.scene as Record<string, unknown>
    scene.currentLocationName = 42
    delete scene.timeProgression

    const salvaged = salvageClassification(raw, {})

    expect(salvaged!.scene.timeProgression).toBe('none')
    expect(salvaged!.scene.currentLocationName).toBeNull()
  })

  it('reports nothing to salvage for an empty turn whose scene also failed to parse', () => {
    const raw = {
      entryUpdates: {},
      // Invalid, so the scene takes the field-by-field path with nothing in it to keep.
      scene: { currentLocationName: 42, presentCharacterNames: 'Kaelen' },
    }

    expect(salvageClassification(raw, {})).toBeNull()
  })

  // An empty result and a failed one are the same object, so the caller has to be able
  // to tell "salvaged nothing" from "salvaged an empty turn".
  it('returns null when there is nothing to salvage', () => {
    expect(salvageClassification(null, {})).toBeNull()
    expect(salvageClassification('not an object', {})).toBeNull()
    expect(salvageClassification({ entryUpdates: {}, scene: {} }, {})).toBeNull()
  })
})

// A runtime variable value is the one part of an element that is recoverable by design —
// that is the whole reason they are optional — so a bad one must cost the value, not the
// entity carrying it.
describe('salvageClassification — a bad variable value', () => {
  const health = variable({ variableName: 'health', entityType: 'character', maxValue: 100 })
  const morale = variable({ variableName: 'morale', entityType: 'character', maxValue: 10 })

  it('keeps the new entity and its other variables, dropping only the bad value', () => {
    const raw = response()
    raw.entryUpdates.newCharacters = [
      { name: 'Man at The Drunken Dragon', status: 'active', health: 'full', morale: 7 } as never,
    ]

    const salvaged = salvageClassification(raw, { character: [health, morale] })

    const [character] = salvaged!.entryUpdates.newCharacters as unknown as Record<string, unknown>[]
    expect(character.name).toBe('Man at The Drunken Dragon')
    expect(character.status).toBe('active')
    expect(character.morale).toBe(7)
    expect(character).not.toHaveProperty('health')
  })

  it('keeps an update whose native changes survive the bad value', () => {
    const raw = response()
    raw.entryUpdates.characterUpdates = [
      {
        name: 'Accompanying Knight',
        changes: { status: 'inactive', health: 'full', morale: 7 },
      } as never,
    ]

    const salvaged = salvageClassification(raw, { character: [health, morale] })

    const [update] = salvaged!.entryUpdates.characterUpdates
    expect(update.name).toBe('Accompanying Knight')
    expect(update.changes.status).toBe('inactive')
    expect((update.changes as Record<string, unknown>).morale).toBe(7)
    expect(update.changes).not.toHaveProperty('health')
  })

  // Applying it would write no column but still copy the entity onto the current branch,
  // since the COW runs before the update rather than after it.
  it('drops an update left holding nothing but the name it addresses', () => {
    const raw = response()
    raw.entryUpdates.characterUpdates = [
      { name: 'Accompanying Knight', changes: { health: 'full' } } as never,
    ]

    const salvaged = salvageClassification(raw, { character: [health] })

    expect(salvaged!.entryUpdates.characterUpdates).toEqual([])
  })
})
