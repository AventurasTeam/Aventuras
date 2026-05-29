import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { ScreenShell } from './screen-shell'

const noop = () => {
  console.log('[story] action')
}

function BodyPlaceholder({ label }: { label: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-bg-sunken p-6">
      <Text variant="muted" size="sm">
        {label}
      </Text>
    </View>
  )
}

const meta: Meta<typeof ScreenShell> = {
  title: 'Shells/ScreenShell',
  component: ScreenShell,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof ScreenShell>

export const AppRootStoryList: Story = {
  render: () => (
    <ScreenShell
      variant="app-root"
      title={<Text size="base">Aventuras</Text>}
      onOpenAppSettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="app-root variant — Logo + [⚙ App Settings] + [⚲ Actions] cluster" />
    </ScreenShell>
  ),
}

export const AppAppSettings: Story = {
  render: () => (
    <ScreenShell
      variant="app"
      title={<Text size="base">App Settings</Text>}
      hideSelfReferentialIcon
      onBack={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="app variant — [←] Return + [⚲ Actions]; ⚙ omitted (self-reference)" />
    </ScreenShell>
  ),
}

export const InStoryWorld: Story = {
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent / World</Text>}
      chapterProgress={35}
      statusSlot={
        <GenerationStatusPill
          activePhase="generating-narrative"
          onCancel={noop}
          onErrorTap={noop}
        />
      }
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="in-story variant — [←] + statusSlot + [⛭ Story Settings] + [⚲ Actions]" />
    </ScreenShell>
  ),
}

export const InStoryStorySettings: Story = {
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent / Story Settings</Text>}
      chapterProgress={35}
      hideSelfReferentialIcon
      statusSlot={
        <GenerationStatusPill activePhase="reasoning" onCancel={noop} onErrorTap={noop} />
      }
      onBack={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="in-story · Story Settings — [←] + statusSlot + [⚲]; ⛭ omitted (self-reference)" />
    </ScreenShell>
  ),
}

export const InStoryReader: Story = {
  render: () => (
    <View className="gap-2">
      <Text variant="muted" size="sm" className="px-3 pt-2">
        Desktop / tablet: centerExtras renders inline beside title. Resize below 640 px to see the
        chip strip variant.
      </Text>
      <ScreenShell
        variant="in-story"
        title={<Text size="base">Aria&apos;s Descent</Text>}
        chapterProgress={50}
        centerExtras={
          <>
            <Tag tone="soft">Chap 3</Tag>
            <Tag tone="soft">Day 3 dusk</Tag>
            <Tag tone="soft">Branch 1</Tag>
          </>
        }
        statusSlot={
          <GenerationStatusPill activePhase="reasoning" onCancel={noop} onErrorTap={noop} />
        }
        onBack={noop}
        onOpenStorySettings={noop}
        onOpenActions={noop}
      >
        <BodyPlaceholder label="Reader chrome at desktop/tablet — chips inline with title" />
      </ScreenShell>
    </View>
  ),
}

export const InStoryReaderPhone: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-2">
      <Text variant="muted" size="sm" className="px-3 pt-2">
        360 px wrapper is layout-only — `useTier()` reads window dimensions, so the chip strip only
        appears when the Storybook window itself is &lt; 640 px wide. Resize the browser to verify
        the phone collapse.
      </Text>
      <ScreenShell
        variant="in-story"
        title={<Text size="base">Aria&apos;s Descent</Text>}
        chapterProgress={50}
        centerExtras={
          <>
            <Tag tone="soft">Chap 3</Tag>
            <Tag tone="soft">Day 3 dusk</Tag>
            <Tag tone="soft">Branch 1</Tag>
          </>
        }
        mobileChipAction={<Tag tone="default">Browse</Tag>}
        statusSlot={
          <GenerationStatusPill activePhase="reasoning" onCancel={noop} onErrorTap={noop} />
        }
        onBack={noop}
        onOpenStorySettings={noop}
        onOpenActions={noop}
      >
        <BodyPlaceholder label="Reader chrome at phone width — chips migrate to strip; Browse right-anchored" />
      </ScreenShell>
    </View>
  ),
}

export const WithBanners: Story = {
  render: () => (
    <ScreenShell
      variant="app-root"
      title={<Text size="base">Aventuras</Text>}
      onOpenAppSettings={noop}
      onOpenActions={noop}
      banners={
        <View className="flex-row items-center gap-2 border-b border-warning bg-warning px-3 py-2">
          <Text size="sm" className="text-warning-fg">
            AI generation not configured. Set up a provider →
          </Text>
        </View>
      }
    >
      <BodyPlaceholder label="Banner stack renders above the bar; per-screen logic decides contents" />
    </ScreenShell>
  ),
}

export const WithStatusSlotMultiPill: Story = {
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent / World</Text>}
      chapterProgress={70}
      statusSlot={
        <>
          <GenerationStatusPill activePhase="classifying" onCancel={noop} onErrorTap={noop} />
          <Tag tone="warning">3 need review</Tag>
        </>
      }
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="statusSlot composes a GenerationStatusPill + a placeholder World review pill" />
    </ScreenShell>
  ),
}

export const ChapterProgressVariants: Story = {
  render: () => (
    <View className="gap-4 p-4">
      {[0, 50, 100].map((progress) => (
        <View key={progress} className="gap-1">
          <Text variant="muted" size="sm">
            chapterProgress={progress}
          </Text>
          <View className="h-32 overflow-hidden rounded-md border border-border">
            <ScreenShell
              variant="in-story"
              title={<Text size="base">Aria&apos;s Descent / World</Text>}
              chapterProgress={progress}
              onBack={noop}
              onOpenStorySettings={noop}
              onOpenActions={noop}
            >
              <BodyPlaceholder label={`Strip at ${progress}%`} />
            </ScreenShell>
          </View>
        </View>
      ))}
    </View>
  ),
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
          <View className="h-40 overflow-hidden rounded-md border border-border">
            <ScreenShell
              variant="in-story"
              title={<Text size="base">Aria&apos;s Descent / World</Text>}
              chapterProgress={45}
              statusSlot={
                <GenerationStatusPill
                  activePhase="generating-narrative"
                  onCancel={noop}
                  onErrorTap={noop}
                />
              }
              onBack={noop}
              onOpenStorySettings={noop}
              onOpenActions={noop}
            >
              <BodyPlaceholder label="in-story chrome" />
            </ScreenShell>
          </View>
        </View>
      ))}
    </View>
  ),
}
