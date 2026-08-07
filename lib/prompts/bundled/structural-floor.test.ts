import { describe, expect, it } from 'vitest'

import { createEngine } from '../engine'
import { MACRO_IDS } from '../ids'
import type { Pack } from '../types'
import { MEMORY_BLOCKS } from './memory-blocks'
import { PER_TURN_NARRATIVE } from './per-turn'
import { STATE_EMISSION } from './state-emission'
import { SUGGESTION_EMISSION_JSON } from './suggestion-emission-json'
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
  definition: {
    mode: 'adventure',
    genre: { promptBody: '' },
    tone: { promptBody: '' },
    setting: '',
  },
  entities: [sceneEntity],
  sceneEntities: ['char_1'],
  entries: [{ content: 'The gate groaned open.' }],
  // Empty, not absent — buildGenerationContext emits every bucket on every
  // call, and `nil.size > 0` is false for a reason the guard does not own.
  structuralLocation: null,
  structuralSceneEntities: [],
  structuralActiveThreads: [],
  structuralPinnedEntities: [],
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
  const pack: Pack = {
    templates: { t: { group: 'generationContext', source } },
    macros: {
      // Real source, not a stub: the negative case below turns on this macro
      // being the ONLY route a staged entity has into the prompt.
      [MACRO_IDS.memoryBlocks]: { group: 'staticContent', source: MEMORY_BLOCKS },
      [MACRO_IDS.outputFormatNarrative]: { group: 'staticContent', source: 'FMT' },
      [MACRO_IDS.stateEmission]: { group: 'staticContent', source: STATE_EMISSION },
      // suggestion-refresh includes this unconditionally (its whole purpose is
      // emitting chips), so an absent stub fails the lookup rather than
      // rendering the scene block this suite is actually checking.
      [MACRO_IDS.suggestionEmissionJson]: {
        group: 'staticContent',
        source: SUGGESTION_EMISSION_JSON,
      },
    },
  }
  return createEngine(pack).renderFileSync('t', { ...context, ...extra }) as string
}

// The invariant check, factored so both fixtures run the identical assertion.
function injectsSceneEntity(source: string): boolean {
  return render(source).includes('## Aria')
}

describe('structural-floor invariant — active + in-scene always inject', () => {
  it('bundled per-turn template injects a disabled-but-active-in-scene entity', () => {
    expect(injectsSceneEntity(PER_TURN_NARRATIVE)).toBe(true)
    expect(render(PER_TURN_NARRATIVE)).toContain('A wary scout.')
  })

  it('bundled suggestion-refresh template injects a disabled-but-active-in-scene entity', () => {
    expect(injectsSceneEntity(SUGGESTION_REFRESH)).toBe(true)
    expect(render(SUGGESTION_REFRESH)).toContain('A wary scout.')
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
    const out = render(PER_TURN_NARRATIVE, { entities: [sceneEntity, stagedEntity] })
    expect(out).not.toContain('Mira')
    // Positive control: an empty render would satisfy the line above just as
    // well, so pin something the same render must still carry.
    expect(out).toContain('## Aria')
  })

  it('renders a staged entity that WON budget, with its sub-pool framing', () => {
    const out = render(PER_TURN_NARRATIVE, {
      entities: [sceneEntity, stagedEntity],
      retrievedEntities: [
        {
          id: 'char_2',
          displayName: 'Mira',
          renderedText: 'Mira (available to introduce): A courier who owes the guild.',
        },
      ],
    })
    expect(out).toContain('# Elsewhere in the world')
    expect(out).toContain('Mira (available to introduce): A courier who owes the guild.')
  })
})
