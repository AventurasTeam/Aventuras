import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import type { StorySettingsSessionPatch } from '@/lib/actions'
import { STORY_SETTINGS_DEFAULTS, type StorySettings } from '@/lib/db'
import { t } from '@/lib/i18n'

import { externalCell } from './external-cell'
import { MemoryKnobsPanel } from './memory-knobs-panel'
import { StorySettingsSaveSessionProvider } from './save-session'
import { StorySettingsSaveBar } from './save-session-chrome'

function settings(overrides: Partial<StorySettings> = {}): StorySettings {
  return { ...STORY_SETTINGS_DEFAULTS, ...overrides }
}

type HarnessProps = {
  settings: StorySettings
  disabled?: boolean
  embedder?: ReactNode
  onCommit: (patch: StorySettingsSessionPatch) => Promise<unknown>
}

function Harness({ settings: storySettings, disabled = false, embedder, onCommit }: HarnessProps) {
  return (
    <View className="gap-4 rounded-md bg-bg-base p-4" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider onCommit={onCommit} confirmFlagged={false}>
        <MemoryKnobsPanel
          settings={storySettings}
          disabled={disabled}
          disabledReason={disabled ? t('generationGate.inFlight') : undefined}
          embedder={embedder}
        />
        <StorySettingsSaveBar enabled blocked={disabled} />
      </StorySettingsSaveSessionProvider>
    </View>
  )
}

function StatefulHarness({ settings: initial, onCommit }: HarnessProps) {
  const [cell] = useState(() => externalCell(initial))
  const current = useSyncExternalStore(cell.subscribe, cell.get)
  const commit = useCallback(
    async (patch: StorySettingsSessionPatch) => {
      await onCommit(patch)
      cell.set({ ...cell.get(), ...patch.settings })
    },
    [cell, onCommit],
  )
  return <Harness settings={current} onCommit={commit} />
}

const COPY = {
  short: t('storySettings:memory.knobs.preset.short'),
  balanced: t('storySettings:memory.knobs.preset.balanced'),
  custom: t('storySettings:memory.knobs.preset.custom'),
  autoClose: t('storySettings:memory.knobs.autoClose'),
  fullChapter: t('storySettings:memory.knobs.fullChapter'),
  contextDecrement: t('storySettings:memory.knobs.contextDecrement'),
  contextIncrement: t('storySettings:memory.knobs.contextIncrement'),
  cadenceWarningChip: t('storySettings:memory.knobs.cadenceWarningChip'),
  cadenceWarning: t('storySettings:memory.knobs.cadenceWarning'),
  boost: t('storySettings:memory.knobs.keywordModeOption.boost'),
  inject: t('storySettings:memory.knobs.keywordModeOption.inject'),
  cascade: t('storySettings:memory.knobs.cascade'),
  discard: t('saveBar.discard'),
  inFlight: t('generationGate.inFlight'),
}

const INVALID = {
  threshold: t('storySettings:memory.knobs.invalid.threshold'),
  partialBuffer: t('storySettings:memory.knobs.invalid.partialBuffer'),
  cadence: t('storySettings:memory.knobs.invalid.cadence'),
  budgetShare: t('storySettings:memory.knobs.invalid.budgetShare'),
  cascadeDepth: t('storySettings:memory.knobs.invalid.cascadeDepth'),
}

const FIELD = {
  chapterTokenThreshold: t('storySettings:memory.knobs.field.chapterTokenThreshold'),
  chapterAutoClose: t('storySettings:memory.knobs.field.chapterAutoClose'),
  classifierContextEntries: t('storySettings:memory.knobs.field.classifierContextEntries'),
  classifierCadence: t('storySettings:memory.knobs.field.classifierCadence'),
  retrievalBudgets: t('storySettings:memory.knobs.field.retrievalBudgets'),
  keywordRetrieval: t('storySettings:memory.knobs.field.keywordRetrieval'),
}

