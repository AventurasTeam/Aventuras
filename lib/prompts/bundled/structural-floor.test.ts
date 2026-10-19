import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import { buildEntityViews, emptyEntityView } from '@/lib/world'

import { createEngine, renderWith } from '../engine'
import type { Pack } from '../types'
import { bundledPack } from './index'
import { PER_TURN_NARRATIVE } from './per-turn'
import { PIGGYBACK_FALLBACK_CLASSIFIER } from './piggyback-fallback-classifier'
import { STATE_EMISSION } from './state-emission'
import { SUGGESTION_REFRESH } from './suggestion-refresh'

const sceneEntity = {
  id: 'char_1',
  kind: 'character',
  name: 'Aria',
  description: 'A wary scout.',
  status: 'active',
  injectionMode: 'disabled', // user-disabled, but active + in-scene => must inject
}

const context = {
  entities: [sceneEntity],
  sceneEntities: ['char_1'],
  entries: [{ content: 'The gate groaned open.' }],
  // Empty, not absent — buildGenerationContext emits every bucket on every
  // call, and `nil.size > 0` is false for a reason the guard does not own.
  structuralLocation: null,
  structuralActiveThreads: [],
  structuralPinnedEntities: [],
  structuralSceneFactions: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
}

// Permanent negative fixture: a deliberately injectionMode-respecting scene
// loop — the inverse of the structural-floor rule. Run through the SAME check
// with the opposite expectation, it proves the positive assertion actually
// discriminates (would catch a regression in the check itself, not just the
// template).
const BROKEN_PER_TURN = `# Characters in scene
{% for e in entities | active -%}
{%- if sceneEntities contains e.id and e.injectionMode != 'disabled' %}
## {{ e.name }}
{{ e.description }}
{% endif -%}
{%- endfor %}`

function render(source: string, extra: Record<string, unknown> = {}): string {
  // Real macro sources, not stubs: the negative case below turns on memory-blocks being the
  // ONLY route a staged entity has into the prompt.
  const pack: Pack = {
    templates: { t: { group: 'generationContext', system: '', user: source } },
    macros: bundledPack.macros,
  }
  return renderWith(createEngine(pack), 't', { ...context, ...extra }).user
}

// The invariant check, factored so both fixtures run the identical assertion.
function injectsSceneEntity(source: string): boolean {
  return render(source).includes('## Aria')
}

describe('structural-floor invariant — active + in-scene always inject', () => {
  it('bundled per-turn template injects a disabled-but-active-in-scene entity', () => {
    expect(injectsSceneEntity(PER_TURN_NARRATIVE.user)).toBe(true)
    expect(render(PER_TURN_NARRATIVE.user)).toContain('A wary scout.')
  })

  it('bundled suggestion-refresh template injects a disabled-but-active-in-scene entity', () => {
    expect(injectsSceneEntity(SUGGESTION_REFRESH.user)).toBe(true)
    expect(render(SUGGESTION_REFRESH.user)).toContain('A wary scout.')
  })

  it('permanent negative fixture: an injectionMode-respecting variant DROPS it', () => {
    expect(injectsSceneEntity(BROKEN_PER_TURN)).toBe(false)
  })
})

// The floor's counterpart: what is NOT structural has to earn its seat, and the
// ranker's bundle is a staged entity's only route into the prompt.
describe('non-structural rows reach the prompt only by winning budget', () => {
  const stagedEntity = {
    id: 'char_2',
    kind: 'character',
    name: 'Mira',
    description: 'A courier who owes the guild.',
    status: 'staged',
    injectionMode: 'auto',
  }

  it('does not dump a staged entity that only the branch roster knows about', () => {
    const out = render(PER_TURN_NARRATIVE.user, { entities: [sceneEntity, stagedEntity] })
    expect(out).not.toContain('Mira')
    // Positive control: an empty render would satisfy the line above just as
    // well, so pin something the same render must still carry.
    expect(out).toContain('## Aria')
  })

  it('renders a staged entity that WON budget, with its sub-pool framing', () => {
    const out = render(PER_TURN_NARRATIVE.user, {
      entities: [sceneEntity, stagedEntity],
      retrievedEntities: [
        {
          ...stagedEntity,
          displayName: 'Mira',
          renderedText: 'never rendered',
          state: emptyEntityView('character'),
        },
      ],
    })
    expect(out).toContain('# Elsewhere in the world')
    expect(out).toContain('Mira (available to introduce): A courier who owes the guild.')
  })
})

