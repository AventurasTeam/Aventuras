import { TEMPLATE_IDS } from './ids'
import type { TemplateId } from './ids'
import type { ContextGroup } from './types'

/** One nested field of a variable's items, a dotted path for a nested one. */
export type InfoField = { name: string; type: string; description: string }

export type VariableDef = {
  name: string
  type: string
  /** Must name a DISPLAY_GROUPS key; untyped, so a test carries the tie. */
  category: string
  description: string
  /** The nested structure, for the editor's hover docs and autocomplete. */
  infoFields?: readonly InfoField[]
  required?: boolean
}

// architecture.md → Entity state on the template surface. Shared by every variable whose rows
// carry an entity's `state`, so the view is documented once.
const ENTITY_STATE_INFO: readonly InfoField[] = [
  {
    name: 'state',
    type: 'EntityStateView',
    description:
      "The entity's state as a view built per kind, never the stored column. A reference is { id, name, status }; a disabled target is left out (null, or absent from a list) unless the scene seats it, and a place counts as disabled by the rule that leaves it out of locationMap.",
  },
  {
    name: 'state.visual',
    type: '{ physique, face, hair, eyes, attire, distinguishing }',
    description: 'Character. Each category a string or null, named as a visual change names it.',
  },
  { name: 'state.traits', type: 'string[]', description: 'Character.' },
  { name: 'state.drives', type: 'string[]', description: 'Character.' },
  { name: 'state.voice', type: 'string | null', description: 'Character.' },
  { name: 'state.faction', type: 'EntityRef | null', description: 'Character: its faction.' },
  {
    name: 'state.location',
    type: 'EntityRef | null',
    description:
      'Character: in scene the current location, out of it the last place it was seen. Item: the place it lies at.',
  },
  {
    name: 'state.holdings',
    type: '{ id, name, status, description, condition, equipped }[]',
    description:
      'Character: what it holds, inventory then equipped, an item in both once as equipped. Retired items are left out.',
  },
  {
    name: 'state.stackables',
    type: '{ key, amount }[]',
    description:
      'Character: currencies, ammunition and supplies by key, largest amount first, ties by key. Keys are trimmed and lowercased, amounts under one key summed, and a blank key or an amount of zero or less left out.',
  },
  { name: 'state.condition', type: 'string | null', description: 'Location, item.' },
  {
    name: 'state.parent',
    type: 'EntityRef | null',
    description: 'Location: the place it is part of.',
  },
  {
    name: 'state.holder',
    type: '{ id, name, status, equipped } | null',
    description: 'Item: the character holding it.',
  },
  { name: 'state.standing', type: 'string | null', description: 'Faction.' },
  { name: 'state.agenda', type: 'string[]', description: 'Faction.' },
  {
    name: 'state.members',
    type: 'EntityRef[]',
    description: 'Faction: its members by name, retired ones kept and marked by status.',
  },
]

const field = (name: string, type: string, description: string): InfoField => ({
  name,
  type,
  description,
})

const ENTITY_FIELDS_INFO: readonly InfoField[] = [
  field('id', 'string', 'Placeholder id (c1, l1, i1, f1).'),
  field('kind', "'character' | 'location' | 'item' | 'faction'", 'Picks the shape of `state`.'),
  field('name', 'string', 'The display name.'),
  field('description', 'string | null', 'Free prose; null when none.'),
  field(
    'status',
    "'active' | 'staged' | 'retired'",
    'Lifecycle: staged rows are not yet in the story, retired ones gone from it.',
  ),
  field('injectionMode', "'always' | 'auto' | 'disabled'", 'Whether retrieval may inject the row.'),
  ...ENTITY_STATE_INFO,
]

const FLOOR_ENTITY_INFO: readonly InfoField[] = ENTITY_FIELDS_INFO.filter(
  (f) => f.name !== 'injectionMode',
)