function reasonOnTab(reason: string): string {
  return t('storySettings:save.invalidOnTab', { tab: t('storySettings:tabs.memory'), reason })
}

function chip(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

function modeRadio(label: string): HTMLElement {
  return screen.getByRole('radio', { name: (name) => name.startsWith(label) })
}

async function replaceText(testID: string, text: string) {
  const input = screen.getByTestId(testID)
  await userEvent.clear(input)
  await userEvent.type(input, text)
}

async function save() {
  const bar = await screen.findByTestId('save-bar')
  await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/StorySettings/MemoryKnobsPanel',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { settings: settings(), onCommit: fn(async () => {}) },
}
export default meta
type Story = StoryObj<typeof Harness>

export const Populated: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    // Section titles are headings, so a screen reader can jump between them.
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(
      (['chapterClose', 'promptContext', 'classifier', 'budgets', 'keyword'] as const).map((key) =>
        t(`storySettings:memory.knobs.${key}`),
      ),
    )
    expect(screen.getByTestId('memory-budget-total')).toHaveTextContent(
      t('storySettings:memory.knobs.budgetTotal', { tokens: 5500 }),
    )
    // Scan depth sizes the keyword haystack in both modes, so Boost shows it too.
    expect(screen.getByTestId('memory-keyword-scan')).toBeInTheDocument()
    expect(screen.queryByTestId('memory-keyword-inject-controls')).not.toBeInTheDocument()
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

// Canon orders the tab Chapter close, Prompt context, Classifier, Embedder, Retrieval budgets.
export const EmbedderSitsBetweenClassifierAndBudgets: Story = {
  render: (args) => <Harness {...args} embedder={<View testID="embedder-slot" />} />,
  play: async () => {
    const slot = await screen.findByTestId('embedder-slot')
    const cadence = screen.getByTestId('memory-cadence')
    const firstBudget = screen.getByTestId('memory-budget-entities')
    expect(cadence.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(firstBudget.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_PRECEDING).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    )
  },
}

export const ThresholdPresetChipWritesTokens: Story = {
  play: async ({ args }) => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.click(chip(COPY.short))
    await save()
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledTimes(1))
    // Exact: the section sends its whole slice every save, never a diff of the dirty keys.
    expect(args.onCommit).toHaveBeenCalledWith({
      settings: {
        chapterTokenThreshold: 8000,
        chapterAutoClose: true,
        fullChapterInBuffer: false,
        partialChapterBuffer: 10,
        protectedBuffer: 10,
        classifierContextEntries: 4,
        classifierCadence: 5,
        retrievalBudgets: {
          entities: 1200,
          lore: 1800,
          happenings: 1500,
          threads: 400,
          chapters: 600,
        },
        keywordRetrieval: {
          mode: 'boost',
          budgetShare: 0.5,
          scanEntries: 1,
          cascade: false,
          cascadeMaxDepth: 2,
        },
      },
    })
  },
}

export const ThresholdNumberIsNeverHidden: Story = {
  play: async () => {
    const input = await screen.findByTestId('memory-threshold')
    expect(input).toHaveValue('24000')
    expect(chip(COPY.balanced)).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(chip(COPY.short))
    await waitFor(() => expect(input).toHaveValue('8000'))
    expect(chip(COPY.short)).toHaveAttribute('aria-pressed', 'true')

    await replaceText('memory-threshold', '12000')
    await waitFor(() => expect(chip(COPY.custom)).toHaveAttribute('aria-pressed', 'true'))
  },
}

export const CustomChipPinsItsSelection: Story = {
  play: async () => {
    const input = await screen.findByTestId('memory-threshold')
    await userEvent.click(chip(COPY.custom))
    await waitFor(() => expect(chip(COPY.custom)).toHaveAttribute('aria-pressed', 'true'))
    expect(chip(COPY.balanced)).toHaveAttribute('aria-pressed', 'false')
    expect(input).toHaveValue('24000')
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()

    await replaceText('memory-threshold', '8000')
    await waitFor(() => expect(chip(COPY.short)).toHaveAttribute('aria-pressed', 'true'))
    expect(chip(COPY.custom)).toHaveAttribute('aria-pressed', 'false')
  },
}

