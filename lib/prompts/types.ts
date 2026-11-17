import type { PromptSectionId } from '@/lib/db'

// Context groups drive include-compatibility (a template in group G may include
// only G-tagged or `staticContent` macros) and editor variable awareness.
export const CONTEXT_GROUPS = [
  'generationContext',
  'classifierContext',
  'wizard',
  'chapter',
  'staticContent',
] as const
export type ContextGroup = (typeof CONTEXT_GROUPS)[number]

/**
 * A template's two Liquid sources: a stable system half and a per-call user half
 * (architecture.md → System and user halves).
 */
export type TemplateSources = { readonly system: string; readonly user: string }

export type TemplateEntry = TemplateSources & { readonly group: ContextGroup }

export type MacroEntry = {
  readonly group: ContextGroup
  readonly source: string
}

export type Pack = {
  templates: Readonly<Record<string, TemplateEntry>>
  macros: Readonly<Record<string, MacroEntry>>
}

/** Both halves as rendered, untrimmed. `system` may be blank; `user` never is. */
export type RenderedPrompt = { readonly system: string; readonly user: string }

/**
 * One half split by section (architecture.md → Prompt sections): each named section's own text, the
 * innermost section owning nested text, and `unnamed`, the text no known section holds. Their lengths
 * add up to the half's.
 */
export type HalfSections = {
  readonly named: readonly { readonly id: PromptSectionId; readonly text: string }[]
  readonly unnamed: readonly string[]
}

export type SectionedPrompt = RenderedPrompt & {
  readonly sections: { readonly system: HalfSections; readonly user: HalfSections }
}

export type IncludeViolation = {
  templateId: string
  macroId: string
  reason: 'missing-macro' | 'group-mismatch'
  templateGroup: ContextGroup
  macroGroup?: ContextGroup
}
