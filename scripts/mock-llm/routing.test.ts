import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
// Deep import: the middleware is internal to lib/ai and this test needs the
// real one to prove the extractor tracks the template it renders.
import { promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { fallbackClassifierSchema } from '@/lib/pipeline'
import { renderTemplate, TEMPLATE_IDS, type TemplateId } from '@/lib/prompts'

import { classifyRequest, extractBlockFromPrompt, matchShape, unknownKey } from './routing'
import { findShapeByName, STRUCTURED_SHAPES, type StructuredShape } from './shapes'

type MiddlewareParams = {
  prompt: { role: string; content: { type: string; text: string }[] }[]
  responseFormat?: { type: 'json'; schema?: JsonSchema }
}

/**
 * Runs the app's own middleware to produce the prompt it would actually send,
 * so a change to SCHEMA_INSTRUCTION_TEMPLATE fails here instead of silently
 * degrading every match at runtime.
 */
async function promptAsSent(schema: z.ZodType, text = 'Classify the turn.'): Promise<string> {
  const transform = promptSchemaMiddleware().transformParams
  if (transform === undefined) throw new Error('promptSchemaMiddleware lost transformParams')
  const params: MiddlewareParams = {
    prompt: [{ role: 'user', content: [{ type: 'text', text }] }],
    responseFormat: { type: 'json', schema: z.toJSONSchema(schema) as JsonSchema },
  }
  const out = (await transform({
    params,
  } as unknown as Parameters<typeof transform>[0])) as unknown as MiddlewareParams
  return out.prompt[0]?.content.map((p) => p.text).join('\n') ?? ''
}

function requestFrom(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: 'seed/narrative', messages: [{ role: 'user', content: text }], ...extra }
}

describe('classifyRequest', () => {
  it('routes a streaming call to the narrative lane', () => {
    expect(classifyRequest(requestFrom('anything', { stream: true }))).toEqual({
      lane: 'narrative',
    })
  })

  it('recovers the block the app injects and names the shape', async () => {
    const text = await promptAsSent(fallbackClassifierSchema)

    expect(extractBlockFromPrompt(text)).toBe(
      schemaToTypeScriptBlock(z.toJSONSchema(fallbackClassifierSchema) as JsonSchema),
    )

    const route = classifyRequest(requestFrom(text))
    expect(route).toMatchObject({ lane: 'structured', key: 'per-turn-classifier' })
  })

  it('distinguishes the classifier shape that also asks for suggestions', async () => {
    const withSuggestions = STRUCTURED_SHAPES.find(
      (s) => s.name === 'per-turn-classifier-suggestions',
    )
    if (withSuggestions === undefined) throw new Error('registry lost the suggestions shape')

    const route = classifyRequest(requestFrom(await promptAsSent(withSuggestions.schema)))
    expect(route).toMatchObject({ lane: 'structured', key: 'per-turn-classifier-suggestions' })
  })

  it('matches the force-on path, which sends a JSON Schema instead of a prompt block', () => {
    const route = classifyRequest(
      requestFrom('Classify the turn.', {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'Response', schema: z.toJSONSchema(fallbackClassifierSchema) },
        },
      }),
    )
    expect(route).toMatchObject({ lane: 'structured', key: 'per-turn-classifier' })
  })

  it('gives an unregistered schema a stable lane key instead of failing', async () => {
    const novel = z.object({ mood: z.string(), intensity: z.number() })
    const text = await promptAsSent(novel)

    const route = classifyRequest(requestFrom(text))
    expect(route.lane).toBe('structured')
    if (route.lane !== 'structured') throw new Error('unreachable')
    expect(route.shape).toBeNull()
    expect(route.key).toMatch(/^unknown:[0-9a-f]{8}$/)
    expect(route.block).toContain('mood: string;')

    // Stable across calls: the UI keys a lane on it.
    expect(classifyRequest(requestFrom(text))).toMatchObject({ key: route.key })
  })

  it('falls back to a no-schema key when nothing declares a shape', () => {
    const route = classifyRequest(requestFrom('just some prose, no schema'))
    expect(route).toMatchObject({ key: 'unknown:no-schema', shape: null, block: null })
    expect(unknownKey(null)).toBe('unknown:no-schema')
  })
})

