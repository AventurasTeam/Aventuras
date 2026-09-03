import { TEMPLATE_IDS } from './ids'
import type { TemplateId } from './ids'
import type { ContextGroup } from './types'

export type VariableDef = {
  name: string
  type: string
  /** Must name a DISPLAY_GROUPS key; untyped, so a test carries the tie. */
  category: string
  description: string
  required?: boolean
}

// Pinned variable names per group. buildGenerationContext must emit these
// exact names — parity-tested in lib/pipeline/definitions/generation-context.test.ts.
// Entity fields follow the drizzle row shape (camelCase).
export const VARIABLES: Record<ContextGroup, VariableDef[]> = {
  generationContext: [
    {
      name: 'entries',
      type: 'Entry[]',
      category: 'Story',
      description:
        'Prompt buffer, already composed to the two-mode window plus protectedBuffer spillover; system entries excluded. Each item carries `position` and `content`. Render it whole.',
      required: true,
    },
    {
      name: 'lastTurns',
      type: 'Entry[]',
      category: 'Story',
      description:
        'The last two non-system entries, bounded by the query so neither the buffer knobs nor a template can narrow them. Which kinds they are depends on when the phase asks. Overlaps `entries` — render one or the other, not both. For per-turn classification, not for narrating.',
      required: true,
    },
    {
      name: 'sceneMetadata',
      type: 'SceneMetadata',
      category: 'Entities',
      description:
        "Scene state from the most recent AI-authored entry: `sceneEntities`, `currentLocationId`, `worldTime`, `summary`. One entry's worth on purpose — a per-entry copy would put entities deleted long ago back into the prompt.",
      required: true,
    },
    {
      name: 'worldTimeDeltaBasis',
      type: "'sinceUserAction' | 'sinceLastAiReply'",
      category: 'Entities',
      description:
        "Which end `<world_time_delta>` is measured from. `sinceLastAiReply` when the tail user action inherited the AI entry's worldTime unchanged, so the delta must include the time the action itself took; `sinceUserAction` when the user advanced time on the action, so the delta measures from its end.",
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
      name: 'currentLocationId',
      type: 'string | null',
      category: 'Entities',
      description: 'Entity id of the current scene location; null when the scene has none.',
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
      type: 'CalendarVocabulary',
      category: 'Story Config',
      description:
        'Vocabulary descriptor (base units, tier names/labels, era names) for the active calendar system; falls back to earth-gregorian for an unresolved id, matching the reader.',
      required: true,
    },
    {
      name: 'userSettings',
      type: 'object',
      category: 'Story Config',
      description:
        'Buffer knobs the composed `entries` window was built from (fullChapterInBuffer, partialChapterBuffer, protectedBuffer) — informational, not a re-windowing instruction.',
      required: false,
    },
    {
      name: 'retrievedEntities',
      type: 'RetrievedRow[]',
      category: 'Retrieval',
      description:
        'Off-scene entities the ranker seated this turn, as { id, displayName, renderedText }. Empty when nothing scored or no retrieval ran.',
      required: true,
    },
    {
      name: 'retrievedLore',
      type: 'RetrievedRow[]',
      category: 'Retrieval',
      description:
        'Lore rows the ranker seated this turn; same row shape as retrievedEntities. Empty when nothing scored or no retrieval ran.',
      required: true,
    },
    {
      name: 'retrievedHappenings',
      type: 'RetrievedRow[]',
      category: 'Retrieval',
      description:
        'Happenings the ranker seated this turn; renderedText carries the awareness sources verbatim. Empty when nothing scored or no retrieval ran.',
      required: true,
    },
    {
      name: 'retrievedThreads',
      type: 'RetrievedRow[]',
      category: 'Retrieval',
      description:
        'Non-active threads the ranker seated this turn; active ones are structural (structuralActiveThreads). Empty when nothing scored or no retrieval ran.',
      required: true,
    },
    {
      name: 'retrievedChapters',
      type: 'RetrievedRow[]',
      category: 'Retrieval',
      description:
        'Closed-chapter summaries the ranker seated this turn. Empty when nothing scored or no retrieval ran.',
      required: true,
    },
    {
      name: 'structuralLocation',
      type: 'FloorEntity | null',
      category: 'Retrieval',
      description:
        'The ACTIVE entity for currentLocationId, shaped { id, kind, status, name, description }. Null both when the scene names no location and when it names one that is staged, retired, or absent from the branch — so guard the location block on this variable, never on currentLocationId. Null when no retrieval ran.',
      required: true,
    },
    {
      name: 'locationIds',
      type: 'string[]',
      category: 'Retrieval',
      description:
        'Every id above that belongs to a place — the legal <current_location> set. Union of the floor scene rows, structuralLocation, the pinned entities and the ranked entities, kind-filtered and de-duplicated, in the order those blocks render. Use this rather than "the IDs above": ranked entity rows arrive as RetrievedRow with no kind, so the bracketed IDs in the memory blocks can be entirely characters. Empty when the prompt shows no place, or no retrieval ran.',
      required: true,
    },
    {
      name: 'structuralActiveThreads',
      type: 'FloorThread[]',
      category: 'Retrieval',
      description:
        'Threads at status `active`, seated by the structural floor rather than ranked, as { id, status, title, description }. Empty when the branch has none, or no retrieval ran.',
      required: true,
    },
    {
      name: 'structuralPinnedEntities',
      type: 'FloorEntity[]',
      category: 'Retrieval',
      description:
        'Entities the user pinned with injection mode `always`, minus any already seated elsewhere in the floor. Empty when nothing is pinned, or no retrieval ran.',
      required: true,
    },
    {
      name: 'structuralPinnedLore',
      type: 'FloorLore[]',
      category: 'Retrieval',
      description:
        'Lore pinned with injection mode `always`, as { id, title, body } — `title` and `body`, not `name` and `description`. Empty when nothing is pinned, or no retrieval ran.',
      required: true,
    },
    {
      name: 'structuralPinnedThreads',
      type: 'FloorThread[]',
      category: 'Retrieval',
      description:
        'Threads pinned with injection mode `always`, beyond the active ones. Empty when nothing is pinned, or no retrieval ran.',
      required: true,
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
    {
      name: 'suggestionsFire',
      type: 'boolean',
      category: 'Generation Results',
      description:
        'True when this call should emit the <suggestions> block (suggestionsEnabled + at least one enabled category, and no suggestions already in hand). False omits the fragment entirely.',
      required: true,
    },
    {
      name: 'suggestionSlots',
      type: 'SuggestionSlot[]',
      category: 'Story Config',
      description:
        'Enabled suggestion categories as { ref, label, promptHint }, ref being the per-emission cat1..catN placeholder.',
      required: false,
    },
    {
      name: 'suggestionCount',
      type: 'number',
      category: 'Story Config',
      description: 'Chips to emit this turn (stories.settings.suggestionCount, 1-6).',
      required: false,
    },
    {
      name: 'refreshGuidance',
      type: 'string',
      category: 'Generation Results',
      description:
        'Composer text at the moment the reader hit ⟳, steering a suggestion-refresh re-roll. Blank on every other call and on an empty composer.',
      required: false,
    },
  ],
  classifierContext: [
    {
      name: 'turns',
      type: 'WindowTurn[]',
      category: 'Story',
      description:
        'Unclassified prose window, each turn carrying the provenance handle (t1..tN) the model must tag its facts with.',
      required: true,
    },
    {
      name: 'entities',
      type: 'Entity[]',
      category: 'Entities',
      description: 'Branch entities (id/kind/name/description/status) — the placeholder universe.',
      required: true,
    },
    {
      name: 'happenings',
      type: '{ id, title }[]',
      category: 'Plot',
      description: 'Existing happenings, so the model can reference rather than duplicate them.',
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
      name: 'leadEntityId',
      type: 'string',
      category: 'Entities',
      description:
        'Lead cast id — a placeholder after id-substitution, so a model can echo it in sceneEntities; blank on lead-less paths.',
      required: false,
    },
    {
      name: 'cast',
      type: 'WizardCastDraft[]',
      category: 'Entities',
      description:
        'Wizard-authored cast rows: id/kind/name/description/status shared by every row, plus per-kind fields — character: voice/traits/drives/visual.{physique,face,hair,eyes,attire,distinguishing}/factionId; location: parentLocationId/condition; item: condition; faction: agenda/standing. `tags` is projected out: it is a user-only search/filter axis, matching the runtime entity rows, which drop it for the same reason. factionId/parentLocationId are ids, not the faction_name/parent_location_name names the cast-suggestion prompt asks the model for — those names resolve to ids at import time. Ids are placeholders after substitution, so the opening can echo them in sceneEntities.',
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
    {
      name: 'current',
      type: 'GenreAssistValue | ToneAssistValue | SettingAssistValue | DescriptionAssistValue | OpeningAssistValue',
      category: 'Generation Results',
      description:
        'Refine templates only — the preview being revised. Each refine template reads the fields of its own shape (e.g. current.promptBody for genre, current.content for the opening).',
      required: false,
    },
    {
      name: 'instruction',
      type: 'string',
      category: 'Generation Results',
      description:
        "Refine templates only — the user's revision instruction for this pass. Distinct from `guidance`, which steers a generate.",
      required: false,
    },
    {
      name: 'lore',
      type: 'WizardLoreDraft[]',
      category: 'Retrieval',
      description:
        'Wizard-authored initial lore rows, uncapped — every row reaches the opening and lore templates. `tags` is projected out, same as on `cast`.',
      required: false,
    },
    {
      name: 'suggested',
      type: 'string[]',
      category: 'Retrieval',
      description:
        'Titles already on screen from earlier `Generate more` pages but not yet imported. Excluded alongside `lore` so a further page is additive rather than a re-roll of the same prompt.',
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
  [TEMPLATE_IDS.periodicClassifier]: 'classifierContext',
  [TEMPLATE_IDS.suggestionRefresh]: 'generationContext',
  [TEMPLATE_IDS.wizardOpening]: 'wizard',
  [TEMPLATE_IDS.wizardOpeningRefine]: 'wizard',
  [TEMPLATE_IDS.wizardTitleChips]: 'wizard',
  [TEMPLATE_IDS.wizardDescription]: 'wizard',
  [TEMPLATE_IDS.wizardDescriptionRefine]: 'wizard',
  [TEMPLATE_IDS.wizardLore]: 'wizard',
  [TEMPLATE_IDS.wizardCast]: 'wizard',
  [TEMPLATE_IDS.wizardGenre]: 'wizard',
  [TEMPLATE_IDS.wizardGenreRefine]: 'wizard',
  [TEMPLATE_IDS.wizardTone]: 'wizard',
  [TEMPLATE_IDS.wizardToneRefine]: 'wizard',
  [TEMPLATE_IDS.wizardSetting]: 'wizard',
  [TEMPLATE_IDS.wizardSettingRefine]: 'wizard',
}

// UI-level grouping name -> variable names it surfaces. A name that matches
// no defined variable is "dangling" and reported by validateRegistry.
export const DISPLAY_GROUPS: Record<string, string[]> = {
  Story: ['entries', 'lastTurns', 'turns'],
  Entities: [
    'entities',
    'sceneMetadata',
    'sceneEntities',
    'currentLocationId',
    'worldTimeDeltaBasis',
    'leadEntityId',
    'cast',
  ],
  Plot: ['happenings'],
  Retrieval: [
    'retrievedEntities',
    'retrievedLore',
    'retrievedHappenings',
    'retrievedThreads',
    'retrievedChapters',
    'structuralLocation',
    'locationIds',
    'structuralActiveThreads',
    'structuralPinnedEntities',
    'structuralPinnedLore',
    'structuralPinnedThreads',
    'lore',
    'suggested',
  ],
  'Story Config': [
    'definition',
    'calendarVocabulary',
    'userSettings',
    'suggestionSlots',
    'suggestionCount',
  ],
  'Generation Results': [
    'intermediates',
    'opening',
    'guidance',
    'current',
    'instruction',
    'piggybackFires',
    'suggestionsFire',
    'refreshGuidance',
  ],
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
