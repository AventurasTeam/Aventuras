import { TEMPLATE_IDS } from './ids'
import type { TemplateId } from './ids'
import type { ContextGroup } from './types'

export type VariableDef = {
  name: string
  type: string
  category: string
  description: string
  required?: boolean
}

// Pinned M2 variable names per group. buildGenerationContext must emit these
// exact names — parity-tested in lib/pipeline/definitions/generation-context.test.ts.
// Entity fields follow the drizzle row shape (camelCase).
export const VARIABLES: Record<ContextGroup, VariableDef[]> = {
  generationContext: [
    {
      name: 'entries',
      type: 'Entry[]',
      category: 'Story',
      description:
        'Caller-scoped entry window (per-turn: the open partial chapter); system entries excluded. Window with `recent`.',
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
      name: 'calendarVocabulary',
      type: 'CalendarVocabulary | null',
      category: 'Story Config',
      description:
        'Vocabulary descriptor (base units, tier names/labels, era names) for the active calendar system.',
      required: false,
    },
    {
      name: 'userSettings',
      type: 'object',
      category: 'Story Config',
      description: 'Operational knobs exposed to templates (partialChapterBuffer).',
      required: false,
    },
    {
      name: 'intermediates',
      type: 'object',
      category: 'Generation Results',
      description: 'Per-run phase outputs (narrativeResult, etc.).',
      required: false,
    },
    {
      name: 'piggybackFires',
      type: 'boolean',
      category: 'Generation Results',
      description:
        'True when this turn expects the tagged trailing block to actually be used (piggybackMode on + resolved narrative model capability-flagged reliable). False means the per-turn fallback classifier will redo extraction from scratch, so state-emission instructions are omitted.',
      required: true,
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
      name: 'leadName',
      type: 'string',
      category: 'Entities',
      description:
        'Lead character display name; blank on lead-less paths (creative + third-person).',
      required: false,
    },
    {
      name: 'leadEntityId',
      type: 'string',
      category: 'Entities',
      description:
        'Lead cast id — a placeholder after id-substitution, so a model can echo it in sceneEntities; blank on lead-less paths.',
      required: false,
    },
    {
      name: 'opening',
      type: '{ content: string }',
      category: 'Generation Results',
      description: 'In-progress opening; title/description templates read opening.content.',
      required: false,
    },
    {
      name: 'guidance',
      type: 'string',
      category: 'Generation Results',
      description: 'Optional per-invocation user steer appended to the prompt.',
      required: false,
    },
  ],
  staticContent: [],
}

// Intersection keeps the string index (validateRegistry probes arbitrary ids)
// while requiring every TemplateId to be mapped — a missing one fails to compile.
export const TEMPLATE_GROUPS: Record<string, ContextGroup> & Record<TemplateId, ContextGroup> = {
  [TEMPLATE_IDS.perTurnNarrative]: 'generationContext',
  [TEMPLATE_IDS.piggybackFallbackClassifier]: 'generationContext',
  [TEMPLATE_IDS.wizardOpening]: 'wizard',
  [TEMPLATE_IDS.wizardTitleChips]: 'wizard',
  [TEMPLATE_IDS.wizardDescription]: 'wizard',
}

// UI-level grouping name -> variable names it surfaces. A name that matches
// no defined variable is "dangling" and reported by validateRegistry.
export const DISPLAY_GROUPS: Record<string, string[]> = {
  Story: ['entries'],
  Entities: ['entities', 'sceneEntities', 'leadName', 'leadEntityId'],
  'Story Config': ['definition', 'calendarVocabulary', 'userSettings'],
  'Generation Results': ['intermediates', 'opening', 'guidance', 'piggybackFires'],
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
