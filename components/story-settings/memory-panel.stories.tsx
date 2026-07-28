import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { APP_SETTINGS_DEFAULTS, storySettingsSchema, type StorySettings } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  appSettingsStore,
  embedderSwapStore,
  embeddingStatusStore,
  hydrateAppSettings,
  openEmbedderSwapDialog,
} from '@/lib/stores'

import { MemoryPanel } from './memory-panel'

const STORY_ID = 'story-1'
const MINILM = 'Xenova/all-MiniLM-L6-v2'
const GEMMA = 'onnx-community/embeddinggemma-300m-ONNX'

function buildSettings(overrides: Partial<StorySettings> = {}): StorySettings {
  return storySettingsSchema.parse({
    classifierCadence: 4,
    piggybackMode: 'on',
    embeddingBackend: 'local',
    embedding_model_id: MINILM,
    retrievalBudgets: { entities: 8, lore: 6, happenings: 6, threads: 4, chapters: 3 },
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

const listInstalled = async () => [
  { id: MINILM, sizeBytes: 90_000_000 },
  { id: GEMMA, sizeBytes: 300_000_000 },
]

function resetStores() {
  embedderSwapStore.__reset()
  embeddingStatusStore.__reset()
  appSettingsStore.__reset()
}

// MemoryPanel reads three module-global Zustand stores directly (swap
// dialog/progress, stale-count, and app-settings defaults) — each story
// resets and re-seeds them so a prior story's picks never leak forward.
const meta: Meta<typeof MemoryPanel> = {
  title: 'Compounds/StorySettings/MemoryPanel',
  component: MemoryPanel,
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
    expect(screen.queryByTestId('swap-resume')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('storySettings:memory.switchEmbedder'), hidden: true }),
    ).toBeDisabled()
    expect(screen.getByTestId('reindex-now')).toBeDisabled()
    await userEvent.click(cancel)
    await waitFor(() => expect(embedderSwapStore.isCancelRequested()).toBe(true))
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
    expect(screen.getByTestId('swap-resume')).toBeInTheDocument()
    expect(screen.getByTestId('swap-cancel-swap')).toBeInTheDocument()
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
    await hydrateAppSettings(async () => ({
      ...APP_SETTINGS_DEFAULTS,
      providers: [
        {
          id: 'prov_local',
          type: 'openai-compatible',
          displayName: 'Local',
          apiKey: '',
          endpoint: 'http://localhost:1234/v1',
          favoriteModelIds: [],
        },
      ],
      embeddingProviderId: 'prov_local',
      embeddingModelId: MINILM,
    }))
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
