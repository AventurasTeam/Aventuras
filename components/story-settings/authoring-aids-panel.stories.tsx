import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { type StorySettingsSessionPatch } from '@/lib/actions'
import {
  STORY_SETTINGS_DEFAULTS,
  type StoryDefinition,
  type StorySettings,
  type SuggestionCategory,
} from '@/lib/db'
import { t } from '@/lib/i18n'
import { appSettingsStore, generationStore, isUserEditBlocked } from '@/lib/stores'

import { AuthoringAidsPanel } from './authoring-aids-panel'
import { StorySettingsSaveSessionProvider } from './save-session'
import { StorySettingsDialogs, StorySettingsSaveBar } from './save-session-chrome'

const CATEGORIES: SuggestionCategory[] = [
  {
    id: 'cat-combat',
    label: 'Combat',
    promptHint: 'A decisive strike, block, or retreat.',
    color: 'red',
    enabled: true,
    order: 0,
  },
  {
    id: 'cat-banter',
    label: 'Banter',
    promptHint: 'A barbed line aimed at whoever is closest.',
    color: 'blue',
    enabled: true,
    order: 1,
  },
  {
    id: 'cat-scan',
    label: 'Scan',
    promptHint: '',
    color: 'teal',
    enabled: false,
    order: 2,
  },
]

function settings(overrides: Partial<StorySettings> = {}): StorySettings {
  return { ...STORY_SETTINGS_DEFAULTS, suggestionCategories: CATEGORIES, ...overrides }
}

const DEFINITION: StoryDefinition = {
  mode: 'adventure',
  leadEntityId: 'ent-lead',
  narration: 'third',
  genre: { label: 'Noir', promptBody: 'Rain, debt, and bad options.' },
  tone: { label: 'Bleak', promptBody: 'Nobody gets a clean win.' },
  setting: 'A harbour city that never dried out.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 1948 },
}

type HarnessProps = {
  settings: StorySettings
  definition: StoryDefinition | null
  onCommit: (patch: StorySettingsSessionPatch) => Promise<unknown>
  /** Stands in for the route's `storyHasTurns` read. */
  confirmFlagged?: boolean
}

function Harness({ settings: storySettings, definition, onCommit, confirmFlagged }: HarnessProps) {
  const blocked = generationStore.useGeneration((s) => isUserEditBlocked(s.txState))
  const disabledReason = blocked ? t('generationGate.inFlight') : undefined
  return (
    <View className="gap-4 rounded-md bg-bg-base p-4" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider
        onCommit={onCommit}
        confirmFlagged={confirmFlagged ?? false}
      >
        <AuthoringAidsPanel
          settings={storySettings}
          definition={definition}
          disabled={blocked}
          disabledReason={disabledReason}
        />
        <StorySettingsSaveBar enabled blocked={blocked} disabledReason={disabledReason} />
        <StorySettingsDialogs blocked={blocked} disabledReason={disabledReason} />
      </StorySettingsSaveSessionProvider>
    </View>
  )
}

const COPY = {
  suggestions: t('storySettings:generation.suggestions'),
  increment: t('storySettings:generation.countIncrement'),
  decrement: t('storySettings:generation.countDecrement'),
  menu: t('storySettings:generation.menu'),
  reset: t('storySettings:generation.reset'),
  resetUnavailable: t('storySettings:generation.resetUnavailable.missing'),
  resetUnrecognized: t('storySettings:generation.resetUnavailable.unrecognized'),
  cancel: t('cancel'),
  discard: t('saveBar.discard'),
  addCategory: t('suggestionCategories.addAria'),
  duplicateLabel: t('suggestionCategories.labelDuplicate'),
  duplicateReason: t('storySettings:generation.invalid.duplicate-label'),
  duplicateReasonOnTab: t('storySettings:save.invalidOnTab', {
    tab: t('storySettings:tabs.generation'),
    reason: t('storySettings:generation.invalid.duplicate-label'),
  }),
  fieldSuggestions: t('storySettings:generation.field.suggestions'),
  fieldCount: t('storySettings:generation.field.suggestionCount'),
  fieldCategories: t('storySettings:generation.field.suggestionCategories'),
  pickCustomColor: t('colorPicker.pickCustomColor'),
  hexColor: t('colorPicker.hexColor'),
  applyColor: t('colorPicker.apply'),
  composerModes: t('storySettings:generation.composerModes'),
  creativeHint: t('storySettings:generation.composerModesCreative'),
  modesMissingHint: t('storySettings:generation.composerModesUnavailable.missing'),
  modesUnrecognizedHint: t('storySettings:generation.composerModesUnavailable.unrecognized'),
  wrapFirst: t('storySettings:generation.wrapPov.first'),
  wrapThird: t('storySettings:generation.wrapPov.third'),
  wrapPovHint: t('storySettings:generation.composerWrapPovHint'),
  wrapPovNeedsModes: t('storySettings:generation.composerWrapPovNeedsModes'),
  fieldComposerModes: t('storySettings:generation.field.composerModes'),
  fieldWrapPov: t('storySettings:generation.field.composerWrapPov'),
  confirmTitle: t('storySettings:confirm.title'),
  wrapPovConsequence: t('storySettings:confirm.consequence.composerWrapPov'),
}

