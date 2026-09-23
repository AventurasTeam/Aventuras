import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import type { StorySettingsSessionPatch } from '@/lib/actions'
import { storyInfoPatchSchema, type StoryDefinition, type StoryInfo } from '@/lib/db'
import { t } from '@/lib/i18n'

import { ACCENT_SWATCHES } from './about-draft'
import { AboutPanel } from './about-panel'
import { externalCell } from './external-cell'
import { StorySettingsSaveSessionProvider } from './save-session'
import { StorySettingsSaveBar } from './save-session-chrome'

const STORY: StoryInfo = {
  title: 'The Veilstone Courier',
  description: 'A courier, a stolen amulet, a city that never dried out.',
  tags: ['noir', 'rain'],
  accentColor: null,
  status: 'active',
  favorite: 0,
}

const DEFINITION: StoryDefinition = {
  mode: 'adventure',
  leadEntityId: 'ent-lead',
  narration: 'third',
  genre: { label: 'Noir', promptBody: '' },
  tone: { label: 'Bleak', promptBody: '' },
  setting: 'A harbour city.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 1948 },
}

type HarnessProps = {
  story: StoryInfo
  disabled?: boolean
  onCommit: (patch: StorySettingsSessionPatch) => Promise<unknown>
}

function Harness({ story, disabled = false, onCommit }: HarnessProps) {
  return (
    <View className="gap-4 rounded-md bg-bg-base p-4" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider onCommit={onCommit} confirmFlagged={false}>
        <AboutPanel
          story={story}
          definition={DEFINITION}
          disabled={disabled}
          disabledReason={disabled ? t('generationGate.inFlight') : undefined}
        />
        <StorySettingsSaveBar enabled blocked={disabled} />
      </StorySettingsSaveSessionProvider>
    </View>
  )
}

function StatefulHarness({ story: initial, onCommit }: HarnessProps) {
  const [cell] = useState(() => externalCell(initial))
  const story = useSyncExternalStore(cell.subscribe, cell.get)
  const commit = useCallback(
    async (patch: StorySettingsSessionPatch) => {
      await onCommit(patch)
      if (patch.columns == null) return
      const { favorite, ...columns } = storyInfoPatchSchema.parse(patch.columns)
      cell.set({
        ...cell.get(),
        ...columns,
        ...(favorite === undefined ? {} : { favorite: favorite ? 1 : 0 }),
      })
    },
    [cell, onCommit],
  )
  return (
    <View className="gap-4 rounded-md bg-bg-base p-4" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider onCommit={commit} confirmFlagged={false}>
        <AboutPanel story={story} definition={DEFINITION} />
        <StorySettingsSaveBar enabled />
      </StorySettingsSaveSessionProvider>
    </View>
  )
}

const COPY = {
  tags: t('storySettings:about.tags'),
  accentNone: t('storySettings:about.accentNone'),
  active: t('storySettings:about.statusActive'),
  archived: t('storySettings:about.statusArchived'),
  statusDraft: t('storySettings:about.statusDraft'),
  favorite: t('storySettings:about.favorite'),
  emptyTitle: t('storySettings:about.invalid.emptyTitle'),
  draftStory: t('storySettings:about.invalid.draftStory'),
  discard: t('saveBar.discard'),
}

function reasonOnTab(reason: string): string {
  return t('storySettings:save.invalidOnTab', { tab: t('storySettings:tabs.about'), reason })
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/StorySettings/AboutPanel',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { story: STORY, onCommit: fn(async () => {}) },
}
export default meta
type Story = StoryObj<typeof Harness>