export const CadenceWarningInPartialMode: Story = {
  args: { settings: settings({ classifierCadence: 12, partialChapterBuffer: 10 }) },
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    const warning = screen.getByTestId('memory-cadence-warning')
    expect(warning).toHaveTextContent(COPY.cadenceWarningChip)
    expect(warning).toHaveTextContent(COPY.cadenceWarning)
    expect(screen.queryByTestId('memory-cadence-overlap')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('switch', { name: COPY.fullChapter }))
    await waitFor(() =>
      expect(screen.queryByTestId('memory-cadence-indicator')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('memory-partial-buffer')).toHaveAttribute('readonly')
  },
}

export const CadenceOverlapPositive: Story = {
  args: { settings: settings({ classifierCadence: 8, partialChapterBuffer: 10 }) },
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    expect(screen.getByTestId('memory-cadence-overlap')).toHaveTextContent(
      t('storySettings:memory.knobs.cadenceOverlap', { count: 2 }),
    )
    expect(screen.queryByTestId('memory-cadence-warning')).not.toBeInTheDocument()
  },
}

export const ClassifierContextCannotGoBelowTwo: Story = {
  args: { settings: settings({ classifierContextEntries: 3 }) },
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    const decrement = screen.getByRole('button', { name: COPY.contextDecrement })
    await userEvent.click(decrement)
    expect(
      within(screen.getByTestId('memory-classifier-context')).getByText('2'),
    ).toBeInTheDocument()
    expect(decrement).toBeDisabled()
  },
}

export const InvalidCadenceBlocksSave: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    await replaceText('memory-cadence', '0')
    const bar = await screen.findByTestId('save-bar')
    await waitFor(() =>
      expect(within(bar).getByLabelText(reasonOnTab(INVALID.cadence))).toBeInTheDocument(),
    )
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled()
  },
}

export const EveryInvalidFieldIsMarked: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.clear(screen.getByTestId('memory-threshold'))
    await replaceText('memory-cadence', '0')
    await waitFor(() =>
      expect(screen.getByTestId('memory-cadence')).toHaveAttribute('aria-invalid', 'true'),
    )
    expect(screen.getByTestId('memory-threshold')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(INVALID.threshold)).toBeInTheDocument()
    expect(screen.queryByText(INVALID.cadence)).not.toBeInTheDocument()
    const bar = await screen.findByTestId('save-bar')
    expect(within(bar).getByLabelText(reasonOnTab(INVALID.threshold))).toBeInTheDocument()
  },
}

export const InvalidShareRevertsWhenModeTurnsBoost: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.click(modeRadio(COPY.inject))
    await screen.findByTestId('memory-keyword-share')
    await replaceText('memory-keyword-share', '1.5')
    const bar = await screen.findByTestId('save-bar')
    await waitFor(() =>
      expect(within(bar).getByLabelText(reasonOnTab(INVALID.budgetShare))).toBeInTheDocument(),
    )

    await userEvent.click(modeRadio(COPY.boost))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())

    await userEvent.click(modeRadio(COPY.inject))
    expect(await screen.findByTestId('memory-keyword-share')).toHaveValue('0.5')
  },
}

export const InvalidPartialBufferRevertsInFullMode: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.clear(screen.getByTestId('memory-partial-buffer'))
    await waitFor(() =>
      expect(
        within(screen.getByTestId('save-bar')).getByLabelText(reasonOnTab(INVALID.partialBuffer)),
      ).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('switch', { name: COPY.fullChapter }))
    await waitFor(() => expect(screen.getByTestId('memory-partial-buffer')).toHaveValue('10'))
    expect(screen.getByTestId('memory-partial-buffer')).toHaveAttribute('readonly')
    const bar = screen.getByTestId('save-bar')
    expect(within(bar).queryByLabelText(reasonOnTab(INVALID.partialBuffer))).not.toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeEnabled()
  },
}

