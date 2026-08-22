import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent } from 'storybook/test'

import { useRegisteredSheet } from '@/hooks/use-registered-sheet'

import { ActionsMenu, type ActionGroup } from './actions-menu'
import { Text } from '../ui/text'

const noop = () => undefined

const GO_TO: ActionGroup = {
  id: 'go-to',
  header: 'Go to',
  entries: [
    { id: 'open-world', label: 'Open World', onActivate: noop },
    { id: 'open-plot', label: 'Open Plot', onActivate: noop },
    { id: 'open-chapter-timeline', label: 'Open Chapter Timeline', onActivate: noop },
    { id: 'open-story-settings', label: 'Open Story Settings', onActivate: noop },
  ],
}

const STORY_TOOLS: ActionGroup = {
  id: 'story-tools',
  header: 'Story tools',
  entries: [
    { id: 'set-lead', label: 'Set lead character…', onActivate: noop },
    { id: 'flip-era', label: 'Flip era…', onActivate: noop },
    { id: 'close-chapter', label: 'Close chapter…', onActivate: noop },
  ],
}

const APP: ActionGroup = {
  id: 'app',
  header: 'App',
  entries: [
    { id: 'return-library', label: 'Return to Library', onActivate: noop },
    { id: 'open-app-settings', label: 'Open App Settings', onActivate: noop },
    { id: 'open-diagnostics', label: 'Open Diagnostics Hub', onActivate: noop },
  ],
}

const READER_CONTEXT: ActionGroup = {
  id: 'reader-context',
  header: 'On this screen',
  entries: [{ id: 'jump-bottom', label: 'Jump to bottom', onActivate: noop }],
}

const WORLD_CONTEXT: ActionGroup = {
  id: 'world-context',
  header: 'On this screen',
  entries: [
    { id: 'add-entity', label: 'Add entity…', onActivate: noop },
    { id: 'add-lore', label: 'Add lore…', onActivate: noop },
  ],
}

const STORY_LIST_CONTEXT: ActionGroup = {
  id: 'story-list-context',
  header: 'On this screen',
  entries: [
    { id: 'new-story', label: 'New story…', onActivate: noop },
    { id: 'import-story', label: 'Import story…', onActivate: noop },
  ],
}

const meta: Meta<typeof ActionsMenu> = {
  title: 'Compounds/ActionsMenu',
  component: ActionsMenu,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      // The trigger renders as a 24px IconAction; the decorator gives the
      // popover anchor enough vertical room and the page enough horizontal
      // room to open without clipping at viewport edges.
      <View className="flex-col items-end gap-3" style={{ width: 420, minHeight: 480 }}>
        <Text size="xs" variant="muted">
          ⚲ trigger lives at the top-right · click or press Cmd/Ctrl-K to open
        </Text>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ActionsMenu>

// On the Reader — the richest case. Contextual + all three core groups.
// `Open Reader` is self-omitted by the screen (not present in the array).
export const Reader: Story = {
  render: () => <ActionsMenu contextual={READER_CONTEXT} coreGroups={[GO_TO, STORY_TOOLS, APP]} />,
}

// Same core, different contextual zone. `Open Reader` returns when not on Reader.
export const World: Story = {
  render: () => (
    <ActionsMenu
      contextual={WORLD_CONTEXT}
      coreGroups={[
        {
          ...GO_TO,
          entries: [
            { id: 'open-reader', label: 'Open Reader', onActivate: noop },
            ...GO_TO.entries.filter((e) => e.id !== 'open-world'),
          ],
        },
        STORY_TOOLS,
        APP,
      ]}
    />
  ),
}

// Off-story (Story List): GO TO + STORY TOOLS vanish entirely. APP survives.
// `Return to Library` self-omits on its own surface.
export const StoryList: Story = {
  render: () => (
    <ActionsMenu
      contextual={STORY_LIST_CONTEXT}
      coreGroups={[
        {
          ...APP,
          entries: APP.entries.filter((e) => e.id !== 'return-library'),
        },
      ]}
    />
  ),
}

// Thinnest case — App Settings with diagnostics off shows a single APP entry.
// Accepted per spec: the menu stays consistent and fills in as features land.
export const AppSettings: Story = {
  render: () => (
    <ActionsMenu
      coreGroups={[
        {
          ...APP,
          entries: APP.entries.filter(
            (e) => e.id !== 'open-app-settings' && e.id !== 'open-diagnostics',
          ),
        },
      ]}
    />
  ),
}

// In-flight: mutating entries (Flip era, Close chapter, Set lead, Add *) render
// disabled with the uniform tooltip. Navigation and jump commands stay enabled.
const IN_FLIGHT_REASON = 'Generation in progress — fields lock until complete'
export const InFlight: Story = {
  render: () => (
    <ActionsMenu
      contextual={{
        ...WORLD_CONTEXT,
        entries: WORLD_CONTEXT.entries.map((e) => ({
          ...e,
          disabled: true,
          disabledReason: IN_FLIGHT_REASON,
        })),
      }}
      coreGroups={[
        GO_TO,
        {
          ...STORY_TOOLS,
          entries: STORY_TOOLS.entries.map((e) => ({
            ...e,
            disabled: true,
            disabledReason: IN_FLIGHT_REASON,
          })),
        },
        APP,
      ]}
    />
  ),
}

// Blocked: Cmd/Ctrl-K and the trigger no-op while a modal owns the surface.
export const Blocked: Story = {
  render: () => (
    <ActionsMenu contextual={READER_CONTEXT} coreGroups={[GO_TO, STORY_TOOLS, APP]} blocked />
  ),
  play: async () => {
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.queryByPlaceholderText('Search actions…')).not.toBeInTheDocument()
  },
}

// A sheet the route cannot see: primitives (a Select, a picker) open their own on
// phone, so this half is derived from the store rather than passed down. Registered
// through the real hook so the story covers hook, store and menu as one path.
function ForeignSheet({ children }: { children: ReactNode }) {
  useRegisteredSheet(true)
  return <>{children}</>
}

export const ForeignSheetSuppressesTheMenu: Story = {
  render: () => (
    <ForeignSheet>
      <ActionsMenu contextual={READER_CONTEXT} coreGroups={[GO_TO, STORY_TOOLS, APP]} />
    </ForeignSheet>
  ),
  play: async () => {
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.queryByPlaceholderText('Search actions…')).not.toBeInTheDocument()
  },
}

// Cmd/Ctrl-K is a window-level listener; these two pin that the focus gate, not
// the trigger, is what decides whether it fires.
export const ShortcutOpensTheMenu: Story = {
  render: () => <ActionsMenu contextual={READER_CONTEXT} coreGroups={[GO_TO, STORY_TOOLS, APP]} />,
  play: async () => {
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(await screen.findByPlaceholderText('Search actions…')).toBeInTheDocument()
  },
}

export const FocusGateSuppressesTheShortcut: Story = {
  render: () => (
    <ActionsMenu
      contextual={READER_CONTEXT}
      coreGroups={[GO_TO, STORY_TOOLS, APP]}
      hotkeyEnabled={false}
    />
  ),
  play: async () => {
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.queryByPlaceholderText('Search actions…')).not.toBeInTheDocument()
    // The trigger itself is untouched — only the listener is gated, unlike `blocked`.
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }))
    expect(await screen.findByPlaceholderText('Search actions…')).toBeInTheDocument()
  },
}
