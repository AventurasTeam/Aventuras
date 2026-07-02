import { describe, expect, it } from 'vitest'

import { createEngine } from '../engine'
import { PER_TURN_NARRATIVE } from './per-turn'
import type { Pack } from '../types'

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

function render(source: string): string {
  const pack: Pack = {
    templates: { t: { group: 'generationContext', source } },
    macros: { macro_output_format_narrative: { group: 'staticContent', source: 'FMT' } },
  }
  return createEngine(pack).renderFileSync('t', context) as string
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

  it('permanent negative fixture: an injectionMode-respecting variant DROPS it', () => {
    expect(injectsSceneEntity(BROKEN_PER_TURN)).toBe(false)
  })
})