export const InvalidCascadeDepthRevertsWhenCascadeTurnsOff: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.click(modeRadio(COPY.inject))
    await userEvent.click(await screen.findByRole('switch', { name: COPY.cascade }))
    await waitFor(() =>
      expect(screen.getByTestId('memory-keyword-cascade-depth')).not.toHaveAttribute('readonly'),
    )
    await userEvent.clear(screen.getByTestId('memory-keyword-cascade-depth'))
    await waitFor(() =>
      expect(
        within(screen.getByTestId('save-bar')).getByLabelText(reasonOnTab(INVALID.cascadeDepth)),
      ).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('switch', { name: COPY.cascade }))
    await waitFor(() => expect(screen.getByTestId('memory-keyword-cascade-depth')).toHaveValue('2'))
    expect(screen.getByTestId('memory-keyword-cascade-depth')).toHaveAttribute('readonly')
    const bar = screen.getByTestId('save-bar')
    expect(within(bar).queryByLabelText(reasonOnTab(INVALID.cascadeDepth))).not.toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeEnabled()
  },
}

// The mode radio is the other way the depth field leaves the screen, and it takes the
// whole inject subtree with it — an invalid value left behind refuses every save on the
// surface while naming a control the user can no longer see.
export const InvalidCascadeDepthRevertsWhenModeTurnsBoost: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.click(modeRadio(COPY.inject))
    await userEvent.click(await screen.findByRole('switch', { name: COPY.cascade }))
    await waitFor(() =>
      expect(screen.getByTestId('memory-keyword-cascade-depth')).not.toHaveAttribute('readonly'),
    )
    await userEvent.clear(screen.getByTestId('memory-keyword-cascade-depth'))
    await waitFor(() =>
      expect(
        within(screen.getByTestId('save-bar')).getByLabelText(reasonOnTab(INVALID.cascadeDepth)),
      ).toBeInTheDocument(),
    )

    await userEvent.click(modeRadio(COPY.boost))
    await waitFor(() =>
      expect(screen.queryByTestId('memory-keyword-inject-controls')).not.toBeInTheDocument(),
    )
    // The cascade switch is still flipped, so the section stays dirty and the bar stays up.
    const bar = screen.getByTestId('save-bar')
    expect(within(bar).queryByLabelText(reasonOnTab(INVALID.cascadeDepth))).not.toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeEnabled()

    await userEvent.click(modeRadio(COPY.inject))
    expect(await screen.findByTestId('memory-keyword-cascade-depth')).toHaveValue('2')
  },
}

export const InjectDisclosesThreeControls: Story = {
  play: async ({ args }) => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.click(modeRadio(COPY.inject))
    const controls = await screen.findByTestId('memory-keyword-inject-controls')
    expect(within(controls).getByTestId('memory-keyword-share')).toBeInTheDocument()
    expect(within(controls).getByRole('switch', { name: COPY.cascade })).toBeInTheDocument()
    expect(within(controls).getByTestId('memory-keyword-cascade-depth')).toHaveAttribute('readonly')
    expect(within(controls).queryByTestId('memory-keyword-scan')).not.toBeInTheDocument()
    expect(screen.getByTestId('memory-keyword-scan')).toBeInTheDocument()
    await save()
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            keywordRetrieval: {
              mode: 'inject',
              budgetShare: 0.5,
              scanEntries: 1,
              cascade: false,
              cascadeMaxDepth: 2,
            },
          }),
        }),
      ),
    )
  },
}

export const BudgetTotalTracksInputs: Story = {
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    const lore = screen.getByTestId('memory-budget-lore')
    await userEvent.clear(lore)
    await waitFor(() => expect(screen.queryByTestId('memory-budget-total')).not.toBeInTheDocument())
    await userEvent.type(lore, '2000')
    await waitFor(() =>
      expect(screen.getByTestId('memory-budget-total')).toHaveTextContent(
        t('storySettings:memory.knobs.budgetTotal', { tokens: 5700 }),
      ),
    )
  },
}

