import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, mocked, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { Toaster } from '@/components/ui/toast'
import { StorySettingsStaleStoreError, type UpdateStorySettingsResult } from '@/lib/actions'
import { APP_SETTINGS_DEFAULTS, STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  appSettingsStore,
  currentStoryStore,
  embedderSwapStore,
  hydrateAppSettings,
  recoveryReportStore,
  type OpenStory,
} from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { EmbeddingUpgradeHost, type EmbeddingUpgradeHostProps } from './embedding-upgrade-host'

const STORY_ID = 'story-1'
const STORY_MODEL = 'Xenova/all-MiniLM-L6-v2'
const APP_DEFAULT = 'onnx-community/embeddinggemma-300m-ONNX'

const STORY: OpenStory = {
  storyId: STORY_ID,
  branchId: 'branch-1',
  definition: storyDefinitionSchema.parse({
    mode: 'adventure',
    leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
    narration: 'first',
    genre: { label: 'Fantasy', promptBody: 'high fantasy' },
    tone: { label: 'Wry', promptBody: 'wry' },
    setting: 'A keep on a hill.',
    calendarSystemId: 'gregorian',
    worldTimeOrigin: { year: 0 },
  }),
  settings: { ...STORY_SETTINGS_DEFAULTS, embedding_model_id: STORY_MODEL },
}

async function seedAppDefault(embeddingModelId: string) {
  const result = await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    embeddingModelId,
  }))
  if (result.status !== 'ok') throw new Error(`App settings seed rejected: ${result.error}`)
}

function resetStores() {
  currentStoryStore.__reset()
  appSettingsStore.__reset()
  embedderSwapStore.__reset()
  recoveryReportStore.__reset()
  toastStore.__reset()
}

// Renders what the host reads, so a play can wait for a store change to commit before
// asserting the prompt did NOT appear. Sound only while the host latches during render: a
// latch in an effect settles a pass later, after such a negative assertion has passed.
function StoreProbe() {
  const appDefault = appSettingsStore.useAppSettings((s) => s.embeddingModelId)
  const openSeq = currentStoryStore.useOpenSeq()
  return (
    <>
      <Text testID="probe-app-default">{appDefault ?? ''}</Text>
      <Text testID="probe-open-seq">{String(openSeq)}</Text>
    </>
  )
}

function Harness(props: EmbeddingUpgradeHostProps) {
  return (
    <>
      <EmbeddingUpgradeHost {...props} />
      <StoreProbe />
      <Toaster />
    </>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/Embedder/EmbeddingUpgradeHost',
  component: Harness,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof meta>

type DeclineUpgradeFn = NonNullable<EmbeddingUpgradeHostProps['declineUpgrade']>

const OK: UpdateStorySettingsResult = { status: 'ok', settings: STORY.settings }

const declineResolving = (result: UpdateStorySettingsResult) =>
  fn<DeclineUpgradeFn>(async () => result)

const declineThrowing = (error: Error) =>
  fn<DeclineUpgradeFn>(async () => {
    throw error
  })

// The story's model differs from the app default, so the gate is open at the open.
function openedOnOlderModel(
  declineUpgrade: DeclineUpgradeFn = declineResolving(OK),
): Pick<Story, 'args' | 'beforeEach'> {
  return {
    args: { declineUpgrade, navigate: fn() },
    beforeEach: async () => {
      resetStores()
      await seedAppDefault(APP_DEFAULT)
      currentStoryStore.open(STORY)
    },
  }
}

function declineSpy(declineUpgrade: DeclineUpgradeFn | undefined) {
  if (declineUpgrade == null) throw new Error('Host stories inject declineUpgrade')
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

const isDeferred = () => embedderSwapStore.getState().upgradeDeferred.has(STORY_ID)

async function press(action: 'upgrade' | 'keep' | 'later') {
  await userEvent.click(
    await screen.findByRole('button', { name: t(`storySettings:upgrade.${action}`) }),
  )
}

async function expectPromptClosed() {
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
}

export const ShowsOnOpen: Story = {
  ...openedOnOlderModel(),
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(STORY_MODEL)
    expect(dialog).toHaveTextContent(APP_DEFAULT)
  },
}

export const KeepDeclinesTheAppDefault: Story = {
  ...openedOnOlderModel(),
  play: async ({ args }) => {
    await press('keep')
    const decline = declineSpy(args.declineUpgrade)
    expect(decline).toHaveBeenCalledTimes(1)
    expect(decline).toHaveBeenCalledWith(STORY_ID, APP_DEFAULT)
    // The seam leaves the store's settings untouched, so the gate is still open here.
    await expectPromptClosed()
    // The host's `.then` was attached first, so it has run once this settles.
    await decline.mock.results[0]?.value
    expect(currentToasts()).toEqual([])
    expect(isDeferred()).toBe(false)
  },
}

export const KeepRejectedDefers: Story = {
  ...openedOnOlderModel(declineResolving({ status: 'rejected', reason: 'generation in flight' })),
  play: async () => {
    await press('keep')
    expect(await screen.findByText(t('storySettings:upgrade.keepFailed'))).toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:upgrade.keepError'))).not.toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:save.stale'))).not.toBeInTheDocument()
    expect(isDeferred()).toBe(true)
    await expectPromptClosed()
  },
}

