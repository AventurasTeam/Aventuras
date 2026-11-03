import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { TruncatedText } from '@/components/compounds/truncated-text'
import { TimeChip } from '@/components/reader/time-chip'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { EARTH_GREGORIAN, type CalendarFrame } from '@/lib/calendar'
import { chapterProgressOf, type ChapterProgress } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import { t } from '@/lib/i18n'
import { currentStoryStore, generationStore, type RunState } from '@/lib/stores'
import { themes } from '@/lib/themes'

import { ScreenShell, type ScreenShellProps } from './screen-shell'

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

function progressAt(percent: number): ChapterProgress {
  return chapterProgressOf([{ kind: 'ai_reply', tokens: percent * 240 }], 24_000)
}

const STRIP_VARIANTS = [progressAt(0), progressAt(50), progressAt(100)]

const STRIP_TONES = [progressAt(35), progressAt(85), progressAt(95)]

let memoryRun: RunState | undefined

// A pass in flight on the open story's branch, as the shell's banner reads it.
function openStoryWithPass(): void {
  currentStoryStore.set({
    storyId: 'story-1',
    branchId: 'branch-1',
    definition: storyDefinitionSchema.parse({
      mode: 'adventure',
      leadEntityId: 'char_kael',
      narration: 'second',
      genre: { label: 'Fantasy', promptBody: '' },
      tone: { label: 'Wry', promptBody: '' },
      setting: '',
      calendarSystemId: 'gregorian',
      worldTimeOrigin: { year: 0 },
    }),
    settings: STORY_SETTINGS_DEFAULTS,
  })
  memoryRun = {
    runId: 'run-pass',
    kind: PERIODIC_CLASSIFIER_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    beforeTurn: false,
    actionId: 'action-pass',
    storyId: 'story-1',
    branchId: 'branch-1',
    abortController: new AbortController(),
    currentPhase: 'classify',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
  generationStore.startRun(memoryRun)
}

function clearPass(): void {
  generationStore.__reset()
  currentStoryStore.__reset()
  memoryRun = undefined
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
  play: async () => {
    await screen.findByText(/app variant/)
    expect(screen.queryByTestId('chapter-progress-hit')).toBeNull()
  },
}

export const InStoryWorld: Story = {
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent / World</Text>}
      chapterProgress={progressAt(35)}
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
      chapterProgress={progressAt(35)}
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
        chapterProgress={progressAt(50)}
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
  play: async () => {
    const title = await screen.findByText("Aria's Descent")
    const chip = screen.getByText('Chap 3')
    // The title slot grows only when nothing sits beside it; here the chips must stay adjacent.
    await waitFor(() =>
      expect(chip.getBoundingClientRect().left - title.getBoundingClientRect().right).toBeLessThan(
        40,
      ),
    )
  },
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
        chapterProgress={progressAt(50)}
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

const LONG_TITLE =
  'The Extraordinarily Long Chronicle of the Veilstone Courier and the Crown of Ash'

/** A title too long for the bar truncates, and the slot still lets it reveal the full string. */
export const InStoryLongTitle: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <ScreenShell
        variant="in-story"
        title={
          <TruncatedText className="font-semibold" containerClassName="min-h-touch justify-center">
            {LONG_TITLE}
          </TruncatedText>
        }
        chapterProgress={progressAt(50)}
        onBack={noop}
        onOpenStorySettings={noop}
        onOpenActions={noop}
      >
        <BodyPlaceholder label="Long story title in a phone-width bar" />
      </ScreenShell>
    </View>
  ),
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: LONG_TITLE }))
    expect(await screen.findByRole('dialog', { name: 'Full text' })).toHaveTextContent(LONG_TITLE)
  },
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
      chapterProgress={progressAt(70)}
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
      {STRIP_VARIANTS.map((progress) => (
        <View key={progress.percent} className="gap-1">
          <Text variant="muted" size="sm">
            percent={progress.percent}
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
              <BodyPlaceholder label={`Strip at ${progress.percent}%`} />
            </ScreenShell>
          </View>
        </View>
      ))}
    </View>
  ),
  play: async () => {
    const strips = await screen.findAllByRole('progressbar', { name: t('chrome.chapterProgress') })
    expect(strips.map((strip) => strip.getAttribute('aria-valuenow'))).toEqual(['0', '50', '100'])
  },
}

// No prop: the strip stays mounted at 0, for layout stability.
export const ChapterProgressUndefined: Story = {
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent / World</Text>}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="No chapterProgress prop" />
    </ScreenShell>
  ),
  play: async () => {
    const strip = await screen.findByRole('progressbar', { name: t('chrome.chapterProgress') })
    expect(strip).toHaveAttribute('aria-valuenow', '0')
    expect(document.querySelector('[title*="tok"]')).toBeNull()
  },
}

