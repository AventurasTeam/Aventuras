import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, mocked, screen, userEvent, waitFor, within } from 'storybook/test'

import { Toaster } from '@/components/ui/toast'
import type { InstalledModelInfo } from '@/hooks/use-installed-models'
import {
  StorySettingsStaleStoreError,
  type DeclineEmbeddingUpgradeFn,
  type UpdateStorySettingsResult,
} from '@/lib/actions'
import {
  APP_SETTINGS_DEFAULTS,
  STORY_SETTINGS_DEFAULTS,
  storySettingsSchema,
  type StorySettings,
} from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  appSettingsStore,
  embedderSwapStore,
  embeddingStatusStore,
  generationStore,
  hydrateAppSettings,
  isUserEditBlocked,
  openEmbedderSwapDialog,
} from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { MemoryPanel, type MemoryPanelProps } from './memory-panel'

const STORY_ID = 'story-1'
const MINILM = 'Xenova/all-MiniLM-L6-v2'
const GEMMA = 'onnx-community/embeddinggemma-300m-ONNX'
const GEMMA_LABEL = 'EmbeddingGemma 300m (multilingual)'
const APP_DEFAULT = 'text-embedding-3-small'

function buildSettings(overrides: Partial<StorySettings> = {}): StorySettings {
  return storySettingsSchema.parse({
    classifierCadence: 4,
    classifierContextEntries: 4,
    piggybackMode: 'on',
    embeddingBackend: 'local',
    embedding_model_id: MINILM,
    retrievalBudgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
    keywordRetrieval: STORY_SETTINGS_DEFAULTS.keywordRetrieval,
    composerModesEnabled: true,
    composerWrapPov: 'third',
    suggestionsEnabled: true,
    suggestionCategories: [],
    translation: {
      enabled: false,
      targetLanguage: null,
      granularToggles: {
        narrative: false,
        entityNames: false,
        entityDescriptions: false,
        lore: false,
        threads: false,
        happenings: false,
        chapterMeta: false,
      },
    },
    models: {},
    activePackId: null,
    packVariables: {},
    ...overrides,
  })
}

const INSTALLED: InstalledModelInfo[] = [
  { id: MINILM, sizeBytes: 90_000_000 },
  { id: GEMMA, sizeBytes: 300_000_000 },
]

const listInstalled = async () => INSTALLED

// Held open until the play releases it, so the dialog opens before any candidate exists.
let releaseInstalled: (() => void) | null = null
const lateListInstalled = () =>
  new Promise<InstalledModelInfo[]>((resolve) => {
    releaseInstalled = () => resolve(INSTALLED)
  })

const failingListInstalled = async (): Promise<InstalledModelInfo[]> => {
  throw new Error('listing failed')
}

async function seedEmbeddingDefault(
  embeddingModelId: string | null,
  embeddingBackend: 'local' | 'provider' = 'provider',
) {
  const result = await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    providers: [
      {
        id: 'prov_local',
        type: 'openai-compatible',
        displayName: 'Local',
        apiKey: '',
        endpoint: 'http://localhost:1234/v1',
        favoriteModelIds: [],
        // A cached dim short-circuits ensureProviderEmbeddingDim, which would otherwise probe
        // this endpoint for real whenever a provider row is selected.
        cachedModels:
          embeddingModelId == null
            ? []
            : [{ id: embeddingModelId, capabilities: { embeddingDim: 384 } }],
      },
    ],
    embeddingProviderId: 'prov_local',
    embeddingModelId,
    defaultStorySettings: {
      ...APP_SETTINGS_DEFAULTS.defaultStorySettings,
      embeddingBackend,
    },
  }))
  if (result.status !== 'ok') throw new Error(`App settings seed rejected: ${result.error}`)
}

function resetStores() {
  embedderSwapStore.__reset()
  embeddingStatusStore.__reset()
  appSettingsStore.__reset()
  generationStore.__reset()
  toastStore.__reset()
}

