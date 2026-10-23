import { bundledPack } from './bundled'
import { renderWith, templateGlobals } from './engine'
import type { TemplateId } from './ids'
import { loadPack, type LoadedPack } from './load-pack'
import type { RenderedPrompt } from './types'

export { BUNDLED_PACK_ID, TEMPLATE_IDS, MACRO_IDS } from './ids'
export type { TemplateId, MacroId } from './ids'
export { CONTEXT_GROUPS } from './types'
export type {
  ContextGroup,
  Pack,
  TemplateEntry,
  MacroEntry,
  TemplateSources,
  RenderedPrompt,
  IncludeViolation,
} from './types'
export { loadPack, PackLoadError, type LoadedPack } from './load-pack'
export { validatePackIncludes } from './validate-includes'
export { bundledPack } from './bundled'

// Lazy singleton: built on first render (and by the load test), so importing
// id constants from this barrel does not construct an engine.
let loaded: LoadedPack | null = null
function bundled(): LoadedPack {
  return (loaded ??= loadPack(bundledPack))
}

export function renderTemplate(
  templateId: TemplateId,
  context: Record<string, unknown>,
): RenderedPrompt {
  return renderWith(bundled().engine, templateId, context)
}

/**
 * The context variables `templateId` reads, over both halves. Lets a context builder skip
 * work behind a variable the template never mentions, without narrowing what the group offers.
 */
export function templateReads(templateId: TemplateId): ReadonlySet<string> {
  return templateGlobals(bundled().engine, templateId)
}

export { VARIABLES, TEMPLATE_GROUPS, DISPLAY_GROUPS, validateRegistry } from './templateContextMap'
export type { VariableDef, RegistryIssue } from './templateContextMap'
