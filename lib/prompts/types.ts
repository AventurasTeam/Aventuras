// Context groups drive include-compatibility (a template in group G may include
// only G-tagged or `staticContent` macros) and editor variable awareness.
// M2 ships generationContext + wizard + staticContent; others land with their features.
export const CONTEXT_GROUPS = ['generationContext', 'wizard', 'staticContent'] as const
export type ContextGroup = (typeof CONTEXT_GROUPS)[number]

export type PackEntry = {
  group: ContextGroup
  source: string
}

export type Pack = {
  templates: Record<string, PackEntry>
  macros: Record<string, PackEntry>
}

export type IncludeViolation = {
  templateId: string
  macroId: string
  reason: 'missing-macro' | 'group-mismatch'
  templateGroup: ContextGroup
  macroGroup?: ContextGroup
}