function Harness(props: MemoryPanelProps) {
  const disabled = generationStore.useGeneration((state) => isUserEditBlocked(state.txState))
  return (
    <>
      <MemoryPanel
        {...props}
        disabled={disabled}
        disabledReason={disabled ? t('generationGate.inFlight') : undefined}
      />
      <Toaster />
    </>
  )
}

// MemoryPanel reads three module-global Zustand stores directly (swap
// dialog/progress, stale-count, and app-settings defaults) — each story
// resets and re-seeds them so a prior story's picks never leak forward.
const meta: Meta<typeof Harness> = {
  title: 'Compounds/StorySettings/MemoryPanel',
  component: Harness,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-[520px] gap-4 rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof MemoryPanel>

export const Clean: Story = {
  args: { storyId: STORY_ID, settings: buildSettings(), listInstalled },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
  },
  play: async () => {
    expect(await screen.findByTestId('memory-panel')).toBeInTheDocument()
    expect(screen.getByText('0 rows pending re-embed.')).toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:memory.reason.retrying'))).not.toBeInTheDocument()
    expect(
      screen.queryByText(t('storySettings:memory.reason.providerUnconfigured')),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('storySettings:memory.switchEmbedder') }),
    ).not.toBeDisabled()
  },
}

export const StaleWithReason: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embeddingBackend: 'provider', embedding_provider_id: undefined }),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 12)
  },
  play: async () => {
    expect(await screen.findByText('12 rows pending re-embed.')).toBeInTheDocument()
    expect(
      screen.getByText(t('storySettings:memory.reason.providerUnconfigured')),
    ).toBeInTheDocument()
  },
}

export const ReasonModelMissing: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embedding_model_id: 'not-a-catalog-model' }),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 7)
  },
  play: async () => {
    expect(await screen.findByText('7 rows pending re-embed.')).toBeInTheDocument()
    expect(screen.getByText(t('storySettings:memory.reason.modelMissing'))).toBeInTheDocument()
  },
}

export const ReasonRetrying: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings(),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 3)
  },
  play: async () => {
    // Config resolves fine (valid local model) — a non-zero stale count with
    // no config error means transient embed failures, not a blocked config.
    expect(await screen.findByText('3 rows pending re-embed.')).toBeInTheDocument()
    expect(screen.getByText(t('storySettings:memory.reason.retrying'))).toBeInTheDocument()
  },
}

export const ReindexConfirmGate: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings(),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
  },
  play: async () => {
    await userEvent.click(await screen.findByTestId('reindex-now'))

    // Pressing the button must open the gate rather than start embedding.
    const dialog = await screen.findByTestId('reindex-confirm')
    // No DB bridge in Storybook, so the count resolves null — the copy falls back
    // to the countless variant instead of claiming the story has zero entries.
    expect(
      within(dialog).getByText(
        t('storySettings:reindexConfirm.bodyUnknownCount', { model: MINILM }),
      ),
    ).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: t('cancel') }))
    await waitFor(() => expect(screen.queryByTestId('reindex-confirm')).not.toBeInTheDocument())
  },
}

export const HardGateDisablesAnOpenReindexConfirmation: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings(),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
  },
  play: async () => {
    await userEvent.click(await screen.findByTestId('reindex-now'))
    const dialog = await screen.findByTestId('reindex-confirm')

    generationStore.startRun({
      runId: 'run-hard-gate',
      kind: 'per-turn',
      gateBehavior: 'hard-gate',
      actionId: 'action-hard-gate',
      storyId: STORY_ID,
      branchId: 'branch-1',
      abortController: new AbortController(),
      currentPhase: 'narrative',
      intermediates: {},
      terminal: Promise.resolve(),
      resolveTerminal: () => {},
    })

    await waitFor(() => expect(within(dialog).getByTestId('reindex-confirm-start')).toBeDisabled())
    const cancel = within(dialog).getByRole('button', { name: t('cancel') })
    expect(cancel).not.toBeDisabled()
    expect(within(dialog).getByTestId('reindex-confirm-start').parentElement).toHaveAttribute(
      'title',
      t('generationGate.inFlight'),
    )

    await userEvent.click(cancel)
    await waitFor(() => expect(screen.queryByTestId('reindex-confirm')).not.toBeInTheDocument())
    expect(screen.getByTestId('reindex-now')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: t('storySettings:memory.switchEmbedder') }),
    ).toBeDisabled()
  },
}

