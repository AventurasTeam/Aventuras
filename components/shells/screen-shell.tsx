import { ArrowLeft, BookOpen, MoreVertical, Settings, SlidersVertical } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ChapterProgressBar } from '@/components/compounds/chapter-progress-bar'
import { chapterProgressCounts } from '@/components/compounds/chapter-progress-label'
import { MemoryRunBanner } from '@/components/compounds/memory-run-banner'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { TextClassContext } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type ScreenShellVariant = 'app-root' | 'app' | 'in-story'

type ScreenShellProps = {
  variant: ScreenShellVariant

  /**
   * Page-provided breadcrumb / title content for the title slot.
   */
  title?: ReactNode

  /**
   * Tier-aware reader-only chips (chapter / time / branch chips).
   * - desktop / tablet → inline beside title
   * - phone           → migrates to a chip strip below progress strip
   * Shell uses `useTier()` internally to reshuffle.
   */
  centerExtras?: ReactNode

  /**
   * Phone-only, right-anchored action chip in the chip strip
   * (e.g. Reader's [☰ Browse] trigger). Hidden ≥ 640 px tier.
   */
  mobileChipAction?: ReactNode

  /**
   * In-story only. Composes one or more status indicators.
   * Shell wraps in a flex-row; consumer arranges contents.
   */
  statusSlot?: ReactNode

  /**
   * In-story only. `percent` (clamped to 0–100) drives the token-progress strip width.
   * Undefined renders at 0 % — the strip is always rendered for in-story (layout stability).
   */
  chapterProgress?: ChapterProgress

  /**
   * Makes the strip's hit area (tablet and desktop) a button that opens a dialog; without it the
   * area stays inert and keeps its tooltip.
   */
  onChapterProgressPress?: () => void

  /**
   * Banner stack above the bar (AI-not-configured, profile-errors).
   * Shell positions the slot; per-screen logic decides what's in it.
   */
  banners?: ReactNode

  /**
   * Story Settings → suppresses ⛭ (self-reference).
   * App Settings   → suppresses ⚙ (self-reference).
   */
  hideSelfReferentialIcon?: boolean

  /** Wires the left-slot Return button on non-`app-root` variants. */
  onBack?: () => void

  /** Wires the ⚙ App Settings icon (`app-root` only). */
  onOpenAppSettings?: () => void

  /** Wires the ⛭ Story Settings icon (`in-story`, unless self-ref). */
  onOpenStorySettings?: () => void

  /** Wires the ⚲ Actions icon (every variant). */
  onOpenActions?: () => void

  /**
   * Replaces the shell's default Actions icon when provided — lets a screen
   * mount its own Actions menu (trigger + overlay) in the right cluster.
   * Falls back to the `onOpenActions` IconAction when omitted.
   */
  actions?: ReactNode

  children: ReactNode
}

const CHIP_STRIP_CONTENT: ViewStyle = { alignItems: 'center', gap: 8, paddingVertical: 4 }

function clampProgress(n: number | undefined): number {
  if (n == null || Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 100) return 100
  return n
}

