import { Liquid } from 'liquidjs'

import { registerFilters } from './filters'
import type { Pack, RenderedPrompt } from './types'

export type TemplateHalf = 'system' | 'user'

const HALVES: readonly TemplateHalf[] = ['system', 'user']

// One map entry per half. `#` keeps the key a single path segment, which
// liquidjs's in-memory fs resolves as is, so includes work from either half.
function halfKey(templateId: string, half: TemplateHalf): string {
  return `${templateId}#${half}`
}

// Build a liquidjs engine whose in-memory `templates` map carries every
// template half and macro source, so `{% include 'id' %}` resolves from the pack.
export function createEngine(pack: Pack): Liquid {
  const templates: Record<string, string> = {}
  for (const [id, entry] of Object.entries(pack.templates)) {
    for (const half of HALVES) templates[halfKey(id, half)] = entry[half]
  }
  for (const [id, entry] of Object.entries(pack.macros)) {
    // Templates and macros share one id namespace; an id naming both would leave
    // an include ambiguous to its author, so fail loud instead.
    if (Object.hasOwn(pack.templates, id)) {
      throw new Error(`pack id collision: '${id}' is registered as both a template and a macro`)
    }
    templates[id] = entry.source
  }

  const engine = new Liquid({ templates })
  registerFilters(engine)
  return engine
}

// Memoized per engine: a pack's sources are fixed once loaded, and the parse is
// not free. The union is keyed by the bare id, a half by its map key.
const globalsByEngine = new WeakMap<Liquid, Map<string, ReadonlySet<string>>>()

/**
 * The context variables `templateId` actually reads, following `{% include %}`
 * into macros and excluding anything the half assigns itself. The union of both
 * halves when `half` is omitted.
 */
export function templateGlobals(
  engine: Liquid,
  templateId: string,
  half?: TemplateHalf,
): ReadonlySet<string> {
  let perKey = globalsByEngine.get(engine)
  if (!perKey) {
    perKey = new Map()
    globalsByEngine.set(engine, perKey)
  }

  const key = half === undefined ? templateId : halfKey(templateId, half)
  const cached = perKey.get(key)
  if (cached) return cached

  const globals =
    half === undefined
      ? new Set([
          ...templateGlobals(engine, templateId, 'system'),
          ...templateGlobals(engine, templateId, 'user'),
        ])
      : new Set(engine.globalVariablesSync(engine.parseFileSync(key)))
  perKey.set(key, globals)
  return globals
}

/**
 * Renders both halves against one context, synchronously: every filter and
 * in-memory include is sync. Throws when the user half renders blank, since
 * there would be nothing for the model to answer; a blank system half is legal.
 */
export function renderWith(
  engine: Liquid,
  templateId: string,
  context: Record<string, unknown>,
): RenderedPrompt {
  const system = engine.renderFileSync(halfKey(templateId, 'system'), context) as string
  const user = engine.renderFileSync(halfKey(templateId, 'user'), context) as string
  if (user.trim() === '') throw new Error(`template '${templateId}' rendered a blank user half`)
  return { system, user }
}