export const ChapterProgressTones: Story = {
  render: () => (
    <View className="gap-4 p-4">
      {STRIP_TONES.map((progress) => (
        <View key={progress.tone} className="h-32 overflow-hidden rounded-md border border-border">
          <ScreenShell
            variant="in-story"
            title={<Text size="base">Aria&apos;s Descent / World</Text>}
            chapterProgress={progress}
            onBack={noop}
            onOpenStorySettings={noop}
            onOpenActions={noop}
          >
            <BodyPlaceholder label={`Strip at ${progress.percent}%`} />
          </ScreenShell>
        </View>
      ))}
    </View>
  ),
  play: async () => {
    const fills = await screen.findAllByTestId('chapter-progress-fill')
    expect(fills[0]).toHaveClass('bg-success')
    expect(fills[1]).toHaveClass('bg-warning')
    expect(fills[2]).toHaveClass('bg-danger')
    expect(new Set(fills.map((fill) => getComputedStyle(fill).backgroundColor)).size).toBe(3)
  },
}

function stripShell(props: Partial<ScreenShellProps>) {
  return (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      chapterProgress={progressAt(35)}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
      {...props}
    >
      <BodyPlaceholder label="Reader body" />
    </ScreenShell>
  )
}

// World, Plot and Story Settings pass no press: the pointer still has to reach the tooltip.
export const ChapterProgressTooltip: Story = {
  render: () => stripShell({}),
  play: async () => {
    const hit = await screen.findByTestId('chapter-progress-hit')
    const { left, top, width, height } = hit.getBoundingClientRect()
    const under = document.elementFromPoint(left + width / 2, top + height / 2)
    expect(under?.closest('[title]')).toHaveAttribute('title', '8,400 / 24,000 tok')
  },
}

export const ChapterProgressNoThreshold: Story = {
  render: () => stripShell({ chapterProgress: { ...progressAt(0), threshold: 0 } }),
  play: async () => {
    await screen.findByTestId('chapter-progress-hit')
    expect(document.querySelector('[title*="tok"]')).toBeNull()
  },
}

export const ChapterProgressPress: Story = {
  args: { onChapterProgressPress: fn() },
  render: ({ onChapterProgressPress }) => stripShell({ onChapterProgressPress }),
  play: async ({ args }) => {
    // Named for what it opens, as the chapter chip is, not after the bar it sits on.
    const hit = await screen.findByRole('button', { name: t('chapters:popover.title') })
    expect(hit).toHaveAttribute('aria-haspopup', 'dialog')
    const strip = screen.getByRole('progressbar', { name: t('chrome.chapterProgress') })
    // A progressbar's children are presentational, and a touch can't land outside a 3 px parent.
    expect(strip.contains(hit)).toBe(false)
    expect(strip.getBoundingClientRect().height).toBe(3)
    expect(hit.getBoundingClientRect().height).toBe(9)
    expect(hit.getBoundingClientRect().width).toBe(strip.getBoundingClientRect().width)
    expect(hit.getBoundingClientRect().bottom).toBe(strip.getBoundingClientRect().bottom)
    expect(getComputedStyle(hit).cursor).toBe('pointer')

    await userEvent.click(hit)
    expect(args.onChapterProgressPress).toHaveBeenCalledTimes(1)
  },
}

export const ChapterProgressNoPress: Story = {
  render: () => stripShell({}),
  play: async () => {
    const hit = await screen.findByTestId('chapter-progress-hit')
    expect(hit).toHaveAttribute('aria-disabled', 'true')
    expect(hit.tagName).not.toBe('BUTTON')
    expect(hit).not.toHaveAttribute('aria-label')
    expect(hit).not.toHaveAttribute('aria-haspopup')
    expect(getComputedStyle(hit).cursor).not.toBe('pointer')
    expect(screen.queryByRole('button', { name: t('chapters:popover.title') })).toBeNull()
  },
}

export const ChapterProgressPhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: { onChapterProgressPress: fn() },
  render: ({ onChapterProgressPress }) =>
    stripShell({ onChapterProgressPress, mobileChipAction: <Tag tone="default">Browse</Tag> }),
  play: async () => {
    await screen.findByText('Browse')
    expect(screen.queryByTestId('chapter-progress-hit')).toBeNull()
    expect(screen.getByRole('progressbar', { name: t('chrome.chapterProgress') })).toBeVisible()
  },
}