export const DiscardRevertsEveryKnob: Story = {
  play: async ({ args }) => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.click(chip(COPY.short))
    await userEvent.click(screen.getByRole('switch', { name: COPY.autoClose }))
    await userEvent.click(screen.getByRole('button', { name: COPY.contextIncrement }))
    await replaceText('memory-cadence', '7')
    await replaceText('memory-budget-lore', '2000')
    await userEvent.click(modeRadio(COPY.inject))

    const bar = await screen.findByTestId('save-bar')
    const allFields = [
      FIELD.chapterTokenThreshold,
      FIELD.chapterAutoClose,
      FIELD.classifierContextEntries,
      FIELD.classifierCadence,
      FIELD.retrievalBudgets,
      FIELD.keywordRetrieval,
    ].join(', ')
    await waitFor(() => expect(bar).toHaveTextContent(allFields))

    await userEvent.click(within(bar).getByRole('button', { name: COPY.discard }))

    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
    expect(screen.getByTestId('memory-threshold')).toHaveValue('24000')
    expect(chip(COPY.balanced)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('switch', { name: COPY.autoClose })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(
      within(screen.getByTestId('memory-classifier-context')).getByText('4'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('memory-cadence')).toHaveValue('5')
    expect(screen.getByTestId('memory-budget-lore')).toHaveValue('1800')
    expect(screen.queryByTestId('memory-keyword-inject-controls')).not.toBeInTheDocument()
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

// The store refreshes inside the commit, so the revert baseline must follow the
// saved settings, not the mounted ones.
export const SaveReseedsFromTheSavedSettings: Story = {
  render: (args) => <StatefulHarness {...args} />,
  play: async ({ args }) => {
    await screen.findByTestId('memory-knobs-panel')
    await userEvent.click(modeRadio(COPY.inject))
    await screen.findByTestId('memory-keyword-share')
    await replaceText('memory-keyword-share', '0.3')
    await save()

    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
    expect(screen.getByTestId('memory-keyword-share')).toHaveValue('0.3')
    expect(args.onCommit).toHaveBeenCalledOnce()
    expect(args.onCommit).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        keywordRetrieval: {
          mode: 'inject',
          budgetShare: 0.3,
          scanEntries: 1,
          cascade: false,
          cascadeMaxDepth: 2,
        },
      }),
    })

    await replaceText('memory-keyword-share', '1.5')
    await userEvent.click(modeRadio(COPY.boost))
    await userEvent.click(modeRadio(COPY.inject))
    expect(await screen.findByTestId('memory-keyword-share')).toHaveValue('0.3')
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
  },
}

export const Disabled: Story = {
  args: { disabled: true },
  play: async () => {
    await screen.findByTestId('memory-knobs-panel')
    for (const testID of [
      'memory-threshold',
      'memory-partial-buffer',
      'memory-cadence',
      'memory-budget-lore',
      'memory-keyword-scan',
    ]) {
      expect(screen.getByTestId(testID)).toHaveAttribute('readonly')
    }
    expect(chip(COPY.short)).toHaveAttribute('aria-disabled', 'true')
    expect(chip(COPY.custom)).toHaveAttribute('aria-disabled', 'true')
    expect(chip(COPY.short).closest('[title]')).toHaveAttribute('title', COPY.inFlight)
    for (const name of [COPY.autoClose, COPY.fullChapter]) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    // A disabled Stepper names both of its buttons by the reason.
    expect(
      within(screen.getByTestId('memory-classifier-context')).getAllByRole('button', {
        name: COPY.inFlight,
      }),
    ).toHaveLength(2)
    for (const label of [COPY.boost, COPY.inject]) {
      expect(modeRadio(label)).toHaveAttribute('aria-disabled', 'true')
    }
  },
}