/**
 * The save bar mounts only while the session is dirty, so this doubles as the
 * dirty probe. Anchored on the test id, not a role: the bar's live region now
 * wraps only its message, and dnd-kit mounts a `status` region of its own.
 */
async function findSaveBar(): Promise<HTMLElement> {
  return screen.findByTestId('save-bar')
}

function expectSessionClean(): void {
  expect(screen.queryByRole('button', { name: COPY.discard })).not.toBeInTheDocument()
}

function stepperValue(): string {
  return within(screen.getByTestId('suggestion-count')).getByText(/^\d+$/).textContent ?? ''
}

function startHardGateRun(): void {
  generationStore.startRun({
    runId: 'run-hard-gate',
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    actionId: 'action-hard-gate',
    storyId: 'story-1',
    branchId: 'branch-1',
    abortController: new AbortController(),
    currentPhase: 'narrative',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/StorySettings/AuthoringAidsPanel',
  component: Harness,
  parameters: { layout: 'padded' },
  // Reset resolves the palette out of the app-settings store; reset it so a
  // prior story's edits to that module-global never leak forward.
  beforeEach: () => {
    appSettingsStore.__reset()
    generationStore.__reset()
  },
}

export default meta
type Story = StoryObj<typeof Harness>

export const Default: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
}

export const MasterToggleOff: Story = {
  args: {
    settings: settings({ suggestionsEnabled: false }),
    definition: DEFINITION,
    onCommit: fn(),
  },
}

/**
 * A collision already present in stored data. The rows flag it inline, but the
 * section stays clean, so nothing is blocked until the user edits a category —
 * the play function pins that asymmetry with an unrelated edit.
 */
export const LabelCollision: Story = {
  args: {
    settings: settings({
      suggestionCategories: [
        CATEGORIES[0]!,
        { ...CATEGORIES[1]!, id: 'cat-combat-dup', label: 'COMBAT' },
      ],
    }),
    definition: DEFINITION,
    onCommit: fn(),
  },
  play: async () => {
    expect(screen.getAllByText(COPY.duplicateLabel)).toHaveLength(2)
    expectSessionClean()

    await userEvent.click(screen.getByRole('button', { name: COPY.increment }))

    const bar = await findSaveBar()
    expect(bar.textContent).toContain(COPY.fieldCount)
    expect(within(bar).getByRole('button', { name: /^Save/ })).not.toBeDisabled()
    // Substring, so the bar's tab prefix can't make this pass vacuously.
    expect(
      within(bar).queryByLabelText(COPY.duplicateReason, { exact: false }),
    ).not.toBeInTheDocument()
  },
}

export const NoModeRecorded: Story = {
  args: { settings: settings(), definition: null, onCommit: fn() },
  play: async () => {
    expect(screen.getByRole('switch', { name: COPY.composerModes })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    // The creative copy would claim a mode this story doesn't have.
    expect(screen.getByText(COPY.modesMissingHint)).toBeInTheDocument()
    expect(screen.queryByText(COPY.creativeHint)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: COPY.menu }))

    // Not clicked: a disabled Button drops pointer events on web, so the
    // disabled attribute IS the pin — there is no press left to intercept.
    expect(await screen.findByRole('button', { name: COPY.reset })).toBeDisabled()
    expect(screen.getByText(COPY.resetUnavailable)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

// `definition` is a $type cast over stored JSON, so a mode off the enum is a
// reachable runtime value that TypeScript reports as impossible. Reset must
// disable on it — enabled, its palette lookup returns undefined and the confirm
// handler throws where no boundary catches it.
export const UnrecognizedMode: Story = {
  args: {
    settings: settings(),
    definition: { ...DEFINITION, mode: 'sandbox' as StoryDefinition['mode'] },
    onCommit: fn(),
  },
  play: async () => {
    expect(screen.getByRole('switch', { name: COPY.composerModes })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText(COPY.modesUnrecognizedHint)).toBeInTheDocument()
    expect(screen.queryByText(COPY.modesMissingHint)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: COPY.menu }))

    expect(await screen.findByRole('button', { name: COPY.reset })).toBeDisabled()
    expect(screen.getByText(COPY.resetUnrecognized)).toBeInTheDocument()
    // The null-definition copy would misreport this as "no mode recorded yet".
    expect(screen.queryByText(COPY.resetUnavailable)).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

export const MasterToggleGatesTheSection: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async () => {
    await userEvent.click(screen.getByRole('switch', { name: COPY.suggestions }))

    await waitFor(() => expect(screen.getByRole('button', { name: COPY.increment })).toBeDisabled())
    expect(screen.getByRole('button', { name: COPY.decrement })).toBeDisabled()
    expect(screen.getByRole('button', { name: COPY.addCategory })).toBeDisabled()
    expect(screen.getByTestId('suggestion-category-delete-cat-combat')).toBeDisabled()

    const bar = await findSaveBar()
    expect(bar.textContent).toContain(COPY.fieldSuggestions)

    // Reset is the only mutation left against a list the user otherwise can't
    // touch, so it goes with the editor. The hint stays mode-specific.
    await userEvent.click(screen.getByRole('button', { name: COPY.menu }))
    expect(await screen.findByRole('button', { name: COPY.reset })).toBeDisabled()
    expect(screen.queryByText(COPY.resetUnavailable)).not.toBeInTheDocument()
  },
}

export const HardGateDisablesDirtyAuthoringSession: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: COPY.increment }))
    await findSaveBar()
    await userEvent.click(screen.getAllByRole('button', { name: COPY.pickCustomColor })[0]!)
    await screen.findByLabelText(COPY.hexColor)

    startHardGateRun()

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: COPY.suggestions })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    const stepperButtons = within(screen.getByTestId('suggestion-count')).getAllByRole('button')
    expect(stepperButtons).toHaveLength(2)
    expect(stepperButtons[0]).toBeDisabled()
    expect(stepperButtons[1]).toBeDisabled()
    expect(screen.getByRole('button', { name: COPY.addCategory })).toBeDisabled()
    expect(
      screen.getAllByRole('button', { name: t('generationGate.inFlight') }).length,
    ).toBeGreaterThanOrEqual(3)
    expect(screen.getByTestId('suggestion-category-label-cat-combat')).toHaveAttribute('readonly')
    expect(screen.getByLabelText(COPY.hexColor)).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: COPY.applyColor })).toBeDisabled()

    const save = screen.getByRole('button', { name: /^Save/ })
    expect(save).toBeDisabled()
    expect(screen.getByRole('button', { name: COPY.discard })).not.toBeDisabled()

    await userEvent.keyboard('{Meta>}s{/Meta}')
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const StepperStepsAndGoesInertWhenOff: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async () => {
    expect(stepperValue()).toBe('3')

    await userEvent.click(screen.getByRole('button', { name: COPY.increment }))
    await waitFor(() => expect(stepperValue()).toBe('4'))

    await userEvent.click(screen.getByRole('button', { name: COPY.decrement }))
    await userEvent.click(screen.getByRole('button', { name: COPY.decrement }))
    await waitFor(() => expect(stepperValue()).toBe('2'))

    const bar = await findSaveBar()
    expect(bar.textContent).toContain(COPY.fieldCount)

    // Both controls go inert with the master toggle — clicking them is not even
    // reachable, since IconAction drops pointer events while disabled.
    await userEvent.click(screen.getByRole('switch', { name: COPY.suggestions }))
    await waitFor(() => expect(screen.getByRole('button', { name: COPY.increment })).toBeDisabled())
    expect(screen.getByRole('button', { name: COPY.decrement })).toBeDisabled()
    expect(stepperValue()).toBe('2')
  },
}

