import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { SaveBar } from '@/components/compounds/save-bar'
import { SwitchRow } from '@/components/compounds/switch-row'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'

import { StorySettingsShell, type RailGroup } from './story-settings-shell'

type TabId =
  | 'about'
  | 'generation'
  | 'models'
  | 'memory'
  | 'translation'
  | 'pack'
  | 'calendar'
  | 'advanced'

const GROUPS: RailGroup<TabId>[] = [
  {
    id: 'story',
    header: 'Story',
    tabs: [
      { id: 'about', label: 'About' },
      { id: 'generation', label: 'Generation' },
    ],
  },
  {
    id: 'settings',
    header: 'Settings',
    tabs: [
      { id: 'models', label: 'Models' },
      { id: 'memory', label: 'Memory' },
      { id: 'translation', label: 'Translation' },
      { id: 'pack', label: 'Pack' },
      { id: 'calendar', label: 'Calendar' },
      { id: 'advanced', label: 'Advanced' },
    ],
  },
]

const PLACEHOLDER_TITLE = 'Lands in a later milestone'
const TAB_COUNT = GROUPS.flatMap((group) => group.tabs).length

const noop = () => {}

function Placeholder() {
  return (
    <EmptyState
      title={PLACEHOLDER_TITLE}
      subtext="This tab isn't built yet. Nothing here is configurable."
    />
  )
}

function MemoryPanel() {
  return (
    <View className="gap-1">
      <Text className="font-medium">Chapter memory</Text>
      <SwitchRow
        label="Full-chapter recall"
        hint="Send the whole open chapter instead of the recent tail."
        checked
        onCheckedChange={noop}
      />
      <SwitchRow
        label="Resolve stale entities before generating"
        hint="Pauses generation when a pinned entity drifted out of date."
        checked={false}
        onCheckedChange={noop}
      />
    </View>
  )
}

function GenerationPanel() {
  return (
    <View className="gap-1">
      <Text className="font-medium">Authoring aids</Text>
      <SwitchRow
        label="Suggestions"
        hint="Offer next-move suggestions after each beat."
        checked
        onCheckedChange={noop}
      />
      <SwitchRow
        label="Composer modes"
        hint="Wrap plain input in the story's narration point of view."
        checked={false}
        onCheckedChange={noop}
      />
    </View>
  )
}

const meta: Meta<typeof StorySettingsShell<TabId, null>> = {
  title: 'Shells/StorySettingsShell',
  component: StorySettingsShell,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <View style={{ height: 620 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

/**
 * Every canonical tab renders the M3 placeholder. The play function
 * pins the shell's core invariant: all eight panels are mounted, not
 * just the active one — a section's draft has to survive a tab switch
 * because the whole surface is one save session.
 */
export const PlaceholderTab: Story = {
  args: {
    groups: GROUPS,
    activeTab: 'pack',
    onSelectTab: fn(),
    panelData: null,
    renderPanel: () => <Placeholder />,
  },
  play: async ({ args }) => {
    await expect(screen.findAllByText(PLACEHOLDER_TITLE)).resolves.toHaveLength(TAB_COUNT)
    expect(screen.getByRole('tab', { name: 'Pack' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: 'Memory' }))
    await waitFor(() => expect(args.onSelectTab).toHaveBeenCalledWith('memory'))
  },
}

/**
 * One filled tab beside seven placeholders — the M3 shape, where only
 * the sections this milestone ships have bodies.
 */
export const FilledTab: Story = {
  args: {
    groups: GROUPS,
    activeTab: 'memory',
    onSelectTab: fn(),
    panelData: null,
    renderPanel: (id) => (id === 'memory' ? <MemoryPanel /> : <Placeholder />),
  },
  play: async () => {
    await expect(screen.findByText('Chapter memory')).resolves.toBeInTheDocument()
    expect(screen.getAllByText(PLACEHOLDER_TITLE)).toHaveLength(TAB_COUNT - 1)
  },
}

/**
 * Dirty session — the route mounts the SaveBar as a flex footer under
 * the panel scroller, so it stays put while the panel scrolls.
 */
export const DirtySession: Story = {
  args: {
    groups: GROUPS,
    activeTab: 'generation',
    onSelectTab: fn(),
    panelData: null,
    renderPanel: (id) => (id === 'generation' ? <GenerationPanel /> : <Placeholder />),
    saveBar: (
      <SaveBar dirtyFields={['suggestions', 'suggestion count']} onSave={noop} onDiscard={noop} />
    ),
  },
  play: async () => {
    await expect(screen.findByText(/2 unsaved changes\b/)).resolves.toBeInTheDocument()
  },
}

// Panel-local draft state — the whole point of the harness. If the
// shell swapped panels instead of hiding them, this `useState` would
// reset on every tab switch and the typed draft would be gone.
function DraftPanel() {
  const [draft, setDraft] = useState('')
  return <Input placeholder="Story title" value={draft} onChangeText={setDraft} />
}

/**
 * Draft survival across a tab switch, end to end: type into About,
 * move to Memory, come back. Same DOM node, same value — the About
 * panel was hidden, never unmounted.
 */
export const DraftSurvivesTabSwitch: Story = {
  render: function DraftHarness() {
    const [activeTab, setActiveTab] = useState<TabId>('about')
    return (
      <StorySettingsShell<TabId, null>
        groups={GROUPS}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        panelData={null}
        renderPanel={(id) => (id === 'about' ? <DraftPanel /> : <Placeholder />)}
      />
    )
  },
  play: async () => {
    const input = screen.getByPlaceholderText('Story title')
    await userEvent.type(input, 'Aria')

    await userEvent.click(screen.getByRole('tab', { name: 'Memory' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Memory' })).toHaveAttribute('aria-selected', 'true'),
    )
    expect(screen.getByPlaceholderText('Story title')).toBe(input)
    expect(input).toHaveValue('Aria')

    await userEvent.click(screen.getByRole('tab', { name: 'About' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true'),
    )
    expect(screen.getByPlaceholderText('Story title')).toBe(input)
    expect(input).toHaveValue('Aria')
  },
}