// Every wizard call site, rendered through the app's own prompt pack and its
// own schema middleware, then routed. This is what holds the derived markers
// honest: a template whose opening literal moves — or vanishes behind a Liquid
// tag — stops routing to its own lane here rather than silently serving some
// sibling's canned reply at runtime.
describe('wizard call sites', () => {
  const TEMPLATE_BY_SHAPE: Record<string, TemplateId> = {
    'wizard-genre': TEMPLATE_IDS.wizardGenre,
    'wizard-genre-refine': TEMPLATE_IDS.wizardGenreRefine,
    'wizard-tone': TEMPLATE_IDS.wizardTone,
    'wizard-tone-refine': TEMPLATE_IDS.wizardToneRefine,
    'wizard-setting': TEMPLATE_IDS.wizardSetting,
    'wizard-setting-refine': TEMPLATE_IDS.wizardSettingRefine,
    'wizard-lore': TEMPLATE_IDS.wizardLore,
    'wizard-cast': TEMPLATE_IDS.wizardCast,
    'wizard-opening': TEMPLATE_IDS.wizardOpening,
    'wizard-opening-refine': TEMPLATE_IDS.wizardOpeningRefine,
    'wizard-title-chips': TEMPLATE_IDS.wizardTitleChips,
    'wizard-description': TEMPLATE_IDS.wizardDescription,
    'wizard-description-refine': TEMPLATE_IDS.wizardDescriptionRefine,
  }

  // The projection components/wizard/wizard-assist.ts sends, after substituteIds.
  const WIZARD_CONTEXT = {
    definition: {
      mode: 'adventure',
      setting: 'A city that flooded and stayed.',
      genre: { label: 'Drowned-city fantasy', promptBody: 'Write drowned-city fantasy.' },
      tone: { label: 'Wry', promptBody: 'Write wry and elegiac.' },
    },
    leadEntityId: 'c1',
    opening: { content: 'The blade rasps free of its sheath.' },
    lore: [{ title: 'The ward-work', body: 'Glyph-cut stone under the city.' }],
    cast: [
      {
        id: 'c1',
        name: 'Kael Ashwater',
        kind: 'character',
        status: 'active',
        description: 'A diver.',
      },
      {
        id: 'l1',
        name: 'The Drowned Exchange',
        kind: 'location',
        status: 'active',
        description: 'Flooded.',
      },
    ],
    guidance: 'Keep it short.',
    suggested: ['Bell-speech'],
    current: {
      content: 'An earlier draft.',
      label: 'Wry',
      promptBody: 'Earlier body.',
      setting: 'Earlier setting.',
      description: 'Earlier log line.',
    },
    instruction: 'Make it colder.',
  }

  it('covers every wizard shape in the registry', () => {
    const registered = STRUCTURED_SHAPES.filter((s) => s.group === 'wizard').map((s) => s.name)
    expect(Object.keys(TEMPLATE_BY_SHAPE).sort()).toEqual(registered.sort())
  })

  for (const [name, templateId] of Object.entries(TEMPLATE_BY_SHAPE)) {
    it(`routes ${name} to its own lane`, async () => {
      const shape = findShapeByName(name)
      if (shape === undefined) throw new Error(`registry lost ${name}`)

      const rendered = renderTemplate(templateId, WIZARD_CONTEXT)
      const route = classifyRequest(requestFrom(await promptAsSent(shape.schema, rendered)))

      expect(route).toMatchObject({ lane: 'structured', key: name })
    })
  }
})