// BrowseChip's box: a control-height row, as the reader mounts it.
const BROWSE_CHIP = (
  <View testID="strip-browse" className="h-control-xs justify-center">
    <Tag tone="default">Browse</Tag>
  </View>
)

const STRIP_CHIPS = ['First chip', 'A chip with a long label', 'Third chip', 'Last chip']

// Chips sit in control-height Views (36 px at regular density): offsets are measured on the chip's
// box, not its label, and the strip's vertical clearance needs a known chip height.
export const ChipStripPhone: Story = {
  globals: { viewport: { value: 'mobile1' }, density: 'regular' },
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      chapterProgress={progressAt(35)}
      centerExtras={STRIP_CHIPS.map((label) => (
        <View key={label} testID={`strip-${label}`} className="h-control-xs justify-center">
          <Tag tone="soft">{label}</Tag>
        </View>
      ))}
      mobileChipAction={BROWSE_CHIP}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="in-story phone — the state chips scroll, Browse stays" />
    </ScreenShell>
  ),
  play: async () => {
    const browse = await screen.findByTestId('strip-browse')
    const first = screen.getByTestId(`strip-${STRIP_CHIPS[0]}`)
    const second = screen.getByTestId(`strip-${STRIP_CHIPS[1]}`)
    const strip = screen.getByTestId('reader-chip-strip')
    const browseLeft = browse.getBoundingClientRect().left

    expect(first.getBoundingClientRect().left).toBe(16)
    expect(second.getBoundingClientRect().left - first.getBoundingClientRect().right).toBe(8)
    // A chip's hit slop must land inside the scroller: a scroll view won't hit-test past its edge.
    expect(strip.getBoundingClientRect().height).toBe(44)
    expect(first.getBoundingClientRect().top - strip.getBoundingClientRect().top).toBe(4)
    expect(strip.getBoundingClientRect().bottom - first.getBoundingClientRect().bottom).toBe(4)
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth)
    expect(strip.getBoundingClientRect().right).toBeLessThanOrEqual(browseLeft)

    strip.scrollLeft = 120
    await waitFor(() => expect(first.getBoundingClientRect().left).toBe(-104))
    expect(browse.getBoundingClientRect().left).toBe(browseLeft)
  },
}

// At comfortable density a chip is 40 px, past the 44 px floor once padded: the 4 px stays, a
// shorter chip stays centred, and the strip is as tall as with Browse alone.
export const ChipStripTallChipPhone: Story = {
  globals: { viewport: { value: 'mobile1' }, density: 'comfortable' },
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      chapterProgress={progressAt(35)}
      centerExtras={
        <>
          <View testID="strip-tall" className="h-control-xs justify-center">
            <Tag tone="soft">Tall chip</Tag>
          </View>
          <View testID="strip-short" className="h-6 justify-center">
            <Tag tone="soft">Short chip</Tag>
          </View>
        </>
      }
      mobileChipAction={BROWSE_CHIP}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="in-story phone — a 40 px chip keeps 4 px clear" />
    </ScreenShell>
  ),
  play: async () => {
    const strip = await screen.findByTestId('reader-chip-strip')
    const chip = screen.getByTestId('strip-tall')
    const short = screen.getByTestId('strip-short')
    const chipRect = chip.getBoundingClientRect()
    const stripRect = strip.getBoundingClientRect()
    const shortRect = short.getBoundingClientRect()
    expect(chipRect.height).toBe(40)
    expect(shortRect.height).toBe(24)
    expect(chipRect.top - stripRect.top).toBe(4)
    expect(stripRect.bottom - chipRect.bottom).toBe(4)
    expect(shortRect.top + shortRect.height / 2).toBe(chipRect.top + chipRect.height / 2)
    expect(stripRect.height).toBe(48)
    expect(strip.parentElement?.getBoundingClientRect().height).toBe(57)
  },
}

const LONG_TIME_FRAME: CalendarFrame = {
  calendar: {
    ...EARTH_GREGORIAN,
    displayFormat:
      'The eleventh day of the long rains in the third year of the reign of the Ashen Queen',
  },
  origin: { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
}

// A truncated time chip is a 44 px target in a 36 px box: the strip must not grow to hold it.
export const ChipStripTimeChipPhone: Story = {
  globals: { viewport: { value: 'mobile1' }, density: 'regular' },
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      chapterProgress={progressAt(35)}
      centerExtras={<TimeChip seconds={0} frame={LONG_TIME_FRAME} />}
      mobileChipAction={BROWSE_CHIP}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="in-story phone — a truncated time chip keeps the strip's height" />
    </ScreenShell>
  ),
  play: async () => {
    const strip = await screen.findByTestId('reader-chip-strip')
    const button = await within(strip).findByRole('button', { name: /long rains/ })
    const stripRect = strip.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    expect(stripRect.height).toBe(44)
    expect(strip.parentElement?.getBoundingClientRect().height).toBe(53)
    expect(buttonRect.height).toBe(44)
    expect(buttonRect.top).toBeGreaterThanOrEqual(stripRect.top)
    expect(buttonRect.bottom).toBeLessThanOrEqual(stripRect.bottom)
  },
}