export const DeleteCancelKeepsTheRow: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('suggestion-category-delete-cat-combat'))

    const dialog = await screen.findByRole('alertdialog')
    // The row survives the press itself — the compound hands the decision over.
    expect(screen.getByTestId('suggestion-category-label-cat-combat')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: COPY.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('suggestion-category-label-cat-combat')).toBeInTheDocument()
    expectSessionClean()
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const DeleteConfirmRemovesTheRow: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('suggestion-category-delete-cat-combat'))
    await screen.findByRole('alertdialog')

    await userEvent.click(screen.getByTestId('confirm-delete-category'))

    await waitFor(() =>
      expect(screen.queryByTestId('suggestion-category-label-cat-combat')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('suggestion-category-label-cat-banter')).toBeInTheDocument()
    const bar = await findSaveBar()
    expect(bar.textContent).toContain(COPY.fieldCategories)
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const ResetCancelLeavesTheDraft: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: COPY.menu }))
    await userEvent.click(await screen.findByRole('button', { name: COPY.reset }))

    const dialog = await screen.findByRole('alertdialog')
    // The menu is uncontrolled — the action closes it through the trigger handle.
    expect(screen.queryByRole('button', { name: COPY.reset })).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: COPY.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('suggestion-category-label-cat-combat')).toBeInTheDocument()
    expect(screen.queryByTestId('suggestion-category-label-cat_action')).not.toBeInTheDocument()
    expectSessionClean()
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const ResetConfirmSwapsInTheModeDefaults: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: COPY.menu }))
    await userEvent.click(await screen.findByRole('button', { name: COPY.reset }))
    await screen.findByRole('alertdialog')

    await userEvent.click(screen.getByTestId('confirm-reset-categories'))

    await waitFor(() =>
      expect(screen.getByTestId('suggestion-category-label-cat_action')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('suggestion-category-label-cat-combat')).not.toBeInTheDocument()
    const bar = await findSaveBar()
    expect(bar.textContent).toContain(COPY.fieldCategories)
    // Reset moves the draft only — the write still belongs to the save session.
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const TypedCollisionBlocksSave: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn() },
  play: async () => {
    const label = screen.getByTestId('suggestion-category-label-cat-banter')
    await userEvent.clear(label)
    await userEvent.type(label, 'Combat')

    await waitFor(() => expect(screen.getAllByText(COPY.duplicateLabel)).toHaveLength(2))

    const bar = await findSaveBar()
    expect(bar.textContent).toContain(COPY.fieldCategories)
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled()
    expect(within(bar).getByLabelText(COPY.duplicateReasonOnTab)).toBeInTheDocument()
  },
}

