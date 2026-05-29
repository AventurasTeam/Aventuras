import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { MoreHorizontal, Sparkles } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { SaveBar } from '@/components/compounds/save-bar'
import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { InlineEditableName } from '@/components/ui/inline-editable-name'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { DetailPane } from './detail-pane'

const noop = () => {
  console.log('[story] action')
}

// Long-form filler — keeps the body taller than the scroll container
// in the LongBody / Dirty stories so the scroll behavior is visible.
const LOREM_PARAGRAPHS = Array.from(
  { length: 12 },
  (_, i) =>
    `Paragraph ${i + 1}. The Crown's bargain unraveled at midwinter — when the heralds rode out with banners damp and the priests' censers spent, no answer came. House Velara stayed silent on the matter, and the Pale Faith pretended not to have heard. Aria walked the curtain wall alone, counting torches and counting them again.`,
)

function BodyPlaceholder({ title }: { title: string }) {
  return (
    <View className="gap-2">
      <Text size="sm" variant="muted">
        {title}
      </Text>
      <View className="rounded-sm bg-bg-sunken p-3">
        <Text size="sm" variant="muted">
          (Per-kind body content — forms, lists, etc. — is consumer-rendered.)
        </Text>
      </View>
    </View>
  )
}

function LongBodyPlaceholder({ title }: { title: string }) {
  return (
    <View className="gap-3">
      <Text size="sm" variant="muted">
        {title}
      </Text>
      {LOREM_PARAGRAPHS.map((p, i) => (
        <Text key={i} size="sm">
          {p}
        </Text>
      ))}
    </View>
  )
}

// Placeholder ⋯ overflow trigger. The popover wiring is consumer
// territory (ImporterMenu or a Popover-with-trigger pattern); the
// IconAction alone keeps the story focused on shell positioning.
function OverflowTrigger() {
  return <IconAction icon={MoreHorizontal} label="More options" onPress={noop} />
}

