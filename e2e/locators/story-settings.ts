import type { Locator, Page } from '@playwright/test'

import type { StoryOverrideTarget } from '@/lib/ai'
import { embeddingTargetKey, type EmbeddingTarget } from '@/lib/db'

import { saveSession } from './save-session'
import { t } from '../harness/i18n'

// Story Settings + the embedder swap surfaces (components/story-settings/memory-panel.tsx,
// components/embedder/swap-dialog.tsx). Controls resolve through the app's own i18n keys
// (docs/testing.md → Selector strategy, Tier 2); the testIDs are Tier-3 exceptions, naming
// panel containers or rows whose only name repeats across siblings.
export const storySettings = {
  // Chrome gear on an in-story screen (e.g. the reader) — routes to
  // /story-settings/[storyId].
  openFromReader: (page: Page): Locator =>
    page.getByRole('button', { name: t('chrome.storySettings') }),

  memoryTab: (page: Page): Locator =>
    page.getByRole('tab', { name: t('storySettings:tabs.memory') }),

  memoryPanel: (page: Page): Locator => page.getByTestId('memory-panel'),

  // The knob groups HOST the embedder panel (`memoryPanel` above) as a slot between the
  // Classifier and Retrieval-budgets groups — the two are nested, not siblings.
  memoryKnobsPanel: (page: Page): Locator => page.getByTestId('memory-knobs-panel'),

  // A radio Select (memory-knob-sections.tsx): the row carries the press handler, not its label
  // Text, so this queries the radio. Its name is the label plus the mode hint and matches as a
  // substring — the sibling Boost row's hint carries no "Inject", which keeps this to one match.
  keywordInjectOption: (page: Page): Locator =>
    page.getByRole('radio', { name: t('storySettings:memory.knobs.keywordModeOption.inject') }),

  switchEmbedder: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:memory.switchEmbedder') }),

  // getByRole matches `name` as a substring, and the swap dialog's shorter
  // "Re-index this story" is a prefix of this copy — so this locator anchors on
  // the longer "…now" string, which the dialog's button name can't contain.
  reindexNow: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:memory.reindexNow') }),

  // The standalone re-index is gated by a confirm dialog; this is its start button.
  reindexConfirmStart: (page: Page): Locator => page.getByTestId('reindex-confirm-start'),

  // The swap dialog's own title — the observable half of an action that both
  // routes to the memory panel and opens the dialog on top of it.
  swapDialogTitle: (page: Page): Locator => page.getByText(t('storySettings:swap.title')),

  // SwapDialog's CandidateRow testID embeds the whole target, not the model id:
  // a model installed locally AND served by the provider is two rows, and a bare
  // id would match both and trip strict mode. getByTestId matches through
  // Playwright's own selector engine rather than a literal CSS string, so ids
  // containing "/" or ":" need no escaping.
  swapCandidate: (page: Page, target: EmbeddingTarget): Locator =>
    page.getByTestId(`swap-candidate-${embeddingTargetKey(target)}`),

  swapNext: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.next') }),

  // The options pane REPLACES the pick pane inside the same dialog, so `swapDialogTitle` above
  // is absent once a candidate is seated. It names the candidate — what tells a pre-seated
  // dialog from a merely open one.
  swapOptionsTitle: (page: Page, modelLabel: string): Locator =>
    page.getByText(t('storySettings:swap.optionsTitle', { model: modelLabel })),

  // Only the options-pane action the suite drives. Re-index, Keep and the resume
  // dialog's controls are deliberately absent: nothing reaches them yet, and a
  // locator for an uncovered control reads as coverage.
  swapRelabel: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.relabel') }),

  // The story-open resume prompt (components/embedder/swap-resume-host.tsx),
  // mounted app-wide off the open story rather than by any one route.
  resumePrompt: (page: Page): Locator => page.getByText(t('storySettings:swap.resumeTitle')),

  resumeLater: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.resumeLater') }),

  // The story-open upgrade prompt (components/embedder/embedding-upgrade-host.tsx),
  // mounted app-wide beside the resume prompt above.
  upgradePrompt: (page: Page): Locator => page.getByText(t('storySettings:upgrade.title')),

  // Tier 3: two of the three labels are verbatim the copy of the surfaces this prompt hands off
  // to — "Keep on the current model" is also the swap dialog's, "Later" the resume prompt's — so
  // a role+name query would stop resolving one element the moment either is in the tree.
  upgradeKeep: (page: Page): Locator => page.getByTestId('upgrade-keep'),
  upgradeLater: (page: Page): Locator => page.getByTestId('upgrade-later'),
  upgradeUpgrade: (page: Page): Locator => page.getByTestId('upgrade-upgrade'),

  generationTab: (page: Page): Locator =>
    page.getByRole('tab', { name: t('storySettings:tabs.generation') }),

  authoringAidsPanel: (page: Page): Locator => page.getByTestId('authoring-aids-panel'),

  suggestionsToggle: (page: Page): Locator =>
    page.getByRole('switch', { name: t('storySettings:generation.suggestions') }),

  // Tier 3: the label inputs repeat per row and share one placeholder as their
  // only accessible name, so a role query would match every row at once.
  categoryLabel: (page: Page, categoryId: string): Locator =>
    page.getByTestId(`suggestion-category-label-${categoryId}`),

  countIncrement: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:generation.countIncrement') }),

  modelsTab: (page: Page): Locator =>
    page.getByRole('tab', { name: t('storySettings:tabs.models') }),

  modelsPanel: (page: Page): Locator => page.getByTestId('models-panel'),

  // Scope anchor: the row View carries no role or name, and its picker trigger is named by the
  // shared `pickModel` placeholder every sibling row repeats. Typed, so a renamed target fails
  // the typecheck rather than resolving to an empty locator mid-run.
  modelRow: (page: Page, target: StoryOverrideTarget): Locator =>
    page.getByTestId(`model-row-${target}`),

  // Named by the placeholder only while the row is empty; once pinned the name becomes
  // t('modelPicker.selectedModel'). Nothing reopens a pinned row — clearing uses `clearOverride`.
  modelPickerTrigger: (row: Locator): Locator =>
    row.getByRole('button', { name: t('storySettings:models.pickModel') }),

  // Not getByRole('combobox'): the panel's own `Add override` Select trigger carries that role
  // too (rn-primitives), so a role query matches two elements. Page-scoped, not row-scoped,
  // because SearchableOverlayList portals the whole overlay out of the row.
  modelPickerSearch: (page: Page): Locator =>
    page.getByPlaceholder(t('modelPicker.searchPlaceholder')),

  // Page-scoped for the same reason as the search field. Each option renders the
  // model id as its own text, so no testID is needed to name one.
  modelPickerOption: (page: Page, modelId: string): Locator =>
    page.getByRole('option').filter({ hasText: modelId }),

  // The row's `×`. The label interpolates the target's display copy, which the
  // caller has to pass: narrative and the agents read it from different keys.
  clearOverride: (row: Locator, targetLabel: string): Locator =>
    row.getByRole('button', {
      name: t('storySettings:models.clearOverride', { target: targetLabel }),
    }),

  // Shared row-save-session chrome (save-session.ts).
  save: saveSession.saveBarSave,

  discard: saveSession.saveBarDiscard,

  // The menu's only route jump, and the one this surface routes through its
  // save-session guard. Gated on the diagnostics flag — seed it on first.
  diagnosticsHubRow: (page: Page): Locator =>
    page.getByText(t('settings:diagnosticsHub.actionLabel'), { exact: true }),

  // Shared row-save-session chrome (save-session.ts).
  unsavedDialog: saveSession.unsavedDialog,
  unsavedDiscard: saveSession.unsavedDiscard,
  unsavedSave: saveSession.unsavedSave,
  unsavedCancel: saveSession.unsavedCancel,

  aboutTab: (page: Page): Locator => page.getByRole('tab', { name: t('storySettings:tabs.about') }),

  aboutPanel: (page: Page): Locator => page.getByTestId('about-panel'),

  aboutTitle: (page: Page): Locator => page.getByTestId('about-title'),

  breadcrumb: (page: Page): Locator => page.getByTestId('story-settings-breadcrumb'),

  // Parent segments render with accessibilityRole="link", the current one as plain text — the
  // role is what separates the segment that leaves the surface from the one that is it.
  breadcrumbStory: (page: Page, title: string): Locator =>
    storySettings.breadcrumb(page).getByRole('link', { name: title }),

  // Wrap point of view is a segmented Select, so each option is a radio. Named,
  // not indexed: the two labels are the only thing distinguishing them.
  wrapPovOption: (page: Page, pov: 'first' | 'third'): Locator =>
    page.getByRole('radio', { name: t(`storySettings:generation.wrapPov.${pov}`) }),

  // Tier 3: its label ("Save anyway") starts with the save bar's own "Save", which `save` above
  // matches as an anchored regex — a role query for either resolves both while this dialog is
  // open, since the save bar stays in the tree behind it.
  confirmSaveAnyway: (page: Page): Locator => page.getByTestId('confirm-save-anyway'),
}
