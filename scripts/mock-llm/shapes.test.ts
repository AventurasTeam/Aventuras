import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
import { refineBoundaryReply } from '@/lib/pipeline'
import { bundledPack, TEMPLATE_IDS, type TemplateId } from '@/lib/prompts'

import { findShapeByName, STRUCTURED_SHAPES } from './shapes'
import { EXAMPLES } from '../../e2e/harness/mock-llm'

// The registry is shared with the E2E harness but the default replies are not.
// These assertions are the seam: they fail when a shape is added to the shared
// list without giving the suite something valid to answer with, which would
// otherwise surface as `undefined` in a completion body mid-run.
describe('E2E harness examples', () => {
  it('covers every registered shape', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(STRUCTURED_SHAPES.map((s) => s.name).sort())
  })

  it('answers each shape with a value that shape accepts', () => {
    for (const shape of STRUCTURED_SHAPES) {
      const result = shape.schema.safeParse(EXAMPLES[shape.name])
      expect(result.success, `${shape.name}: ${result.error?.message ?? ''}`).toBe(true)
    }
  })

  it('keeps the suggestion-refresh default resolvable, since an empty one fails the run', () => {
    const value = EXAMPLES['suggestion-refresh'] as { suggestions: unknown[] }
    expect(value.suggestions).toHaveLength(1)
  })

  it('keeps the classifier defaults inert so a spec that sets nothing writes nothing', () => {
    expect(EXAMPLES['per-turn-classifier']).toEqual({ sceneEntities: [], worldTimeDelta: 0 })
    expect(EXAMPLES['periodic-classifier']).toEqual({
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
      newFactions: [],
      memberships: [],
      renames: [],
      placements: [],
      standings: [],
      newThreads: [],
      threadStatuses: [],
      knownAwareness: [],
    })
    expect(EXAMPLES['periodic-classifier-places']).toEqual({
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
      newFactions: [],
      memberships: [],
      renames: [],
      placements: [],
      standings: [],
      newThreads: [],
      threadStatuses: [],
      knownAwareness: [],
      newPlaces: [],
    })
  })

  // Turn ids number a call's candidates from t1, so no call's refined parse accepts the default.
  it('keeps the chapter-boundary default inert, naming no candidate', () => {
    expect(EXAMPLES['chapter-boundary']).toEqual({
      end_entry_id: 't0',
      rationale: 'The mock names no candidate.',
    })
    const handles = new Set(['t1', 't2', 't3'])
    expect(refineBoundaryReply(handles).safeParse(EXAMPLES['chapter-boundary']).success).toBe(false)
  })

  // AC3: the app sends the refined schema; the registry holds the plain one. Their blocks must agree.
  it("matches the chapter-boundary block the app renders for a call's refined schema", () => {
    const shape = findShapeByName('chapter-boundary')
    expect(shape?.block).toBe(
      schemaToTypeScriptBlock(
        z.toJSONSchema(refineBoundaryReply(new Set(['t1', 't2']))) as JsonSchema,
      ),
    )
  })
})

// The single call and the merge share chapterMetadataSchema's block, and pickByMarker takes the
// earliest marker across the system and user halves, so no metadata marker may sit in a sibling.
describe('chapter metadata markers', () => {
  const METADATA_TEMPLATES: Record<string, TemplateId> = {
    'chapter-metadata': TEMPLATE_IDS.chapterMetadata,
    'chapter-metadata-part': TEMPLATE_IDS.chapterMetadataPart,
    'chapter-metadata-merge': TEMPLATE_IDS.chapterMetadataMerge,
  }

  const markerFor = (name: string): string => {
    const shape = findShapeByName(name)
    if (shape === undefined) throw new Error(`registry lost ${name}`)
    return shape.marker
  }

  it('gives each metadata call a distinct, non-empty marker that opens its own user half', () => {
    const markers = Object.keys(METADATA_TEMPLATES).map(markerFor)
    expect(markers).not.toContain('')
    expect(new Set(markers).size).toBe(markers.length)
    for (const [name, templateId] of Object.entries(METADATA_TEMPLATES)) {
      const user = bundledPack.templates[templateId]?.user ?? ''
      expect(user.trimStart().startsWith(markerFor(name)), name).toBe(true)
    }
  })

  it("keeps each metadata marker out of the other metadata templates' halves", () => {
    for (const name of Object.keys(METADATA_TEMPLATES)) {
      const marker = markerFor(name)
      for (const [other, templateId] of Object.entries(METADATA_TEMPLATES)) {
        if (other === name) continue
        const template = bundledPack.templates[templateId]
        expect(
          template?.system.includes(marker),
          `${name}'s marker in ${other}'s system half`,
        ).toBe(false)
        expect(template?.user.includes(marker), `${name}'s marker in ${other}'s user half`).toBe(
          false,
        )
      }
    }
  })
})