export const KeepStaleStoreIsNotAFailure: Story = {
  // The decline landed and only the store re-read failed.
  ...openedOnOlderModel(declineThrowing(new StorySettingsStaleStoreError())),
  play: async () => {
    await press('keep')
    expect(await screen.findByText(t('storySettings:save.stale'))).toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:upgrade.keepFailed'))).not.toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:upgrade.keepError'))).not.toBeInTheDocument()
    expect(isDeferred()).toBe(false)
    await expectPromptClosed()
  },
}

export const KeepThrownDefers: Story = {
  ...openedOnOlderModel(declineThrowing(new Error('database unavailable'))),
  play: async () => {
    await press('keep')
    // Not a generation-in-flight rejection, so the copy must not blame one.
    expect(await screen.findByText(t('storySettings:upgrade.keepError'))).toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:upgrade.keepFailed'))).not.toBeInTheDocument()
    expect(screen.queryByText(t('storySettings:save.stale'))).not.toBeInTheDocument()
    expect(isDeferred()).toBe(true)
    await expectPromptClosed()
  },
}

export const LaterDefersForTheSession: Story = {
  ...openedOnOlderModel(),
  play: async ({ args }) => {
    await press('later')
    await expectPromptClosed()
    expect(isDeferred()).toBe(true)
    expect(args.declineUpgrade).not.toHaveBeenCalled()
    expect(args.navigate).not.toHaveBeenCalled()

    currentStoryStore.open(STORY)
    await waitFor(() => expect(screen.getByTestId('probe-open-seq')).toHaveTextContent('2'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

export const DefaultChangedMidOpenWaitsForNextOpen: Story = {
  args: { declineUpgrade: declineResolving(OK), navigate: fn() },
  beforeEach: async () => {
    resetStores()
    await seedAppDefault(STORY_MODEL)
    currentStoryStore.open(STORY)
  },
  play: async () => {
    expect(await screen.findByTestId('probe-app-default')).toHaveTextContent(STORY_MODEL)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await seedAppDefault(APP_DEFAULT)
    await waitFor(() =>
      expect(screen.getByTestId('probe-app-default')).toHaveTextContent(APP_DEFAULT),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    currentStoryStore.open(STORY)
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(APP_DEFAULT)
  },
}

export const UpgradeOpensTheSwapDialog: Story = {
  ...openedOnOlderModel(),
  play: async ({ args }) => {
    await press('upgrade')
    expect(args.navigate).toHaveBeenCalledTimes(1)
    expect(args.navigate).toHaveBeenCalledWith(`/story-settings/${STORY_ID}?tab=memory`)
    expect(embedderSwapStore.getState().dialog).toEqual({
      storyId: STORY_ID,
      preselectModelId: APP_DEFAULT,
    })
    // Not deferred and nothing written, so only the latch's dismissal closes it.
    await expectPromptClosed()
    expect(args.declineUpgrade).not.toHaveBeenCalled()
    expect(isDeferred()).toBe(false)
  },
}
