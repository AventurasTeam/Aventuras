// Context groups drive include-compatibility (a template in group G may include
// only G-tagged or `staticContent` macros) and editor variable awareness.
// M2 ships generationContext + wizard + staticContent; others land with their features.
export const CONTEXT_GROUPS = [
  'generationContext',
  'classifierContext',
  'wizard',
  'staticContent',
] as const
export type ContextGroup = (typeof CONTEXT_GROUPS)[number]

/** A template's two Liquid sources; a call sends them as a system then a user message. */
export type TemplateSources = { system: string; user: string }

export type TemplateEntry = TemplateSources & { group: ContextGroup }

export type MacroEntry = {
  group: ContextGroup
  source: string
}

export type Pack = {
  templates: Record<string, TemplateEntry>
  macros: Record<string, MacroEntry>
}

/** Both halves as rendered, untrimmed. `system` may be blank; `user` never is. */
export type RenderedPrompt = { system: string; user: string }

export type IncludeViolation = {
  templateId: string
  macroId: string
  reason: 'missing-macro' | 'group-mismatch'
  templateGroup: ContextGroup
  macroGroup?: ContextGroup
}