const meta: Meta<typeof DetailPane> = {
  title: 'Shells/DetailPane',
  component: DetailPane,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof DetailPane>

// ──────────────────────────────────────────────────────────────────
// Story 1 — World character. Full 8-tab strip, recently-classified
// badge, no SaveBar (clean state).
// ──────────────────────────────────────────────────────────────────

function WorldCharacterHarness() {
  const [name, setName] = useState('Kael Vex')
  const [tab, setTab] = useState('overview')

  return (
    <View style={{ width: 560, height: 560 }} className="rounded-md border border-border">
      <Tabs value={tab} onValueChange={setTab}>
        <DetailPane
          kindIcon={<EntityKindIcon kind="character" />}
          kindName="character"
          nameSlot={<InlineEditableName value={name} onChange={setName} size="lg" />}
          badges={
            <Tag tone="accent" leading={<Icon as={Sparkles} size="sm" />}>
              Recently classified
            </Tag>
          }
          overflowMenu={<OverflowTrigger />}
          tabs={
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="carrying" count={7}>
                Carrying
              </TabsTrigger>
              <TabsTrigger value="connections" count={3}>
                Connections
              </TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="assets" count={2}>
                Assets
              </TabsTrigger>
              <TabsTrigger value="involvements" count={7}>
                Involvements
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="overview">
            <BodyPlaceholder title="Overview" />
          </TabsContent>
          <TabsContent value="identity">
            <BodyPlaceholder title="Identity" />
          </TabsContent>
          <TabsContent value="carrying">
            <BodyPlaceholder title="Carrying — 7 items" />
          </TabsContent>
          <TabsContent value="connections">
            <BodyPlaceholder title="Connections — 3 entities" />
          </TabsContent>
          <TabsContent value="settings">
            <BodyPlaceholder title="Settings" />
          </TabsContent>
          <TabsContent value="assets">
            <BodyPlaceholder title="Assets — 2 attached" />
          </TabsContent>
          <TabsContent value="involvements">
            <BodyPlaceholder title="Involvements — 7 threads" />
          </TabsContent>
          <TabsContent value="history">
            <BodyPlaceholder title="History — delta log" />
          </TabsContent>
        </DetailPane>
      </Tabs>
    </View>
  )
}

export const WorldCharacter: Story = {
  render: () => <WorldCharacterHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 2 — World lore entry. Different kind, non-default injection-
// mode badge demonstrating warning-toned chip placement.
// ──────────────────────────────────────────────────────────────────

function WorldLoreHarness() {
  const [name, setName] = useState('The Founding Pact')
  const [tab, setTab] = useState('overview')

  return (
    <View style={{ width: 560, height: 540 }} className="rounded-md border border-border">
      <Tabs value={tab} onValueChange={setTab}>
        <DetailPane
          // Lore has no entry in EntityKindIcon's `kind` enum (it's a
          // World concept, not an Entity), so the consumer would
          // typically render a custom glyph here. For the story, a
          // bare placeholder text glyph stands in.
          kindIcon={
            <View className="h-[22px] w-[22px] items-center justify-center">
              <Text size="sm" variant="muted">
                §
              </Text>
            </View>
          }
          kindName="lore"
          nameSlot={<InlineEditableName value={name} onChange={setName} size="lg" />}
          badges={<Tag tone="warning">ALWAYS INJECTED</Tag>}
          overflowMenu={<OverflowTrigger />}
          tabs={
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="body">Body</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="overview">
            <BodyPlaceholder title="Overview — category, tags, summary" />
          </TabsContent>
          <TabsContent value="body">
            <BodyPlaceholder title="Body — long-form lore text" />
          </TabsContent>
          <TabsContent value="settings">
            <BodyPlaceholder title="Settings — injection mode, scope" />
          </TabsContent>
          <TabsContent value="history">
            <BodyPlaceholder title="History — delta log" />
          </TabsContent>
        </DetailPane>
      </Tabs>
    </View>
  )
}

export const WorldLore: Story = {
  render: () => <WorldLoreHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 3 — Plot thread. Narrow 2-tab strip; success-toned status
// badge.
// ──────────────────────────────────────────────────────────────────

function PlotThreadHarness() {
  const [name, setName] = useState("Crown's bargain")
  const [tab, setTab] = useState('overview')

  return (
    <View style={{ width: 560, height: 520 }} className="rounded-md border border-border">
      <Tabs value={tab} onValueChange={setTab}>
        <DetailPane
          // Plot's thread glyph isn't in EntityKindIcon either — it's
          // an open-diamond placeholder per iconography.md drafts.
          // Stand-in for the story: a small ◇ in a muted box.
          kindIcon={
            <View className="h-[22px] w-[22px] items-center justify-center">
              <Text size="sm" variant="muted">
                ◇
              </Text>
            </View>
          }
          kindName="thread"
          nameSlot={<InlineEditableName value={name} onChange={setName} size="lg" />}
          badges={<Tag tone="success">Active</Tag>}
          overflowMenu={<OverflowTrigger />}
          tabs={
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="overview">
            <BodyPlaceholder title="Overview — title, state, description, stakes" />
          </TabsContent>
          <TabsContent value="history">
            <BodyPlaceholder title="History — delta log" />
          </TabsContent>
        </DetailPane>
      </Tabs>
    </View>
  )
}

export const PlotThread: Story = {
  render: () => <PlotThreadHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 4 — Dirty save-session. Same shape as WorldCharacter but
// with the SaveBar slot filled to verify the sticky-bottom anchor.
// ──────────────────────────────────────────────────────────────────

function DirtyHarness() {
  const [name, setName] = useState('Kael Vex')
  const [tab, setTab] = useState('identity')

  return (
    <View style={{ width: 560, height: 560 }} className="rounded-md border border-border">
      <Tabs value={tab} onValueChange={setTab}>
        <DetailPane
          kindIcon={<EntityKindIcon kind="character" />}
          kindName="character"
          nameSlot={<InlineEditableName value={name} onChange={setName} size="lg" />}
          badges={
            <Tag tone="accent" leading={<Icon as={Sparkles} size="sm" />}>
              Recently classified
            </Tag>
          }
          overflowMenu={<OverflowTrigger />}
          tabs={
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="connections" count={3}>
                Connections
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          }
          saveBar={
            <SaveBar
              dirtyFields={['description', 'visual.hair', 'traits']}
              dirtyCount={3}
              onSave={noop}
              onDiscard={noop}
            />
          }
        >
          <TabsContent value="overview">
            <BodyPlaceholder title="Overview" />
          </TabsContent>
          <TabsContent value="identity">
            <LongBodyPlaceholder title="Identity — edited fields drive the dirty count" />
          </TabsContent>
          <TabsContent value="connections">
            <BodyPlaceholder title="Connections — 3 entities" />
          </TabsContent>
          <TabsContent value="history">
            <BodyPlaceholder title="History — delta log" />
          </TabsContent>
        </DetailPane>
      </Tabs>
    </View>
  )
}

export const Dirty: Story = {
  render: () => <DirtyHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 5 — Long body. Fixed 400 px wrapper height so scroll inside
// the body slot is verifiable (head + tabs stay pinned; saveBar
// would too when present).
// ──────────────────────────────────────────────────────────────────

function LongBodyHarness() {
  const [name, setName] = useState('Kael Vex')
  const [tab, setTab] = useState('overview')

  return (
    <View style={{ width: 560, height: 400 }} className="rounded-md border border-border">
      <Tabs value={tab} onValueChange={setTab}>
        <DetailPane
          kindIcon={<EntityKindIcon kind="character" />}
          kindName="character"
          nameSlot={<InlineEditableName value={name} onChange={setName} size="lg" />}
          overflowMenu={<OverflowTrigger />}
          tabs={
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="overview">
            <LongBodyPlaceholder title="Overview — long-form body to test scroll containment" />
          </TabsContent>
          <TabsContent value="history">
            <LongBodyPlaceholder title="History — delta log, also long" />
          </TabsContent>
        </DetailPane>
      </Tabs>
    </View>
  )
}

export const LongBody: Story = {
  render: () => <LongBodyHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 6 — Theme matrix. One WorldCharacter-shaped DetailPane per
// theme so chrome tokens (border, bg-base, bg-sunken, accent tag) can
// be eyeballed across the palette.
// ──────────────────────────────────────────────────────────────────

function ThemeDetailSample() {
  const [tab, setTab] = useState('overview')
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <DetailPane
        kindIcon={<EntityKindIcon kind="character" />}
        kindName="character"
        nameSlot={<InlineEditableName value="Kael Vex" onChange={noop} size="lg" />}
        badges={
          <Tag tone="accent" leading={<Icon as={Sparkles} size="sm" />}>
            Recently classified
          </Tag>
        }
        overflowMenu={<OverflowTrigger />}
        tabs={
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="identity">Identity</TabsTrigger>
            <TabsTrigger value="connections" count={3}>
              Connections
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="overview">
          <BodyPlaceholder title="Overview" />
        </TabsContent>
        <TabsContent value="identity">
          <BodyPlaceholder title="Identity" />
        </TabsContent>
        <TabsContent value="connections">
          <BodyPlaceholder title="Connections — 3 entities" />
        </TabsContent>
        <TabsContent value="history">
          <BodyPlaceholder title="History — delta log" />
        </TabsContent>
      </DetailPane>
    </Tabs>
  )
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4 p-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="gap-1"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View
            style={{ width: 560, height: 460 }}
            className="overflow-hidden rounded-md border border-border"
          >
            <ThemeDetailSample />
          </View>
        </View>
      ))}
    </View>
  ),
}
