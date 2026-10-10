import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { LorePeekBody } from '@/components/reader/peek/lore-peek-body'
import { ThreadPeekBody } from '@/components/reader/peek/thread-peek-body'
import type { Entity, InjectionMode, Lore, Thread } from '@/lib/db'
import { t } from '@/lib/i18n'

import { StatusRow } from './overview-parts'

const WAIT = { timeout: 3000 }
const MODES = ['always', 'disabled'] as const

function entity(injectionMode: InjectionMode): Entity {
  return {
    id: `char_${injectionMode}`,
    branchId: 'br_1',
    kind: 'character',
    name: 'Kael',
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode,
    nameCollisionFlag: 0,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function lore(injectionMode: InjectionMode): Lore {
  return {
    id: `lore_${injectionMode}`,
    branchId: 'br_1',
    title: 'The harbour seal',
    body: 'The seal of the harbour, as the Hollow tells it.',
    category: null,
    tags: [],
    keywords: [],
    injectionMode,
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function thread(injectionMode: InjectionMode): Thread {
  return {
    id: `t_${injectionMode}`,
    branchId: 'br_1',
    title: 'Keep the oath to the Watch',
    description: null,
    category: null,
    icon: null,
    status: 'active',
    injectionMode,
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

type ChipHost = 'entity' | 'lore' | 'thread'

function Host({ host, mode }: { host: ChipHost; mode: InjectionMode }) {
  switch (host) {
    case 'entity':
      return <StatusRow entity={entity(mode)} onRegionPress={() => {}} />
    case 'lore':
      return <LorePeekBody lore={lore(mode)} />
    case 'thread':
      return <ThreadPeekBody thread={thread(mode)} />
  }
}

function Harness({ host }: { host: ChipHost }) {
  return (
    <View className="gap-4 p-4">
      {MODES.map((mode) => (
        <Host key={mode} host={host} mode={mode} />
      ))}
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'World/InjectionModeChip',
  component: Harness,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof Harness>

// The web tooltip is ReasonTooltip's `title` on the chip's wrapper.
async function expectChipHelp(help: (mode: (typeof MODES)[number]) => string) {
  for (const mode of MODES) {
    const chip = await screen.findByText(t(`world:overview.injectionChip.${mode}`), {}, WAIT)
    await expect(chip.closest('[title]')).toHaveAttribute('title', help(mode))
  }
}

/** world.md → Overview: the tooltip pulls from the kind's own Settings select. */
export const EntityHelp: Story = {
  args: { host: 'entity' },
  play: () => expectChipHelp((mode) => t(`world:fields.injection.${mode}Help`)),
}

/** Lore's Settings select words the modes for reference material, not the entity's copy. */
export const LoreHelp: Story = {
  args: { host: 'lore' },
  play: () => expectChipHelp((mode) => t(`world:lore.injection.${mode}Help`)),
}

export const ThreadHelp: Story = {
  args: { host: 'thread' },
  play: () => expectChipHelp((mode) => t(`plot:fields.injection.${mode}Help`)),
}