export function ScreenShell({
  variant,
  title,
  centerExtras,
  mobileChipAction,
  statusSlot,
  chapterProgress,
  onChapterProgressPress,
  banners,
  hideSelfReferentialIcon = false,
  onBack,
  onOpenAppSettings,
  onOpenStorySettings,
  onOpenActions,
  actions,
  children,
}: ScreenShellProps) {
  const tier = useTier()
  const insets = useSafeAreaInsets()
  const isPhone = tier === 'phone'
  const isInStory = variant === 'in-story'
  const isAppRoot = variant === 'app-root'

  // centerExtras lives inline beside the title on desktop/tablet,
  // and in the chip strip below on phone.
  const inlineCenterExtras = !isPhone ? centerExtras : null
  const chipStripCenterExtras = isPhone ? centerExtras : null

  // Right cluster — derived from variant + hideSelfReferentialIcon.
  const rightCluster = (
    <View className="flex-row items-center gap-1">
      {isInStory && statusSlot != null ? (
        <View className="mr-1 flex-row items-center gap-2">{statusSlot}</View>
      ) : null}
      {isAppRoot && !hideSelfReferentialIcon ? (
        <IconAction
          icon={Settings}
          label={t('chrome.appSettings')}
          onPress={onOpenAppSettings}
          size="lg"
        />
      ) : null}
      {isInStory && !hideSelfReferentialIcon ? (
        <IconAction
          icon={SlidersVertical}
          label={t('chrome.storySettings')}
          onPress={onOpenStorySettings}
          size="lg"
        />
      ) : null}
      {actions != null ? (
        actions
      ) : (
        <IconAction
          icon={MoreVertical}
          label={t('chrome.actions')}
          onPress={onOpenActions}
          size="lg"
        />
      )}
    </View>
  )

  const leftSlot = isAppRoot ? (
    <View
      accessibilityRole="image"
      aria-label="Aventuras"
      className="h-icon-action-lg w-icon-action-lg items-center justify-center"
    >
      <Icon as={BookOpen} size="lg" />
    </View>
  ) : (
    <IconAction icon={ArrowLeft} label={t('chrome.back')} onPress={onBack} size="lg" />
  )

  const progress = clampProgress(chapterProgress?.percent)
  const canPressProgress = onChapterProgressPress != null
  // aria-haspopup is a web-only DOM attribute RN's prop types don't model.
  const progressPopupProps =
    canPressProgress && Platform.OS === 'web' ? ({ 'aria-haspopup': 'dialog' } as object) : null
  const progressCounts =
    chapterProgress != null && chapterProgress.threshold > 0
      ? chapterProgressCounts(chapterProgress)
      : undefined

  return (
    <View
      className="flex-1 bg-bg-base"
      style={{
        paddingTop: insets.top,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
      }}
    >
      {banners != null ? <View className="flex-col">{banners}</View> : null}

      <View className="relative">
        <View
          // Bar height is structural (h-bar-md), not the tap-target floor: a bar holds touchables
          // but isn't one. Its actions use IconAction size="lg" to read as chrome, not row icons.
          className={cn(
            'h-bar-md flex-row items-center gap-2 border-b border-border bg-bg-base px-3',
          )}
        >
          {leftSlot}
          <View className="min-w-0 flex-1 flex-row items-center gap-3">
            <TextClassContext.Provider value="text-fg-primary !leading-none translate-y-[0.08em]">
              {/* Grows without inline extras, so a title's % max-width resolves against the bar. */}
              <View
                className={cn(
                  'min-w-0 flex-shrink flex-row items-center',
                  inlineCenterExtras == null && 'grow',
                )}
              >
                {title}
              </View>
            </TextClassContext.Provider>
            {inlineCenterExtras != null ? (
              <View className="flex-row items-center gap-2">{inlineCenterExtras}</View>
            ) : null}
          </View>
          {rightCluster}
        </View>

        {isInStory ? (
          <View
            accessibilityRole="progressbar"
            aria-label={t('chrome.chapterProgress')}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <ChapterProgressBar percent={progress} className="h-[3px]" />
          </View>
        ) : null}

        {isInStory && !isPhone ? (
          // On the wrapper, not the Pressable: a disabled Pressable takes no pointer on web, and
          // the tooltip's box needs an in-flow child for its height.
          <View className="absolute bottom-0 left-0 right-0">
            <ReasonTooltip reason={progressCounts}>
              <Pressable
                testID="chapter-progress-hit"
                accessibilityRole={canPressProgress ? 'button' : undefined}
                accessibilityLabel={canPressProgress ? t('chapters:popover.title') : undefined}
                {...progressPopupProps}
                // RN's Pressable defaults both to true, so a disabled one stays a screen-reader stop.
                accessible={canPressProgress}
                focusable={canPressProgress}
                disabled={!canPressProgress}
                onPress={onChapterProgressPress}
                className={cn(
                  'h-[9px]',
                  Platform.select({
                    web: 'outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                  }),
                )}
              />
            </ReasonTooltip>
          </View>
        ) : null}
      </View>

      {isPhone && (chipStripCenterExtras != null || mobileChipAction != null) ? (
        // touch.md → Chip-strip safe zone: the scroller starts 16 px in, clear of the edge swipe.
        <View className="flex-row items-center gap-2 border-b border-border bg-bg-base py-1 pl-4 pr-3">
          <ScrollView
            testID="reader-chip-strip"
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            // The phone tap floor sits inside the scroller: a scroll view won't hit-test past its edge.
            className="min-h-touch flex-1"
            contentContainerStyle={CHIP_STRIP_CONTENT}
          >
            {chipStripCenterExtras}
          </ScrollView>
          {/* Padded like the chips' content, so the strip is as tall with or without them. */}
          {mobileChipAction != null ? <View className="py-1">{mobileChipAction}</View> : null}
        </View>
      ) : null}

      {/* Below all chrome, the phone chip strip too (principles.md → Affordance loci). */}
      {isInStory ? <MemoryRunBanner /> : null}

      <View className="flex-1">{children}</View>
    </View>
  )
}

export type { ScreenShellProps, ScreenShellVariant }