export const HardGateDisablesOpenSwapActions: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings(),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    openEmbedderSwapDialog(STORY_ID)
  },
  play: async () => {
    await userEvent.click(await screen.findByTestId(`swap-candidate-local:${GEMMA}`))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await screen.findByTestId('swap-reindex')

    generationStore.startRun({
      runId: 'run-hard-gate',
      kind: 'chapter-close',
      gateBehavior: 'hard-gate',
      actionId: 'action-hard-gate',
      storyId: STORY_ID,
      branchId: 'branch-1',
      abortController: new AbortController(),
      currentPhase: 'chapter-metadata',
      intermediates: {},
      terminal: Promise.resolve(),
      resolveTerminal: () => {},
    })

    await waitFor(() => expect(screen.getByTestId('swap-reindex')).toBeDisabled())
    expect(screen.getByTestId('swap-relabel')).toBeDisabled()
    expect(screen.getByRole('button', { name: t('storySettings:swap.keep') })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: t('storySettings:swap.cancel') })).not.toBeDisabled()
  },
}

export const HardGateDisablesResumeButKeepsCancel: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embedding_swap_target: GEMMA }),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 5)
    generationStore.startRun({
      runId: 'run-hard-gate',
      kind: 'per-turn',
      gateBehavior: 'hard-gate',
      actionId: 'action-hard-gate',
      storyId: STORY_ID,
      branchId: 'branch-1',
      abortController: new AbortController(),
      currentPhase: 'narrative',
      intermediates: {},
      terminal: Promise.resolve(),
      resolveTerminal: () => {},
    })
  },
  play: async () => {
    expect(await screen.findByTestId('memory-swap-pending-resume')).toBeDisabled()
    expect(screen.getByTestId('memory-swap-pending-cancel')).not.toBeDisabled()
  },
}

export const SwapInProgress: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embedding_swap_target: GEMMA }),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embedderSwapStore.setProgress({ storyId: STORY_ID, done: 4, total: 10 })
  },
  play: async () => {
    expect(
      await screen.findByText(t('storySettings:memory.reindexing', { done: 4, total: 10 })),
    ).toBeInTheDocument()
    const cancel = screen.getByTestId('memory-cancel-swap')
    // No resume prompt while a loop is live for this story, even though the
    // swap-target marker is set.
    expect(screen.queryByTestId('memory-swap-pending-resume')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('storySettings:memory.switchEmbedder'), hidden: true }),
    ).toBeDisabled()
    expect(screen.getByTestId('reindex-now')).toBeDisabled()
    await userEvent.click(cancel)
    await waitFor(() => expect(embedderSwapStore.isCancelRequested(STORY_ID)).toBe(true))
  },
}

export const SwapInProgressBeforeRehydrate: Story = {
  // Live progress for this story, but `settings` still reflects the
  // pre-swap row — stores only rehydrate at swap end, so a fresh swap's
  // marker is never store-visible mid-run. Guards against gating solely on
  // settings.embedding_swap_target.
  args: {
    storyId: STORY_ID,
    settings: buildSettings(),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    embedderSwapStore.setProgress({ storyId: STORY_ID, done: 2, total: 10 })
  },
  play: async () => {
    expect(
      await screen.findByText(t('storySettings:memory.reindexing', { done: 2, total: 10 })),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('storySettings:memory.switchEmbedder') }),
    ).toBeDisabled()
    expect(screen.getByTestId('reindex-now')).toBeDisabled()
  },
}