export const Populated: Story = {
  play: async () => {
    expect(await screen.findByTestId('about-title')).toHaveValue(STORY.title)
    expect(screen.getByTestId('about-description')).toHaveValue(STORY.description)
    expect(screen.getByText('noir')).toBeInTheDocument()
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

export const TitleEditCommitsAColumnPatch: Story = {
  play: async ({ args }) => {
    const title = await screen.findByTestId('about-title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Renamed')
    const bar = await screen.findByTestId('save-bar')
    expect(bar).toHaveTextContent(t('storySettings:about.field.title'))
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({ columns: { title: 'Renamed' } }),
    )
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

// The store refreshes inside the commit, so the section must still recognise
// its own write afterwards and re-seed from the saved row.
export const SaveReseedsFromTheSavedRow: Story = {
  render: (args) => <StatefulHarness {...args} />,
  play: async ({ args }) => {
    const title = await screen.findByTestId('about-title')
    await userEvent.clear(title)
    await userEvent.type(title, '  Renamed  ')
    const bar = await screen.findByTestId('save-bar')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
    expect(screen.getByTestId('about-title')).toHaveValue('Renamed')
    expect(args.onCommit).toHaveBeenCalledWith({ columns: { title: 'Renamed' } })
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

export const BlankTitleBlocksSave: Story = {
  play: async () => {
    const title = await screen.findByTestId('about-title')
    await userEvent.clear(title)
    await userEvent.type(title, '   ')
    const bar = await screen.findByTestId('save-bar')
    await waitFor(() =>
      expect(within(bar).getByLabelText(reasonOnTab(COPY.emptyTitle))).toBeInTheDocument(),
    )
    expect(screen.getByText(COPY.emptyTitle)).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled()
  },
}

export const FavoriteAndStatus: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('switch', { name: COPY.favorite }))
    await userEvent.click(screen.getByRole('radio', { name: COPY.archived }))
    const bar = await screen.findByTestId('save-bar')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({
        columns: { status: 'archived', favorite: true },
      }),
    )
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

export const AccentNoneIsNull: Story = {
  args: { story: { ...STORY, accentColor: '#3b82f6' } },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByLabelText(COPY.accentNone))
    const bar = await screen.findByTestId('save-bar')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({ columns: { accentColor: null } }),
    )
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

export const DiscardResetsEveryField: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByTestId('about-title'), ' II')
    await userEvent.type(screen.getByTestId('about-description'), ' More.')
    await userEvent.type(screen.getByRole('textbox', { name: COPY.tags }), 'fog{Enter}')
    await userEvent.click(screen.getByRole('button', { name: ACCENT_SWATCHES[0] }))
    await userEvent.click(screen.getByRole('radio', { name: COPY.archived }))
    await userEvent.click(screen.getByRole('switch', { name: COPY.favorite }))

    const bar = await screen.findByTestId('save-bar')
    const allFields = [
      t('storySettings:about.field.title'),
      t('storySettings:about.field.description'),
      t('storySettings:about.field.tags'),
      t('storySettings:about.field.accentColor'),
      t('storySettings:about.field.status'),
      t('storySettings:about.field.favorite'),
    ].join(', ')
    await waitFor(() => expect(bar).toHaveTextContent(allFields))

    await userEvent.click(within(bar).getByRole('button', { name: COPY.discard }))

    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
    expect(screen.getByTestId('about-title')).toHaveValue(STORY.title)
    expect(screen.getByTestId('about-description')).toHaveValue(STORY.description)
    expect(screen.queryByText('fog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: COPY.accentNone })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('radio', { name: COPY.active })).toBeChecked()
    expect(screen.getByRole('switch', { name: COPY.favorite })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

// The save refuses every column patch on a draft, so an edit here must be
// refused up front with a reason rather than fail at commit.
export const DraftStoryStatusLocked: Story = {
  args: { story: { ...STORY, status: 'draft' } },
  play: async ({ args }) => {
    await screen.findByTestId('about-title')
    expect(screen.getByText(COPY.statusDraft)).toBeInTheDocument()
    for (const name of [COPY.active, COPY.archived]) {
      const radio = screen.getByRole('radio', { name })
      expect(radio).not.toBeChecked()
      expect(radio).toHaveAttribute('aria-disabled', 'true')
    }

    await userEvent.click(screen.getByRole('switch', { name: COPY.favorite }))
    const bar = await screen.findByTestId('save-bar')
    await waitFor(() =>
      expect(within(bar).getByLabelText(reasonOnTab(COPY.draftStory))).toBeInTheDocument(),
    )
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled()
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const Disabled: Story = {
  args: { disabled: true },
  play: async () => {
    expect(await screen.findByTestId('about-title')).toHaveAttribute('readonly')
    expect(screen.getByTestId('about-description')).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: COPY.tags })).toHaveAttribute('readonly')
    expect(screen.getByTestId('about-accent')).toHaveStyle({ pointerEvents: 'none' })
    for (const name of [COPY.active, COPY.archived]) {
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    expect(screen.getByRole('switch', { name: COPY.favorite })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}
