import { Liquid } from 'liquidjs'

import { registerFilters } from './filters'
import type { Pack } from './types'

// Build a liquidjs engine whose in-memory `templates` map carries both template
// and macro sources keyed by id, so `{% include 'id' %}` resolves from the pack.
export function createEngine(pack: Pack): Liquid {
  const templates: Record<string, string> = {}
  for (const [id, entry] of Object.entries(pack.templates)) templates[id] = entry.source
  for (const [id, entry] of Object.entries(pack.macros)) {
    // Templates and macros share one id namespace in the map; a collision would
    // silently shadow a template's source, so fail loud instead.
    if (Object.hasOwn(templates, id)) {
      throw new Error(`pack id collision: '${id}' is registered as both a template and a macro`)
    }
    templates[id] = entry.source
  }

  const engine = new Liquid({ templates })
  registerFilters(engine)
  return engine
}

// Memoized per engine: a pack's sources are fixed once loaded, and the parse is
// not free.
const globalsByEngine = new WeakMap<Liquid, Map<string, ReadonlySet<string>>>()

/**
 * The context variables `templateId` actually reads, following `{% include %}`
 * into macros and excluding anything the template assigns itself.
 */
export function templateGlobals(engine: Liquid, templateId: string): ReadonlySet<string> {
  let perTemplate = globalsByEngine.get(engine)
  if (!perTemplate) {
    perTemplate = new Map()
    globalsByEngine.set(engine, perTemplate)
  }

  const cached = perTemplate.get(templateId)
  if (cached) return cached

  const globals = new Set(engine.globalVariablesSync(engine.parseFileSync(templateId)))
  perTemplate.set(templateId, globals)
  return globals
}

// Synchronous render. All M2 filters and in-memory includes are sync, so there
// is no async path to force a promise.
export function renderWith(
  engine: Liquid,
  templateId: string,
  context: Record<string, unknown>,
): string {
  return engine.renderFileSync(templateId, context) as string
}
