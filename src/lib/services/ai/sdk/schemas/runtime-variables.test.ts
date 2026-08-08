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

  // An empty result and a failed one are the same object, so the caller has to be able
  // to tell "salvaged nothing" from "salvaged an empty turn".
  it('returns null when there is nothing to salvage', () => {
    expect(salvageClassification(null, {})).toBeNull()
    expect(salvageClassification('not an object', {})).toBeNull()
    expect(salvageClassification({ entryUpdates: {}, scene: {} }, {})).toBeNull()
  })
})
