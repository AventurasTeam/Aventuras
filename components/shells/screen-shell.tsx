import { ArrowLeft, BookOpen, MoreVertical, Settings, SlidersVertical } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { TextClassContext } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
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
   * In-story only. 0–100. Drives the token-progress strip width.
   * When undefined, the strip renders at 0 % (layout stability).
   * Spec: always rendered for in-story, never hidden.
   */
  chapterProgress?: number

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

  const progress = clampProgress(chapterProgress)

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

      <View
        // Bar height is structural (h-bar-md), not the tap-target control
        // floor — a bar holds touchables but isn't one. Its actions render at
        // IconAction size="lg" so they read as chrome, not row-nestled icons.
        className={cn(
          'h-bar-md flex-row items-center gap-2 border-b border-border bg-bg-base px-3',
        )}
      >
        {leftSlot}
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <TextClassContext.Provider value="text-fg-primary !leading-none translate-y-[0.08em]">
            <View className="min-w-0 flex-shrink flex-row items-center">{title}</View>
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
          className="h-[3px] w-full bg-bg-sunken"
        >
          <View className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </View>
      ) : null}

      {isPhone && (chipStripCenterExtras != null || mobileChipAction != null) ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-bg-base px-3 py-2">
          <View className="flex-row items-center gap-2">{chipStripCenterExtras}</View>
          <View className="flex-1" />
          {mobileChipAction}
        </View>
      ) : null}

      <View className="flex-1">{children}</View>
    </View>
  )
}

export type { ScreenShellProps, ScreenShellVariant }