// architecture.md → Entity state on the template surface: a disabled entity is absent from every
// state the prompt shows, unless the active+in-scene invariant seats it.
describe('structural-floor invariant — entity state', () => {
  const ARIA = 'char_1'
  const world = (overrides: { sword?: Partial<Entity>; hand?: Partial<Entity> } = {}): Entity[] => [
    makeEntity({
      id: ARIA,
      kind: 'character',
      name: 'Aria',
      description: 'A wary scout.',
      state: { inventory: ['item_s'], equipped_items: [], faction_id: 'fact_h' } as never,
    }),
    makeEntity({
      id: 'item_s',
      kind: 'item',
      name: 'Sabre',
      state: { at_location_id: null },
      injectionMode: 'disabled',
      ...overrides.sword,
    }),
    makeEntity({
      id: 'fact_h',
      kind: 'faction',
      name: 'The Silver Hand',
      injectionMode: 'disabled',
      ...overrides.hand,
    }),
  ]
  // The context generation-context builds: every entity projected with its view.
  const contextOf = (entities: Entity[], sceneEntities: string[]) => {
    const views = buildEntityViews(entities, { sceneEntities, currentLocationId: null })
    return {
      entities: entities.map((e) => ({ ...e, state: views.byId.get(e.id) })),
      sceneEntities,
    }
  }
  // Skips the fallback's roster: it names every active and staged entity, a rule apart from state.
  const fromScene = (out: string): string => out.slice(out.indexOf('# In scene'))
  const templates = [
    ['per-turn', PER_TURN_NARRATIVE.user],
    ['the fallback classifier', PIGGYBACK_FALLBACK_CLASSIFIER.user],
    ['suggestion refresh', SUGGESTION_REFRESH.user],
  ] as const

  it.each(templates)(
    '%s renders a disabled held item the scene seats, under its holder',
    (_, source) => {
      const out = render(source, contextOf(world(), [ARIA, 'item_s']))
      expect(out).toMatch(/Holds:\n- (\[item_s\] )?Sabre/)
      // Seated by the scene, so under its holder and not as an entity of its own.
      expect(out).not.toContain('## Sabre')
    },
  )

  it.each(templates)('%s leaves out a disabled held item the scene does not seat', (_, source) => {
    const out = fromScene(render(source, contextOf(world(), [ARIA])))
    expect(out).toContain('## Aria')
    expect(out).not.toContain('Sabre')
    // Positive control: enabled, the same item is listed under its holder.
    expect(
      render(source, contextOf(world({ sword: { injectionMode: 'auto' } }), [ARIA])),
    ).toContain('Sabre')
  })

  it.each(templates)('%s shows a disabled faction on no member', (_, source) => {
    const out = fromScene(render(source, contextOf(world(), [ARIA])))
    expect(out).toContain('## Aria')
    expect(out).not.toContain('The Silver Hand')
    // Positive control: enabled, the member names it.
    expect(render(source, contextOf(world({ hand: { injectionMode: 'auto' } }), [ARIA]))).toContain(
      'Faction: The Silver Hand',
    )
  })

  // The scene list leaves out a staged or retired holder, so its Holds line never shows the item.
  it.each(
    templates.flatMap(([name, source]) =>
      (['staged', 'retired'] as const).map((status) => [name, status, source] as const),
    ),
  )('%s lists an in-scene item whose only holder is %s', (_, status, source) => {
    const rows = [
      makeEntity({ id: ARIA, kind: 'character', name: 'Aria' }),
      makeEntity({
        id: 'char_h',
        kind: 'character',
        name: 'Hollin',
        status,
        state: { inventory: ['item_l'], equipped_items: [] } as never,
      }),
      makeEntity({ id: 'item_l', kind: 'item', name: 'Lantern', state: { at_location_id: null } }),
    ]
    const ctx = contextOf(rows, [ARIA, 'char_h', 'item_l'])
    expect(ctx.entities.find((e) => e.id === 'item_l')?.state).toMatchObject({
      holder: { id: 'char_h', status },
    })

    const out = fromScene(render(source, ctx))
    expect(out).toContain('## Lantern')
    expect(out).not.toContain('Hollin')
  })

  // LiquidJS drops a filter on a for tag's collection, which would let every status through.
  it.each(templates)('%s lists only active entities in scene', (_, source) => {
    const rows = [
      makeEntity({ id: ARIA, kind: 'character', name: 'Aria' }),
      makeEntity({ id: 'char_s', kind: 'character', name: 'Sefa', status: 'staged' }),
      makeEntity({ id: 'char_r', kind: 'character', name: 'Rook', status: 'retired' }),
    ]
    const out = render(source, contextOf(rows, [ARIA, 'char_s', 'char_r']))
    expect(out).toContain('## Aria')
    expect(out).not.toContain('## Sefa')
    expect(out).not.toContain('## Rook')
  })
})

describe('state emission includes retrieval query instructions', () => {
  // A schema field with no instruction is a field the model never fills. The
  // cap and the next-turn framing both have to reach the model, not just the parser.
  it('asks for retrieval queries by tag, capped, framed as next-turn context', () => {
    expect(STATE_EMISSION).toContain('<retrieval_queries>')
    expect(STATE_EMISSION).toContain('<query>')
    expect(STATE_EMISSION).toMatch(/up to three/i)
    expect(STATE_EMISSION).toMatch(/next turn/i)
  })
})