// Pinned variable names per group. buildGenerationContext must emit these
// exact names — parity-tested in lib/pipeline/definitions/generation-context.test.ts.
// Entity fields follow the drizzle row shape (camelCase), except `state`: a per-kind view, not
// the stored column.
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
        'The trailing non-system entries the per-turn classifier reads, `classifierContextEntries` many, floored at the action-plus-reply pair so neither the buffer knobs nor a template can cut below it. Which kinds they are depends on when the phase asks. Overlaps `entries` — render one or the other, not both. For per-turn classification, not for narrating.',
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
      description:
        'Branch entities (id/kind/name/description/status/injectionMode/state), whatever their status or mode. `state` is the per-kind view.',
      infoFields: ENTITY_FIELDS_INFO,
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
      name: 'locationMap',
      type: 'LocationMapRow[]',
      category: 'Entities',
      description:
        "Every place on the branch as { retired, id, name, depth, retiredReason }, in pre-order: a child follows its parent at depth + 1, siblings sorted by name. An active or staged place carries its id. A retired place has retired true, id null and its retiredReason (null when blank): render it by name and reason, since it can't be entered or nested under. A place that is effectively disabled, by its own injection mode or an ancestor's, is left out unless it is structuralLocation (currentLocationId when that is null); while the scene is inside a disabled ancestor, that ancestor stays left out but its disabling doesn't reach the places under it. A left-out place's listed children hang under its nearest listed ancestor. Built from the whole branch, never filtered through retrieval or Layer-A suppression. Empty when the branch has no listed place.",
      required: true,
    },
    {
      name: 'currentLocationChain',
      type: 'string[]',
      category: 'Entities',
      description:
        "Names of structuralLocation's listed ancestors (the locationMap places it is part of, retired ones included), nearest first, for a line like `The Rusty Anchor — in Port Vellis › Eldra`. Empty when no ancestor is listed (a top-level place, or one whose ancestors are all left out of locationMap), and when structuralLocation is null.",
      required: true,
    },
    {
      name: 'heldItems',
      type: '{ holderId: string; items: HeldItemLine[] }[]',
      category: 'Entities',
      description:
        "What each active in-scene character holds: one entry per holder that holds anything, in scene order, `items` as { id, name, equipped } with the inventory before the equipped items: the holder's `state.holdings`, shortened. An id in both inventory and equipped shows once, as equipped. Retired items, and disabled ones the scene doesn't seat, are left out. Match holderId against the in-scene entity ids. The bundled templates read `state.holdings` instead, and skip a held item in the scene list through its `state.holder`.",
      required: true,
    },
    {
      name: 'looseItems',
      type: 'Entity[]',
      category: 'Entities',
      description:
        "Items lying at structuralLocation (their at_location_id), shaped like `entities`, sorted by name; retired items, and disabled ones the scene doesn't seat, left out. Empty when structuralLocation is null.",
      infoFields: ENTITY_FIELDS_INFO,
      required: true,
    },
    {
      name: 'namedCharacters',
      type: 'Entity[]',
      category: 'Entities',
      description:
        'Active and staged characters, not disabled, whose name or a keyword appears in the last two non-system entries, leaving out the ones another section shows with state (active and in scene, pinned, ranked); shaped like `entities`, by name. A character this turn names can be written to by id, so this shows the values a write would replace. Empty unless the template reads it.',
      infoFields: ENTITY_FIELDS_INFO,
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
      type: 'RetrievedEntityRow[]',
      category: 'Retrieval',
      description:
        "Off-scene entities the ranker seated this turn, as { id, displayName, renderedText, kind, name, description, status, state }, `state` being the view the ranker measured the row with: render from these. `renderedText` is the string the type budget was charged for, the bundled row with a stand-in id (i00) on held items, so it isn't for rendering. Empty when nothing scored or no retrieval ran.",
      infoFields: [
        field('displayName', 'string', 'The name, as the probe shows it.'),
        field('renderedText', 'string', 'The measured string; not for rendering.'),
        ...FLOOR_ENTITY_INFO,
      ],
      required: true,
    },
    {
      name: 'retrievedLore',
      type: 'RetrievedRow[]',
      category: 'Retrieval',
      description:
        'Lore rows the ranker seated this turn, as { id, displayName, renderedText }: `displayName` is the title, and `renderedText` the title, then the body on its own line when there is one: the string the type budget was charged for, and the one to render. Empty when nothing scored or no retrieval ran.',
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
      infoFields: FLOOR_ENTITY_INFO,
      category: 'Retrieval',
      description:
        'The ACTIVE entity for currentLocationId, shaped { id, kind, status, name, description, state }. Null both when the scene names no location and when it names one that is staged, retired, or absent from the branch — so guard the location block on this variable, never on currentLocationId. Null when no retrieval ran.',
      required: true,
    },
    {
      name: 'locationIds',
      type: 'string[]',
      category: 'Retrieval',
      description:
        "The ids of the places retrieval puts in the prompt: the floor scene rows, structuralLocation, the pinned entities and the ranked entities, kind-filtered and de-duplicated, in the order those blocks render. Use it to tell which bracketed IDs in those blocks are places without testing each row's `kind`. Not the set to offer for <current_location>: a move may name any listed place on the branch that isn't retired, so offer locationMap's ids for that. Empty when retrieval shows no place, or no retrieval ran.",
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
        'Entities the user pinned with injection mode `always`, minus any already seated elsewhere in the floor, as { id, kind, status, name, description, state }. Empty when nothing is pinned, or no retrieval ran.',
      infoFields: FLOOR_ENTITY_INFO,
      required: true,
    },
    {
      name: 'structuralSceneFactions',
      type: 'FloorEntity[]',
      category: 'Retrieval',
      description:
        'The factions of the active in-scene characters, seated by the structural floor unless retired or disabled; shaped like structuralPinnedEntities, and rendered with them. A faction is never in a scene, but its agenda shapes how its members act in one. Empty when no in-scene character has one, or no retrieval ran.',
      infoFields: FLOOR_ENTITY_INFO,
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
      type: '{ handle, content, scene, location }[]',
      category: 'Story',
      description:
        'Unclassified prose window. Each turn carries the provenance handle (t1..tN) the model must tag its facts with, its prose (`content`), and the scene saved on its entry: `scene` (entity ids) and `location` (an entity id or null). Ids the branch no longer has are left out.',
      required: true,
    },
    {
      name: 'entities',
      type: 'Entity[]',
      category: 'Entities',
      description:
        "Branch entities other than places (id/kind/name/description/status/keywords), any status, each on one line. A character's `faction` is its faction's id when that names a listed faction, else null.",
      required: true,
    },
    {
      name: 'places',
      type: '{ id, name, depth, status, retiredReason, description, keywords }[]',
      category: 'Entities',
      description:
        "Every place on the branch, whatever its status or injection mode, in tree order: each nested under its parent (`depth` levels deep), children by name. `retiredReason` is set only on a retired place. Unlike the narrator's `locationMap` it hides nothing.",
      required: true,
    },
    {
      name: 'mentionedPlaces',
      type: 'boolean',
      category: 'Story Config',
      description:
        'stories.settings.classifierMentionedPlaces, read once per pass: true when the reply may create the places the turns mention but the scene does not enter (newPlaces).',
      required: true,
    },
    {
      name: 'happenings',
      type: '{ id, title }[]',
      category: 'Plot',
      description: 'Existing happenings, so the model can reference rather than duplicate them.',
      required: false,
    },
    {
      name: 'relationships',
      type: '{ subject, subjectName, object, objectName, kind }[]',
      category: 'Entities',
      description:
        "Stored character-to-character views, one per perspective: the subject's view of the object, with both names inlined so the model doesn't have to cross-reference the entity list. The author's edits live here too.",
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
    'locationMap',
    'places',
    'currentLocationChain',
    'heldItems',
    'looseItems',
    'namedCharacters',
    'worldTimeDeltaBasis',
    'leadEntityId',
    'cast',
    'relationships',
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
    'structuralSceneFactions',
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
    'mentionedPlaces',
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