export const SwapPendingMarker: Story = {
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embedding_swap_target: GEMMA }),
    listInstalled,
  },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 5)
  },
  play: async () => {
    expect(
      await screen.findByRole('button', { name: t('storySettings:memory.switchEmbedder') }),
    ).toBeDisabled()
    expect(screen.getByText(t('storySettings:memory.swapPending'))).toBeInTheDocument()
    // Inline, not modal: the app-level SwapResumeHost owns the dialog, so this
    // surface stays reachable when Story Settings is opened by a cold reload.
    // It surfaces the raw swap_target marker value, not a catalog-resolved label.
    expect(await screen.findByTestId('memory-swap-pending')).toBeInTheDocument()
    expect(screen.getByTestId('memory-swap-pending-resume')).toBeInTheDocument()
    expect(screen.getByTestId('memory-swap-pending-cancel')).toBeInTheDocument()
    expect(
      screen.getByText(t('storySettings:memory.swapPendingBody', { model: GEMMA })),
    ).toBeInTheDocument()
  },
}

export const SharedModelIdOffersBothSources: Story = {
  // The app's provider embedding model id set to an id that is ALSO installed
  // locally. These are two different embedders that happen to share a name, so
  // both are offered and told apart by their source label; collapsing them to
  // one row made the provider copy unreachable.
  args: { storyId: STORY_ID, settings: buildSettings(), listInstalled },
  beforeEach: async () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    await seedEmbeddingDefault(MINILM)
    openEmbedderSwapDialog(STORY_ID)
  },
  play: async () => {
    const localRow = await screen.findByTestId(`swap-candidate-local:${MINILM}`)
    const providerRow = screen.getByTestId(`swap-candidate-provider:prov_local:${MINILM}`)

    // Same model id, two rows, distinguished by where each is served from.
    expect(within(localRow).getByText(t('storySettings:swap.sourceLocal'))).toBeInTheDocument()
    expect(within(providerRow).getByText('Local')).toBeInTheDocument()

    // The story runs on the local copy, so only that row is the current one —
    // the provider copy stays selectable.
    expect(within(localRow).getByText(t('storySettings:swap.current'))).toBeInTheDocument()
    expect(providerRow).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId(`swap-candidate-local:${GEMMA}`)).toBeInTheDocument()
  },
}

export const TargetPickerVisible: Story = {
  args: { storyId: STORY_ID, settings: buildSettings(), listInstalled },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    openEmbedderSwapDialog(STORY_ID)
  },
  play: async () => {
    const minilmRow = await screen.findByTestId(`swap-candidate-local:${MINILM}`)
    expect(within(minilmRow).getByText(t('storySettings:swap.current'))).toBeInTheDocument()

    const gemmaRow = screen.getByTestId(`swap-candidate-local:${GEMMA}`)
    await userEvent.click(gemmaRow)
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await waitFor(() => expect(screen.getByTestId('swap-reindex')).toBeInTheDocument())
  },
}

export const PreseatedDialogOpensOnOptions: Story = {
  args: { storyId: STORY_ID, settings: buildSettings(), listInstalled },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    openEmbedderSwapDialog(STORY_ID, GEMMA)
  },
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        t('storySettings:swap.optionsTitle', { model: GEMMA_LABEL }),
      ),
    )
    expect(screen.getByTestId('swap-keep')).toBeInTheDocument()
  },
}

export const PreseatWaitsForLateCandidates: Story = {
  args: { storyId: STORY_ID, settings: buildSettings(), listInstalled: lateListInstalled },
  beforeEach: () => {
    resetStores()
    releaseInstalled = null
    embeddingStatusStore.setStatus(STORY_ID, 0)
    openEmbedderSwapDialog(STORY_ID, GEMMA)
  },
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t('storySettings:swap.title'))
    expect(screen.queryByTestId(`swap-candidate-local:${GEMMA}`)).not.toBeInTheDocument()

    await waitFor(() => expect(releaseInstalled).not.toBeNull())
    releaseInstalled?.()

    await waitFor(() => expect(screen.getByTestId('swap-keep')).toBeInTheDocument())
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      t('storySettings:swap.optionsTitle', { model: GEMMA_LABEL }),
    )
  },
}

