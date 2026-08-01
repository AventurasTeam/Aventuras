/**
 * Advanced Settings — derived view
 *
 * Which controls in the Advanced panel currently do anything, what the collapsed section
 * headers say, and how the wording of a few help lines changes with configuration.
 *
 * Separate from the component because these are rules, not markup, and because the panel
 * is where a setting silently ceasing to have an effect is least likely to be noticed. Two
 * of them had already gone wrong that way -- a slider capped by a hardcoded slice, and an
 * amber banner still describing a fallback that no longer existed -- and neither was
 * detectable without reading the services. Kept pure so they can be tested without a DOM,
 * which this project has no test setup for.
 *
 * A control that has no effect is reported with a *reason*, not hidden. In a panel this
 * dense a control that vanishes reads as a bug, and its stored value is still worth seeing.
 */

export type MemoryMode = 'static' | 'agentic'

/** The slices of `settings.systemServicesSettings` this view reads. */
export interface AdvancedPanelSettings {
  timelineFill?: { enabled?: boolean; mode?: MemoryMode } | null
  agenticRetrieval?: { grepEnabled?: boolean } | null
  entryRetrieval?: { enableLLMSelection?: boolean } | null
  worldStateInjection?: { enableLLMSelection?: boolean } | null
  styleReviewer?: { enabled?: boolean } | null
}

export interface SectionBadge {
  text: string
  /** Rendered in the muted style: the section is off or reduced. */
  muted: boolean
}

export interface AdvancedPanelView {
  memoryOn: boolean
  memoryMode: MemoryMode
  grepOn: boolean
  entryLLMOn: boolean
  worldStateLLMOn: boolean
  styleReviewerOn: boolean

  badges: {
    memory: SectionBadge
    entryRetrieval: SectionBadge
    worldState: SectionBadge
    /** Absent while on: a badge on every section would stop meaning anything. */
    styleReviewer?: SectionBadge
  }

  /** `undefined` means the control is live. Anything else is shown to the user verbatim. */
  inactive: {
    /** Entry Retrieval's Tier 3 cap. That tier exists only when the LLM selects. */
    maxTier3Entries?: string
    /**
     * World State Injection's threshold. Always live -- see `advancedPanelView` for why
     * switching LLM selection off makes it matter *more*, not less.
     */
    llmThreshold?: string
    /** World State Injection's Tier 3 cap, which applies only to the LLM-chosen branch. */
    worldStateMaxTier3?: string
  }

  help: {
    entryRecentEntries: string
    worldStateRecentEntries: string
  }
}

/**
 * `recentEntriesCount` feeds Tier 2 matching *and* the Tier 3 prompt, so it stays live
 * when LLM selection is off -- only half of what it does stops. Saying so beats both
 * alternatives: leaving the fuller description up (it would describe a prompt that is not
 * built) and dimming the control (it still matters).
 */
function recentEntriesHelp(llmOn: boolean, tier2: string): string {
  return llmOn
    ? `Recent story entries scanned for ${tier2}, and included in the Tier 3 selection prompt`
    : `Recent story entries scanned for ${tier2}`
}

export function advancedPanelView(settings: AdvancedPanelSettings): AdvancedPanelView {
  const memoryOn = settings.timelineFill?.enabled ?? true
  const memoryMode = settings.timelineFill?.mode ?? 'static'
  const entryLLMOn = settings.entryRetrieval?.enableLLMSelection ?? true
  const worldStateLLMOn = settings.worldStateInjection?.enableLLMSelection ?? true
  const styleReviewerOn = settings.styleReviewer?.enabled ?? true

  return {
    memoryOn,
    memoryMode,
    // Only meaningful in agentic mode; the panel does not offer it otherwise.
    grepOn:
      (settings.agenticRetrieval?.grepEnabled ?? false) && memoryOn && memoryMode === 'agentic',
    entryLLMOn,
    worldStateLLMOn,
    styleReviewerOn,

    badges: {
      memory: memoryOn
        ? { text: memoryMode === 'agentic' ? 'Agentic' : 'Static', muted: false }
        : { text: 'Off', muted: true },
      entryRetrieval: entryLLMOn
        ? { text: 'LLM on', muted: false }
        : { text: 'Keywords only', muted: true },
      worldState: worldStateLLMOn
        ? { text: 'LLM on', muted: false }
        : { text: 'Names only', muted: true },
      styleReviewer: styleReviewerOn ? undefined : { text: 'Off', muted: true },
    },

    inactive: {
      maxTier3Entries: entryLLMOn ? undefined : 'LLM Selection is off, so there is no Tier 3',
      // `llmThreshold` is NOT reported inactive when LLM selection is off, and this is the
      // second control in this panel to have claimed it was. It is the boundary between
      // "include the whole leftover" and "ask the model which of it matters", and only the
      // second branch needs the model -- so with selection off it is the *only* thing
      // deciding how much world state reaches the narrator, not a dead control.
      llmThreshold: undefined,
      // Its companion cap, on the other hand, only applies in the branch that asks.
      worldStateMaxTier3: worldStateLLMOn
        ? undefined
        : 'LLM Selection is off; the leftover is included whole or not at all',
    },

    help: {
      entryRecentEntries: recentEntriesHelp(entryLLMOn, 'Tier 2 name/keyword matching'),
      worldStateRecentEntries: recentEntriesHelp(worldStateLLMOn, 'Tier 2 name matching'),
    },
  }
}
