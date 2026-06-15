import { TEMPLATE_IDS } from './ids'
import type { ContextGroup } from './types'

export type VariableDef = {
  name: string
  type: string
  category: string
  description: string
  required?: boolean
}

// Pinned M2 variable names per group. Slice 2.7's per-turn context builder
// must use these exact names (a name mismatch only fails at integration).
// Entity fields follow the drizzle row shape (camelCase).
export const VARIABLES: Record<ContextGroup, VariableDef[]> = {
  generationContext: [
    {
      name: 'entries',
      type: 'Entry[]',
      category: 'Story',
      description: 'Recent entry buffer (verbatim).',
      required: true,
    },
    {
      name: 'entities',
      type: 'Entity[]',
      category: 'Entities',
      description: 'Branch entities (id/kind/name/description/status/injectionMode).',
      required: true,
    },
    {
      name: 'sceneEntities',
      type: 'string[]',
      category: 'Entities',
      description: 'Entity ids present in the current scene.',
      required: true,
    },
    {
      name: 'definition',
      type: 'StoryDefinition',
      category: 'Story Config',
      description: 'mode/narration/genre/tone/setting; genre/tone are { label, promptBody }.',
      required: true,
    },
    {
      name: 'userSettings',
      type: 'object',
      category: 'Story Config',
      description: 'Operational knobs subset exposed to templates.',
      required: false,
    },
    {
      name: 'intermediates',
      type: 'object',
      category: 'Generation Results',
      description: 'Per-run phase outputs (narrativeResult, etc.).',
      required: false,
    },
  ],
  wizard: [
    {
      name: 'definition',
      type: 'StoryDefinition',
      category: 'Story Config',
      description: 'In-progress story definition.',
      required: true,
    },
    {
      name: 'lead',
      type: '{ name: string }',
      category: 'Entities',
      description: 'Minimal lead character.',
      required: true,
    },
    {
      name: 'opening',
      type: 'string',
      category: 'Generation Results',
      description: 'Generated opening passage (title/description templates).',
      required: false,
    },
  ],
  staticContent: [],
}

export const TEMPLATE_GROUPS: Record<string, ContextGroup> = {
  [TEMPLATE_IDS.perTurnNarrative]: 'generationContext',
  [TEMPLATE_IDS.wizardOpening]: 'wizard',
  [TEMPLATE_IDS.wizardTitleChips]: 'wizard',
  [TEMPLATE_IDS.wizardDescription]: 'wizard',
}

// UI-level grouping name -> variable names it surfaces. A name that matches
// no defined variable is "dangling" and reported by validateRegistry.
export const DISPLAY_GROUPS: Record<string, string[]> = {
  Story: ['entries'],
  Entities: ['entities', 'sceneEntities', 'lead'],
  'Story Config': ['definition', 'userSettings'],
  'Generation Results': ['intermediates', 'opening'],
}

export type RegistryIssue =
  | { kind: 'unmapped-template'; id: string }
  | { kind: 'dangling-display-variable'; displayGroup: string; name: string }

export function validateRegistry(
  templateIds: readonly string[],
  displayGroups: Record<string, string[]> = DISPLAY_GROUPS,
): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  for (const id of templateIds) {
    if (!TEMPLATE_GROUPS[id]) issues.push({ kind: 'unmapped-template', id })
  }
  const defined = new Set(
    Object.values(VARIABLES)
      .flat()
      .map((v) => v.name),
  )
  for (const [displayGroup, names] of Object.entries(displayGroups)) {
    for (const name of names) {
      if (!defined.has(name)) issues.push({ kind: 'dangling-display-variable', displayGroup, name })
    }
  }
  return issues
}