export const ComposerModesGatedInCreativeMode: Story = {
  args: {
    settings: settings({ composerModesEnabled: true }),
    definition: { ...DEFINITION, mode: 'creative', leadEntityId: null },
    onCommit: fn(async () => {}),
  },
  play: async () => {
    const toggle = await screen.findByRole('switch', { name: COPY.composerModes })
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(COPY.creativeHint)).toBeInTheDocument()
    // Stored on, so the mode gate is the only thing that can disable wrap POV here.
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: COPY.wrapFirst })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText(COPY.wrapPovNeedsModes)).toBeInTheDocument()
    expectSessionClean()
  },
}

// On a story with turns: only wrap POV is flagged, so the toggle must not ask.
export const ComposerModesToggleSavesWithoutAsking: Story = {
  args: {
    settings: settings({ composerModesEnabled: false }),
    definition: DEFINITION,
    onCommit: fn(async () => {}),
    confirmFlagged: true,
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('switch', { name: COPY.composerModes }))
    const bar = await findSaveBar()
    expect(bar).toHaveTextContent(COPY.fieldComposerModes)

    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))

    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            composerModesEnabled: true,
            composerWrapPov: 'third',
          }),
        }),
      ),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

export const WrapPovAsksForConfirmationOnAStoryWithTurns: Story = {
  args: {
    settings: settings({ composerModesEnabled: true }),
    definition: DEFINITION,
    onCommit: fn(async () => {}),
    confirmFlagged: true,
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('radio', { name: COPY.wrapFirst }))
    const bar = await findSaveBar()
    expect(bar).toHaveTextContent(COPY.fieldWrapPov)

    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(COPY.confirmTitle)
    expect(dialog).toHaveTextContent(COPY.wrapPovConsequence)
    expect(args.onCommit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('confirm-save-anyway'))

    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ composerWrapPov: 'first' }),
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

export const WrapPovSavesWithoutAskingOnAnEmptyStory: Story = {
  args: {
    settings: settings({ composerModesEnabled: true }),
    definition: DEFINITION,
    onCommit: fn(async () => {}),
    confirmFlagged: false,
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('radio', { name: COPY.wrapFirst }))
    const bar = await findSaveBar()

    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))

    await waitFor(() => expect(args.onCommit).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

// Wrap POV edited, then modes off: the edit survives, and Discard still clears it.
export const DiscardResetsTheComposerFields: Story = {
  args: {
    settings: settings({ composerModesEnabled: true }),
    definition: DEFINITION,
    onCommit: fn(async () => {}),
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('radio', { name: COPY.wrapFirst }))
    await userEvent.click(screen.getByRole('switch', { name: COPY.composerModes }))

    const bar = await findSaveBar()
    await waitFor(() => expect(bar).toHaveTextContent(COPY.fieldComposerModes))
    expect(bar).toHaveTextContent(COPY.fieldWrapPov)
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: COPY.wrapFirst })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    expect(screen.getByRole('radio', { name: COPY.wrapFirst })).toBeChecked()

    await userEvent.click(within(bar).getByRole('button', { name: COPY.discard }))

    await waitFor(expectSessionClean)
    expect(screen.getByRole('switch', { name: COPY.composerModes })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: COPY.wrapThird })).toBeChecked()
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