describe('STRUCTURED_SHAPES', () => {
  it('carries the exact block the app renders for each schema', () => {
    for (const shape of STRUCTURED_SHAPES) {
      expect(shape.block).toBe(schemaToTypeScriptBlock(z.toJSONSchema(shape.schema) as JsonSchema))
    }
  })

  it('separates every shape that shares a block by a distinct, non-empty marker', () => {
    const byBlock = new Map<string, StructuredShape[]>()
    for (const shape of STRUCTURED_SHAPES) {
      byBlock.set(shape.block, [...(byBlock.get(shape.block) ?? []), shape])
    }
    for (const [, group] of byBlock) {
      if (group.length === 1) continue
      const markers = group.map((s) => s.marker)
      // An empty marker is the dangerous case, not merely a useless one:
      // text.includes('') is true, so it would claim every sibling's calls.
      expect(markers, group.map((s) => s.name).join(', ')).not.toContain('')
      expect(new Set(markers).size, group.map((s) => s.name).join(', ')).toBe(markers.length)
    }
  })

  it('has no marker contained in a sibling marker, which would make the tie-break order-dependent', () => {
    for (const a of STRUCTURED_SHAPES) {
      for (const b of STRUCTURED_SHAPES) {
        if (a.name === b.name || a.block !== b.block) continue
        expect(b.marker.includes(a.marker), `${a.name}'s marker is inside ${b.name}'s`).toBe(false)
      }
    }
  })

  it('has no block contained in another, which the substring scan relies on', () => {
    for (const a of STRUCTURED_SHAPES) {
      for (const b of STRUCTURED_SHAPES) {
        if (a.block === b.block) continue
        expect(b.block.includes(a.block), `${a.name}'s block is inside ${b.name}'s`).toBe(false)
      }
    }
  })
})

describe('matchShape', () => {
  const shapeStub = (name: string, block: string, marker = ''): StructuredShape => ({
    name,
    group: 'story',
    schema: z.unknown(),
    block,
    marker,
  })
  const inner = shapeStub('inner', 'interface Response { a: string }')
  const outer = shapeStub('outer', 'interface Response { a: string } & { b: number }')

  it('prefers the longer block when one nests inside another', () => {
    const text = `prompt text ${outer.block} trailer`
    // Registry order deliberately puts the shorter one first: without the
    // longest-first scan the loose entry would claim a request meant for the
    // more specific schema.
    expect(matchShape(null, text, [inner, outer])?.name).toBe('outer')
  })

  it('takes an exact block match ahead of any substring scan', () => {
    expect(matchShape(inner.block, `${outer.block}`, [inner, outer])?.name).toBe('inner')
  })

  describe('when several call sites share a block', () => {
    const genre = shapeStub('genre', 'interface Response { label: string }', 'Suggest a genre')
    const tone = shapeStub('tone', 'interface Response { label: string }', 'Suggest a tone')
    const pair = [genre, tone]

    it('picks the call site whose marker the prompt carries', () => {
      expect(
        matchShape(genre.block, `Suggest a tone for this story. ${tone.block}`, pair)?.name,
      ).toBe('tone')
    })

    it('prefers the marker the prompt OPENS with over one quoted deeper in it', () => {
      // A refine embeds the preview it is revising, and that preview is model
      // output (or hand-authored, in the dev tool) — it can quote anything,
      // including a sibling call site's directive.
      const quoted = `Suggest a tone for this story. ${genre.marker} — that was the instruction. ${genre.block}`
      expect(matchShape(genre.block, quoted, pair)?.name).toBe('tone')
      // Registry order alone would have answered 'genre': it is listed first.
      expect(pair[0]?.name).toBe('genre')
    })

    it('claims nothing when no marker matches, rather than guessing a sibling', () => {
      // A user-authored pack can rewrite a wizard template; an unregistered
      // lane the panel flags is honest, serving genre's reply to tone is not.
      expect(matchShape(genre.block, `Invent a genre. ${genre.block}`, pair)).toBeNull()
    })

    it('ignores the marker when the block already identifies one call site', () => {
      expect(matchShape(genre.block, 'nothing familiar here', [genre])?.name).toBe('genre')
    })
  })

  it('names every shape uniquely — overrides and lane keys both key on the name', () => {
    const names = STRUCTURED_SHAPES.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('per-turn-classifier')
    expect(names).toContain('periodic-classifier')
    expect(names).toContain('suggestion-refresh')
  })
})