export const PreseatBackSurvivesCandidateRefresh: Story = {
  args: { storyId: STORY_ID, settings: buildSettings(), listInstalled },
  beforeEach: () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    openEmbedderSwapDialog(STORY_ID, GEMMA)
  },
  play: async () => {
    await screen.findByTestId('swap-keep')
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.back') }))
    expect(await screen.findByTestId(`swap-candidate-local:${GEMMA}`)).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // A fresh candidates array re-runs the pre-seat effect; only its latch stops a re-seat.
    await seedEmbeddingDefault(APP_DEFAULT)
    // The act-wrapped click drains any pending re-seat before the DOM is read.
    const providerRow = await screen.findByTestId(
      `swap-candidate-provider:prov_local:${APP_DEFAULT}`,
    )
    await userEvent.click(providerRow)
    expect(providerRow).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('swap-keep')).not.toBeInTheDocument()
  },
}

export const PreseatPrefersTheAppDefaultsOwnCopy: Story = {
  // MiniLM is installed locally and is also the provider default; with the story on Gemma
  // both copies are eligible, and only the app default's backend tells them apart.
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embedding_model_id: GEMMA }),
    listInstalled,
  },
  beforeEach: async () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    await seedEmbeddingDefault(MINILM)
    openEmbedderSwapDialog(STORY_ID, MINILM)
  },
  play: async () => {
    await screen.findByTestId('swap-keep')
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.back') }))
    expect(
      await screen.findByTestId(`swap-candidate-provider:prov_local:${MINILM}`),
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId(`swap-candidate-local:${MINILM}`)).toHaveAttribute(
      'aria-checked',
      'false',
    )
  },
}

export const PreseatPrefersALocalDefaultOverTheProviderCopy: Story = {
  // The provider row exists before the installed list lands; seating on it then would
  // latch the wrong copy of a local default.
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embedding_model_id: GEMMA }),
    listInstalled,
  },
  beforeEach: async () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    await seedEmbeddingDefault(MINILM, 'local')
    openEmbedderSwapDialog(STORY_ID, MINILM)
  },
  play: async () => {
    await screen.findByTestId('swap-keep')
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.back') }))
    expect(await screen.findByTestId(`swap-candidate-local:${MINILM}`)).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByTestId(`swap-candidate-provider:prov_local:${MINILM}`)).toHaveAttribute(
      'aria-checked',
      'false',
    )
  },
}

export const PreseatNeverSeatsTheProviderCopyOfALocalDefault: Story = {
  // The listing fails, so the local default's own row never lands; the provider copy shares
  // its id and label, and seating on it would re-index the story off-device.
  args: {
    storyId: STORY_ID,
    settings: buildSettings({ embedding_model_id: GEMMA }),
    listInstalled: failingListInstalled,
  },
  beforeEach: async () => {
    resetStores()
    embeddingStatusStore.setStatus(STORY_ID, 0)
    await seedEmbeddingDefault(MINILM, 'local')
    openEmbedderSwapDialog(STORY_ID, MINILM)
  },
  play: async () => {
    // A seat always selects a row and leaves the pick stage; neither happened.
    const providerRow = await screen.findByTestId(`swap-candidate-provider:prov_local:${MINILM}`)
    expect(providerRow).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('swap-reindex')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('storySettings:swap.next') })).toBeDisabled()
  },
}

const declineOk = () =>
  fn(async (): Promise<UpdateStorySettingsResult> => ({ status: 'ok', settings: buildSettings() }))

function keepStory(
  declineUpgrade: DeclineEmbeddingUpgradeFn,
  appDefault: string | null,
  settings: StorySettings = buildSettings(),
): Pick<Story, 'args' | 'beforeEach'> {
  return {
    args: { storyId: STORY_ID, settings, listInstalled, declineUpgrade },
    beforeEach: async () => {
      resetStores()
      embeddingStatusStore.setStatus(STORY_ID, 0)
      await seedEmbeddingDefault(appDefault)
    },
  }
}