function browseOnlyShell() {
  return (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      chapterProgress={progressAt(35)}
      mobileChipAction={BROWSE_CHIP}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="in-story phone — Browse alone" />
    </ScreenShell>
  )
}

// With no state chips, Browse still sits at the right edge, and the strip is as tall as it is with
// chips at the same density (ChipStripTimeChipPhone: 53 px).
export const ChipStripBrowseOnlyPhone: Story = {
  globals: { viewport: { value: 'mobile1' }, density: 'regular' },
  render: browseOnlyShell,
  play: async () => {
    const browse = await screen.findByTestId('strip-browse')
    expect(browse.getBoundingClientRect().right).toBe(window.innerWidth - 12)
    const strip = screen.getByTestId('reader-chip-strip')
    expect(strip.getBoundingClientRect().height).toBe(44)
    expect(strip.parentElement?.getBoundingClientRect().height).toBe(53)
  },
}

// ChipStripTallChipPhone's strip at the same density: 57 px, so mounting chips doesn't shift it.
export const ChipStripBrowseOnlyComfortablePhone: Story = {
  globals: { viewport: { value: 'mobile1' }, density: 'comfortable' },
  render: browseOnlyShell,
  play: async () => {
    await screen.findByTestId('strip-browse')
    const strip = screen.getByTestId('reader-chip-strip')
    expect(strip.parentElement?.getBoundingClientRect().height).toBe(57)
  },
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
              chapterProgress={progressAt(45)}
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

export const ActionsSlot: Story = {
  args: {
    variant: 'app-root',
    onOpenAppSettings: noop,
    actions: <Text>ACTIONS_SLOT</Text>,
    children: <BodyPlaceholder label="actions slot replaces the default Actions icon" />,
  },
  play: async () => {
    await expect(screen.getByText('ACTIONS_SLOT')).toBeInTheDocument()
    // The default Actions IconAction is replaced, not rendered alongside.
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull()
  },
}

const IN_STORY_MEMORY_RUN_BODY =
  'in-story variant — a pass in flight shows the memory-run banner below the chrome'

export const InStoryMemoryRun: Story = {
  beforeEach: () => {
    openStoryWithPass()
    return clearPass
  },
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      chapterProgress={progressAt(35)}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label={IN_STORY_MEMORY_RUN_BODY} />
    </ScreenShell>
  ),
  play: async () => {
    const banner = await screen.findByTestId('memory-run-banner')
    expect(within(banner).getByText(t('chrome.memoryBanner.updating'))).toBeInTheDocument()
    const progress = screen.getByRole('progressbar', { name: t('chrome.chapterProgress') })
    expect(progress.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const body = screen.getByText(IN_STORY_MEMORY_RUN_BODY)
    expect(banner.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(within(banner).getByRole('button', { name: t('cancel') }))
    await waitFor(() => expect(memoryRun?.abortController.signal.aborted).toBe(true))
  },
}

// The banner sits below the phone chip strip too, not between the progress strip and it.
export const InStoryMemoryRunPhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  beforeEach: () => {
    openStoryWithPass()
    return clearPass
  },
  render: () => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      chapterProgress={progressAt(35)}
      centerExtras={<Tag tone="soft">Chap 3</Tag>}
      mobileChipAction={<Tag tone="default">Browse</Tag>}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="in-story phone — the banner sits below the chip strip" />
    </ScreenShell>
  ),
  play: async () => {
    const banner = await screen.findByTestId('memory-run-banner')
    await waitFor(() => {
      const chip = screen.getByText('Browse')
      expect(chip.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  },
}

export const AppVariantHasNoMemoryBanner: Story = {
  beforeEach: () => {
    openStoryWithPass()
    return clearPass
  },
  render: () => (
    <ScreenShell
      variant="app"
      title={<Text size="base">App Settings</Text>}
      hideSelfReferentialIcon
      onBack={noop}
      onOpenActions={noop}
    >
      <BodyPlaceholder label="app variant — no memory-run banner, even with a pass in flight" />
    </ScreenShell>
  ),
  play: async () => {
    await screen.findByText('app variant — no memory-run banner, even with a pass in flight')
    expect(screen.queryByTestId('memory-run-banner')).toBeNull()
  },
}
