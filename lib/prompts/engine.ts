import { Liquid } from 'liquidjs'

import { registerFilters } from './filters'
import type { MacroId } from './ids'
import { SECTIONS, SectionCollector, SectionTag } from './sections'
import type { Pack, RenderedPrompt, SectionedPrompt } from './types'

export type TemplateHalf = 'system' | 'user'

const HALVES: readonly TemplateHalf[] = ['system', 'user']

// Halves and macros share the engine's one template map, so a macro id equal to a half key
// would overwrite that half; createEngine rejects it.
function halfKey(templateId: string, half: TemplateHalf): string {
  return `${templateId}#${half}`
}

// In-memory `templates` (halves and macros) so `{% include 'id' %}` resolves from the pack.
export function createEngine(pack: Pack): Liquid {
  const templates: Record<string, string> = {}
  for (const [id, entry] of Object.entries(pack.templates)) {
    for (const half of HALVES) templates[halfKey(id, half)] = entry[half]
  }
  for (const [id, entry] of Object.entries(pack.macros)) {
    // Templates and macros share one id namespace; an id naming both would leave an include
    // ambiguous to its author, so fail loud. The map check also covers half keys (see halfKey).
    if (Object.hasOwn(pack.templates, id) || Object.hasOwn(templates, id)) {
      throw new Error(`pack id collision: '${id}' is already registered as a template or half`)
    }
    templates[id] = entry.source
  }

  // Safe to cache: `templates` is this engine's own copy, fixed once built.
  const engine = new Liquid({ templates, cache: true })
  registerFilters(engine)
  engine.registerTag('section', SectionTag)
  return engine
}

// Memoized per engine: a pack's sources are fixed once loaded, and the parse is not free.
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

/** The context variables a macro reads, following its includes: a macro checked on its own. */
export function macroGlobals(engine: Liquid, macroId: MacroId): Set<string> {
  return new Set(engine.globalVariablesSync(engine.parseFileSync(macroId)))
}

/**
 * Renders both halves against one context, synchronously: every filter and
 * in-memory include is sync. Throws when the user half renders blank, since
 * there would be nothing for the model to answer; a blank system half is legal.
 * With `sections`, each half also comes back split by its section tags.
 */
export function renderWith(
  engine: Liquid,
  templateId: string,
  context: Record<string, unknown>,
): RenderedPrompt
export function renderWith(
  engine: Liquid,
  templateId: string,
  context: Record<string, unknown>,
  opts: { sections: true },
): SectionedPrompt
export function renderWith(
  engine: Liquid,
  templateId: string,
  context: Record<string, unknown>,
  opts?: { sections: true },
): RenderedPrompt | SectionedPrompt {
  const render = (half: TemplateHalf, collector?: SectionCollector): string =>
    engine.renderFileSync(
      halfKey(templateId, half),
      context,
      collector === undefined ? undefined : { globals: { [SECTIONS]: collector } },
    ) as string
  if (opts?.sections !== true) {
    const system = render('system')
    const user = render('user')
    if (user.trim() === '') throw new Error(`template '${templateId}' rendered a blank user half`)
    return { system, user }
  }
  const systemSections = new SectionCollector()
  const userSections = new SectionCollector()
  const system = render('system', systemSections)
  const user = render('user', userSections)
  if (user.trim() === '') throw new Error(`template '${templateId}' rendered a blank user half`)
  return {
    system,
    user,
    sections: { system: systemSections.finish(system), user: userSections.finish(user) },
  }
}