function declineSpy(declineUpgrade: DeclineEmbeddingUpgradeFn | undefined) {
  if (declineUpgrade == null) throw new Error('Keep stories inject declineUpgrade')
  return mocked(declineUpgrade)
}

// subscribe hands the listener the current queue synchronously.
function currentToasts(): readonly ToastItem[] {
  let items: readonly ToastItem[] = []
  toastStore.subscribe((next) => {
    items = next
  })()
  return items
}

// GEMMA is neither the story's model nor the app default, so the recorded value tells them apart.
async function keepAfterPickingGemma() {
  await userEvent.click(
    await screen.findByRole('button', { name: t('storySettings:memory.switchEmbedder') }),
  )
  await userEvent.click(await screen.findByTestId(`swap-candidate-local:${GEMMA}`))
  await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
  await userEvent.click(await screen.findByTestId('swap-keep'))
  await waitFor(() => expect(screen.queryByTestId('swap-keep')).not.toBeInTheDocument())
}

export const KeepDeclinesTheAppDefault: Story = {
  ...keepStory(declineOk(), APP_DEFAULT),
  play: async ({ args }) => {
    await keepAfterPickingGemma()
    const decline = declineSpy(args.declineUpgrade)
    expect(decline).toHaveBeenCalledTimes(1)
    expect(decline).toHaveBeenCalledWith(STORY_ID, APP_DEFAULT)
    // The panel's `.then` was attached first, so it has run once this settles.
    await decline.mock.results[0]?.value
    expect(currentToasts()).toEqual([])
  },
}

const keepWritesNothing: Story['play'] = async ({ args }) => {
  // The dialog closing proves Keep ran; with no default there is nothing to decline.
  await keepAfterPickingGemma()
  expect(args.declineUpgrade).not.toHaveBeenCalled()
}

export const KeepWithNoAppDefaultWritesNothing: Story = {
  ...keepStory(declineOk(), null),
  play: keepWritesNothing,
}

export const KeepWithBlankAppDefaultWritesNothing: Story = {
  ...keepStory(declineOk(), '   '),
  play: keepWritesNothing,
}

export const KeepWithTheAppDefaultAlreadyDeclinedWritesNothing: Story = {
  ...keepStory(
    declineOk(),
    APP_DEFAULT,
    buildSettings({ embedding_upgrade_declined: APP_DEFAULT }),
  ),
  play: keepWritesNothing,
}

export const KeepRejectedShowsToast: Story = {
  ...keepStory(
    fn(
      async (): Promise<UpdateStorySettingsResult> => ({
        status: 'rejected',
        reason: 'generation in flight',
      }),
    ),
    APP_DEFAULT,
  ),
  play: async ({ args }) => {
    await keepAfterPickingGemma()
    expect(args.declineUpgrade).toHaveBeenCalledWith(STORY_ID, APP_DEFAULT)
    expect(await screen.findByText(t('storySettings:upgrade.keepFailed'))).toBeInTheDocument()
  },
}

export const KeepFailureReportsEngineError: Story = {
  ...keepStory(
    fn(async (): Promise<UpdateStorySettingsResult> => {
      throw new Error('database unavailable')
    }),
    APP_DEFAULT,
  ),
  play: async () => {
    await keepAfterPickingGemma()
    expect(await screen.findByText(t('storySettings:memory.actionFailed'))).toBeInTheDocument()
  },
}

export const KeepStaleStoreIsNotAFailure: Story = {
  // The decline landed and only the store re-read failed.
  ...keepStory(
    fn(async (): Promise<UpdateStorySettingsResult> => {
      throw new StorySettingsStaleStoreError()
    }),
    APP_DEFAULT,
  ),
  play: async () => {
    await keepAfterPickingGemma()
    expect(await screen.findByText(t('storySettings:save.stale'))).toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:memory.actionFailed'))).not.toBeInTheDocument()
  },
}
