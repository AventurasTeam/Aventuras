import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Toaster } from '@/components/ui/toast'
import type { StorySettingsSessionPatch } from '@/lib/actions'
import {
  APP_SETTINGS_DEFAULTS,
  STORY_AGENT_IDS,
  STORY_SETTINGS_DEFAULTS,
  type ModelProfile,
  type ProviderInstance,
  type StorySettings,
} from '@/lib/db'
import { t } from '@/lib/i18n'
import { appSettingsStore, hydrateAppSettings } from '@/lib/stores'
import { toastStore } from '@/lib/toast'

import { ModelsPanel } from './models-panel'
import { StorySettingsSaveSessionProvider } from './save-session'
import { StorySettingsSaveBar } from './save-session-chrome'

const PROVIDER: ProviderInstance = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: '',
  favoriteModelIds: [],
  cachedModels: [{ id: 'seed/narrative' }, { id: 'seed/fast' }],
}
const NARRATIVE: ModelProfile = {
  id: 'prof-narr',
  kind: 'narrative',
  name: 'Storyteller',
  modelRef: { providerId: 'prov-1', modelId: 'seed/narrative' },
}
const FAST: ModelProfile = {
  id: 'prof-fast',
  kind: 'agent',
  name: 'Fast tasks',
  modelRef: { providerId: 'prov-1', modelId: 'seed/fast' },
}

async function seedAppSettings(overrides: Record<string, unknown> = {}) {
  appSettingsStore.__reset()
  const result = await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    providers: [PROVIDER],
    profiles: [NARRATIVE, FAST],
    assignments: { classifier: 'prof-fast' },
    defaultProviderId: 'prov-1',
    ...overrides,
  }))
  // A rejected seed leaves the empty defaults the broken-chain and no-provider plays expect.
  if (result.status !== 'ok') throw new Error(`App settings seed rejected: ${result.error}`)
}

function settings(models: StorySettings['models'] = {}): StorySettings {
  return { ...STORY_SETTINGS_DEFAULTS, models }
}

type HarnessProps = {
  settings: StorySettings
  disabled?: boolean
  onCommit: (patch: StorySettingsSessionPatch) => Promise<unknown>
}

function Harness({ settings: storySettings, disabled = false, onCommit }: HarnessProps) {
  return (
    <View className="gap-4 rounded-md bg-bg-base p-4" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider onCommit={onCommit} confirmFlagged={false}>
        <ModelsPanel
          settings={storySettings}
          disabled={disabled}
          disabledReason={disabled ? t('generationGate.inFlight') : undefined}
        />
        <StorySettingsSaveBar enabled blocked={disabled} />
      </StorySettingsSaveSessionProvider>
      <Toaster />
    </View>
  )
}

type SettingsCell = {
  get: () => StorySettings
  set: (next: StorySettings) => void
  subscribe: (listener: () => void) => () => void
}