// Modes on, so the run is the only thing that can disable wrap POV here.
export const HardGateFreezesTheComposerFields: Story = {
  args: {
    settings: settings({ composerModesEnabled: true }),
    definition: DEFINITION,
    onCommit: fn(async () => {}),
  },
  play: async () => {
    startHardGateRun()

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: COPY.composerModes })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    // The label, not the radio: that is where a real click lands, and the
    // disabled radio itself is `pointer-events: none`.
    await userEvent.click(screen.getByText(COPY.wrapFirst))

    expect(screen.getByRole('radio', { name: COPY.wrapThird })).toBeChecked()
    expect(screen.getByText(COPY.wrapPovHint)).toBeInTheDocument()
    expectSessionClean()
  },
}

export const WrapPovFollowsTheComposerModesToggle: Story = {
  args: {
    settings: settings({ composerModesEnabled: false }),
    definition: DEFINITION,
    onCommit: fn(async () => {}),
  },
  play: async () => {
    expect(await screen.findByRole('radio', { name: COPY.wrapFirst })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('radio', { name: COPY.wrapThird })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText(COPY.wrapPovNeedsModes)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('switch', { name: COPY.composerModes }))

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: COPY.wrapFirst })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    expect(screen.getByText(COPY.wrapPovHint)).toBeInTheDocument()
    expect(screen.queryByText(COPY.wrapPovNeedsModes)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: COPY.wrapFirst }))
    await waitFor(() => expect(screen.getByRole('radio', { name: COPY.wrapFirst })).toBeChecked())
  },
}

// `composerModesEnabled` isn't flagged, so this save is the only consent point
// for a wrap-POV change made before modes went off.
export const WrapPovEditSurvivesTurningModesOff: Story = {
  args: {
    settings: settings({ composerModesEnabled: true }),
    definition: DEFINITION,
    onCommit: fn(async () => {}),
    confirmFlagged: true,
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('radio', { name: COPY.wrapFirst }))
    await userEvent.click(screen.getByRole('switch', { name: COPY.composerModes }))
    const bar = await findSaveBar()
    await waitFor(() => expect(bar).toHaveTextContent(COPY.fieldComposerModes))
    expect(bar).toHaveTextContent(COPY.fieldWrapPov)

    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(COPY.wrapPovConsequence)
    expect(args.onCommit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('confirm-save-anyway'))

    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            composerModesEnabled: false,
            composerWrapPov: 'first',
          }),
        }),
      ),
    )
  },
}

// The whole patch, not `objectContaining`: every other commit assertion here pins
// only the composer keys, so writing the stored suggestion values back in place of
// the user's edits satisfies all of them while discarding the edits.
export const SavePinsEverySuggestionKeyItOwns: Story = {
  args: { settings: settings(), definition: DEFINITION, onCommit: fn(async () => {}) },
  play: async ({ args }) => {
    const label = screen.getByTestId('suggestion-category-label-cat-banter')
    await userEvent.clear(label)
    await userEvent.type(label, 'Gossip')

    await userEvent.click(screen.getByRole('button', { name: COPY.increment }))
    await waitFor(() => expect(stepperValue()).toBe('4'))

    const bar = await findSaveBar()
    await waitFor(() => expect(bar).toHaveTextContent(COPY.fieldCategories))
    expect(bar).toHaveTextContent(COPY.fieldCount)

    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))

    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({
        settings: {
          composerModesEnabled: true,
          composerWrapPov: 'third',
          suggestionsEnabled: true,
          suggestionCount: 4,
          suggestionCategories: [
            {
              id: 'cat-combat',
              label: 'Combat',
              promptHint: 'A decisive strike, block, or retreat.',
              color: 'red',
              enabled: true,
              order: 0,
            },
            {
              id: 'cat-banter',
              label: 'Gossip',
              promptHint: 'A barbed line aimed at whoever is closest.',
              color: 'blue',
              enabled: true,
              order: 1,
            },
            {
              id: 'cat-scan',
              label: 'Scan',
              promptHint: '',
              color: 'teal',
              enabled: false,
              order: 2,
            },
          ],
        },
      }),
    )
  },
}