function settingsCell(initial: StorySettings): SettingsCell {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (next) => {
      current = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// An external store like `storiesStore`, not useState: only a store refresh
// re-renders before the provider's post-commit re-read, as the real one does.
function StatefulHarness({ settings: initial, onCommit }: HarnessProps) {
  const [cell] = useState(() => settingsCell(initial))
  const current = useSyncExternalStore(cell.subscribe, cell.get)
  const commit = useCallback(
    async (patch: StorySettingsSessionPatch) => {
      await onCommit(patch)
      cell.set({ ...cell.get(), ...patch.settings })
    },
    [cell, onCommit],
  )
  return (
    <View className="gap-4 rounded-md bg-bg-base p-4" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider onCommit={commit} confirmFlagged={false}>
        <ModelsPanel settings={current} />
        <StorySettingsSaveBar enabled />
      </StorySettingsSaveSessionProvider>
      <Toaster />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/StorySettings/ModelsPanel',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { settings: settings(), onCommit: fn(async () => {}) },
  beforeEach: async () => {
    // Before mount: __reset drops listeners, and a leftover toast would satisfy a later play.
    toastStore.__reset()
    await seedAppSettings()
  },
}
export default meta
type Story = StoryObj<typeof Harness>

const COPY = {
  pickModel: t('storySettings:models.pickModel'),
  addOverride: t('storySettings:models.addOverride'),
  addOverrideLabel: t('storySettings:models.addOverrideLabel'),
  narrativeField: t('storySettings:models.field.narrative'),
  classifierField: t('storySettings:models.field.classifier'),
  narrative: t('storySettings:models.narrative'),
  classifier: t('storySettings:models.agent.classifier'),
  providerMissing: t('storySettings:models.overrideProviderMissing'),
  noProviders: t('storySettings:models.noProviders'),
  inFlight: t('generationGate.inFlight'),
  addCustom: t('modelPicker.addCustomExpand'),
  customIdPlaceholder: t('modelPicker.modelIdPlaceholder'),
  addCustomConfirm: t('modelPicker.add'),
  // Popover nests an unnamed Radix wrapper around the picker's own named dialog.
  pickerDialog: t('modelPicker.placeholder'),
  favoriteAdd: t('modelPicker.favoriteAdd'),
  writeFailed: t('storySettings:models.providerWriteFailed'),
}

const SENTINEL = t('storySettings:models.appDefault', {
  model: 'seed/narrative',
  profile: 'Storyteller',
})
const CLASSIFIER_SENTINEL = t('storySettings:models.appDefault', {
  model: 'seed/fast',
  profile: 'Fast tasks',
})

const clearLabel = (target: string) => t('storySettings:models.clearOverride', { target })
const removeLabel = (target: string) => t('storySettings:models.removeRow', { target })
const selectedModel = (modelId: string) => t('modelPicker.selectedModel', { modelId })

async function openPicker(row: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(within(row).getByRole('button', { name: COPY.pickModel }))
  return screen.findByRole('dialog', { name: COPY.pickerDialog })
}

async function closePicker() {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

async function pickModel(row: HTMLElement, modelId: string) {
  const dialog = await openPicker(row)
  await userEvent.click(within(dialog).getByRole('option', { name: new RegExp(modelId) }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

async function addCustomModel(dialog: HTMLElement, modelId: string) {
  await userEvent.click(within(dialog).getByRole('button', { name: COPY.addCustom }))
  await userEvent.type(within(dialog).getByPlaceholderText(COPY.customIdPlaceholder), modelId)
  await userEvent.click(within(dialog).getByRole('button', { name: COPY.addCustomConfirm }))
}

async function addOverrideRow(agentLabel: string) {
  await userEvent.click(screen.getByRole('button', { name: COPY.addOverrideLabel }))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(agentLabel) }))
}

// The save bar's summary is a status region too; the toast is the one carrying the copy.
function writeFailedToast(): HTMLElement | undefined {
  return screen.queryAllByRole('status').find((el) => el.textContent?.includes(COPY.writeFailed))
}

async function save() {
  const bar = await screen.findByTestId('save-bar')
  await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
}

export const NarrativeSentinel: Story = {
  play: async () => {
    const row = await screen.findByTestId('model-row-narrative')
    expect(row).toHaveTextContent(SENTINEL)
    // Agent rows exist only once overridden; narrative's × only once pinned.
    expect(screen.queryByTestId('model-row-classifier')).not.toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: clearLabel(COPY.narrative) }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

export const BrokenChainSentinel: Story = {
  beforeEach: async () => {
    await seedAppSettings({ profiles: [] })
  },
  play: async () => {
    const row = await screen.findByTestId('model-row-narrative')
    expect(row).toHaveTextContent(t('storySettings:models.broken.no-profile-assigned'))
  },
}

export const PinNarrativeOverride: Story = {
  play: async ({ args }) => {
    const row = await screen.findByTestId('model-row-narrative')
    await pickModel(row, 'seed/fast')
    expect(within(row).getByRole('button', { name: selectedModel('seed/fast') })).toBeVisible()
    expect(row).not.toHaveTextContent(SENTINEL)
    const bar = await screen.findByTestId('save-bar')
    expect(bar).toHaveTextContent(COPY.narrativeField)
    await save()
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({
        settings: { models: { narrative: { providerId: 'prov-1', modelId: 'seed/fast' } } },
      }),
    )
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

export const ClearOverrideRestoresSentinel: Story = {
  args: { settings: settings({ narrative: { providerId: 'prov-1', modelId: 'seed/fast' } }) },
  play: async ({ args }) => {
    const row = await screen.findByTestId('model-row-narrative')
    expect(row).not.toHaveTextContent(SENTINEL)
    await userEvent.click(within(row).getByRole('button', { name: clearLabel(COPY.narrative) }))
    expect(row).toHaveTextContent(SENTINEL)
    await save()
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith({ settings: { models: {} } }))
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

export const AddOverrideOffersStoryAgentsOnly: Story = {
  play: async () => {
    await screen.findByTestId('model-row-narrative')
    await userEvent.click(screen.getByRole('button', { name: COPY.addOverrideLabel }))
    const options = await screen.findAllByRole('option')
    // Exactly the story agents: `wizard-assist` is global and has no story slot.
    expect(options).toHaveLength(STORY_AGENT_IDS.length)
    for (const agent of STORY_AGENT_IDS) {
      const label = t(`storySettings:models.agent.${agent}`)
      expect(options.some((option) => option.textContent?.includes(label))).toBe(true)
    }
    const classifier = screen.getByRole('option', { name: new RegExp(COPY.classifier) })
    // Each offer shows the chain it would override.
    expect(classifier).toHaveTextContent(CLASSIFIER_SENTINEL)
    await userEvent.click(classifier)
    expect(await screen.findByTestId('model-row-classifier')).toHaveTextContent(CLASSIFIER_SENTINEL)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.addOverrideLabel })).toHaveTextContent(
        COPY.addOverride,
      ),
    )
    // The same trigger, not a remount: focus stays for the next add.
    expect(screen.getByRole('button', { name: COPY.addOverrideLabel })).toHaveFocus()
    // A row with no model yet is not an override, so nothing is unsaved.
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

export const ClearUnpickedRowReturnsAgentToOffer: Story = {
  play: async () => {
    await screen.findByTestId('model-row-narrative')
    await addOverrideRow(COPY.classifier)
    const row = await screen.findByTestId('model-row-classifier')
    await userEvent.click(within(row).getByRole('button', { name: removeLabel(COPY.classifier) }))
    await waitFor(() =>
      expect(screen.queryByTestId('model-row-classifier')).not.toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: COPY.addOverrideLabel }))
    expect(
      await screen.findByRole('option', { name: new RegExp(COPY.classifier) }),
    ).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

export const AddClassifierOverride: Story = {
  play: async ({ args }) => {
    await screen.findByTestId('model-row-narrative')
    await addOverrideRow(COPY.classifier)
    const row = await screen.findByTestId('model-row-classifier')
    await pickModel(row, 'seed/narrative')
    const bar = await screen.findByTestId('save-bar')
    expect(bar).toHaveTextContent(COPY.classifierField)
    expect(bar).not.toHaveTextContent(COPY.narrativeField)
    await save()
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({
        settings: {
          models: { classifier: { providerId: 'prov-1', modelId: 'seed/narrative' } },
        },
      }),
    )
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

export const AddCustomModelPinsDespiteFailedWrite: Story = {
  play: async ({ args }) => {
    const row = await screen.findByTestId('model-row-narrative')
    await addCustomModel(await openPicker(row), 'my/tune')
    // Storybook has no DB bridge, so the provider write always fails here.
    await waitFor(() => expect(writeFailedToast()).toBeDefined())
    await closePicker()
    expect(within(row).getByRole('button', { name: selectedModel('my/tune') })).toBeVisible()
    await save()
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({
        settings: { models: { narrative: { providerId: 'prov-1', modelId: 'my/tune' } } },
      }),
    )
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

export const AddListedModelPinsWithoutWriting: Story = {
  play: async ({ args }) => {
    const row = await screen.findByTestId('model-row-narrative')
    await addCustomModel(await openPicker(row), 'seed/fast')
    await closePicker()
    expect(within(row).getByRole('button', { name: selectedModel('seed/fast') })).toBeVisible()
    await save()
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({
        settings: { models: { narrative: { providerId: 'prov-1', modelId: 'seed/fast' } } },
      }),
    )
    // Checked after the save round-trip: every provider write fails here, so a
    // toast would mean the already-listed id was written again.
    expect(writeFailedToast()).toBeUndefined()
  },
}

export const FavoriteToggleLeavesTheStoryAlone: Story = {
  play: async () => {
    const row = await screen.findByTestId('model-row-narrative')
    const dialog = await openPicker(row)
    const option = within(dialog).getByRole('option', { name: /seed\/fast/ })
    await userEvent.click(within(option).getByRole('button', { name: COPY.favoriteAdd }))
    // The provider write was attempted: it always fails in Storybook.
    await waitFor(() => expect(writeFailedToast()).toBeDefined())
    // provider-model-picker.md → Row click semantics: a star toggle keeps the picker open.
    expect(screen.getByRole('dialog', { name: COPY.pickerDialog })).toBeInTheDocument()
    await closePicker()
    expect(within(row).getByRole('button', { name: COPY.pickModel })).toBeVisible()
    expect(row).toHaveTextContent(SENTINEL)
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

export const SaveRederivesFromRefreshedSettings: Story = {
  render: (args) => <StatefulHarness {...args} />,
  play: async ({ args }) => {
    const narrative = await screen.findByTestId('model-row-narrative')
    await addOverrideRow(COPY.classifier)
    await screen.findByTestId('model-row-classifier')
    await pickModel(narrative, 'seed/fast')
    await save()
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
    expect(args.onCommit).toHaveBeenCalledOnce()
    // The post-save reset re-derived the draft from the refreshed row: the pin
    // survives and the row that never named a model is dropped.
    await waitFor(() =>
      expect(screen.queryByTestId('model-row-classifier')).not.toBeInTheDocument(),
    )
    expect(
      within(narrative).getByRole('button', { name: selectedModel('seed/fast') }),
    ).toBeVisible()
  },
}

export const OverrideProviderMissing: Story = {
  args: { settings: settings({ classifier: { providerId: 'gone', modelId: 'x' } }) },
  play: async () => {
    const row = await screen.findByTestId('model-row-classifier')
    expect(row).toHaveTextContent(COPY.providerMissing)
    expect(row).not.toHaveTextContent(CLASSIFIER_SENTINEL)
    // Still clearable: clearing is how the user fixes it.
    await userEvent.click(within(row).getByRole('button', { name: clearLabel(COPY.classifier) }))
    await waitFor(() =>
      expect(screen.queryByTestId('model-row-classifier')).not.toBeInTheDocument(),
    )
    expect(await screen.findByTestId('save-bar')).toHaveTextContent(COPY.classifierField)
  },
}

export const NoProviders: Story = {
  beforeEach: async () => {
    await seedAppSettings({ providers: [], profiles: [], assignments: {}, defaultProviderId: null })
  },
  play: async () => {
    const row = await screen.findByTestId('model-row-narrative')
    expect(screen.getByText(COPY.noProviders)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: COPY.pickModel })).toBeDisabled()
    expect(screen.getByRole('button', { name: COPY.addOverrideLabel })).toBeDisabled()
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    settings: settings({ classifier: { providerId: 'prov-1', modelId: 'seed/narrative' } }),
  },
  play: async () => {
    const narrative = await screen.findByTestId('model-row-narrative')
    expect(within(narrative).getByRole('button', { name: COPY.pickModel })).toBeDisabled()
    const classifier = screen.getByTestId('model-row-classifier')
    expect(
      within(classifier).getByRole('button', { name: selectedModel('seed/narrative') }),
    ).toBeDisabled()
    // A disabled IconAction takes its reason as its accessible name.
    expect(within(classifier).getByRole('button', { name: COPY.inFlight })).toBeDisabled()
    expect(screen.getByRole('button', { name: COPY.addOverrideLabel })).toBeDisabled()
  },
}
