import { ArrowLeft, BookOpen, MoreVertical, Settings, SlidersVertical } from 'lucide-react-native'
import * as React from 'react'
import { View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { TextClassContext } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

/**
 * ScreenShell — variant-driven chrome wrapper for every app screen
 * except Onboarding (chromeless) and Wizard (own minimal chrome).
 *
 * Owns:
 * - **Left slot**. Logo on `app-root`, `[←]` Return everywhere else.
 *   Return wires to `onBack` if passed; otherwise no-op. Stack-aware
 *   behavior is the consumer's concern (router / nav hook).
 * - **Right cluster**. Derived from `variant` + `hideSelfReferentialIcon`
 *   per the consumer table in
 *   [`docs/explorations/2026-05-14-shells-design.md → ScreenShell`](../../docs/explorations/2026-05-14-shells-design.md#shell-1--screenshell).
 * - **Token-progress strip** (in-story only). Always rendered for
 *   layout stability — 0 % at minimum per the spec's open-questions
 *   lean.
 * - **Banner stack** above the bar. Slot is consumer-rendered;
 *   shell just positions.
 * - **`centerExtras` tier reshuffle** via `useTier()`. Phone:
 *   migrates to a chip strip below the progress strip with
 *   `mobileChipAction` right-anchored. Tablet / desktop: inline
 *   beside title.
 *
 * Does NOT own: title content, master-detail sub-header (lives in
 * `children`), statusSlot wiring, body composition. See the spec
 * for the full does-NOT-own list.
 *
 * Iconography placeholders per
 * [`foundations/iconography.md → Top-bar / chrome`](../../docs/ui/foundations/iconography.md#top-bar--chrome):
 * `Settings` for ⚙ App Settings, `SlidersVertical` for ⛭ Story
 * Settings, `MoreVertical` for ⚲ Actions, `ArrowLeft` for ← Return,
 * `BookOpen` as the temporary logo placeholder until the real logo
 * asset lands.
 */

type ScreenShellVariant = 'app-root' | 'app' | 'in-story'

type ScreenShellProps = {
  variant: ScreenShellVariant

  /**
   * Page-provided breadcrumb / title content for the title slot.
   * Consumers will eventually pass a BreadcrumbTitle compound; for
   * now any ReactNode is accepted.
   */
  title?: React.ReactNode

  /**
   * Tier-aware reader-only chips (chapter / time / branch chips).
   * - desktop / tablet → inline beside title
   * - phone           → migrates to a chip strip below progress strip
   * Shell uses `useTier()` internally to reshuffle.
   */
  centerExtras?: React.ReactNode

  /**
   * Phone-only, right-anchored action chip in the chip strip
   * (e.g. Reader's [☰ Browse] trigger). Hidden ≥ 640 px tier.
   */
  mobileChipAction?: React.ReactNode

  /**
   * In-story only. Composes one or more status indicators
   * (GenerationStatusPill, future World review pill, etc.). Shell
   * wraps in a flex-row; consumer arranges contents.
   */
  statusSlot?: React.ReactNode

  /**
   * In-story only. 0–100. Drives the token-progress strip width.
   * When undefined, the strip renders at 0 % (layout stability).
   * Spec: always rendered for in-story, never hidden.
   */
  chapterProgress?: number

  /**
   * Banner stack above the bar (AI-not-configured, profile-errors,
   * future). Shell positions the slot; per-screen logic decides
   * what's in it.
   */
  banners?: React.ReactNode

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

  children: React.ReactNode
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
  children,
}: ScreenShellProps) {
  const tier = useTier()
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
        <IconAction icon={Settings} label="App Settings" onPress={onOpenAppSettings} />
      ) : null}
      {isInStory && !hideSelfReferentialIcon ? (
        <IconAction icon={SlidersVertical} label="Story Settings" onPress={onOpenStorySettings} />
      ) : null}
      <IconAction icon={MoreVertical} label="Actions" onPress={onOpenActions} />
    </View>
  )

  const leftSlot = isAppRoot ? (
    <View
      accessibilityRole="image"
      aria-label="Aventuras"
      className="h-icon-action-md w-icon-action-md items-center justify-center"
    >
      <Icon as={BookOpen} size="md" />
    </View>
  ) : (
    <IconAction icon={ArrowLeft} label="Back" onPress={onBack} />
  )

  const progress = clampProgress(chapterProgress)

  return (
    <View className="flex-1 bg-bg-base">
      {/* Banner stack above the bar. */}
      {banners != null ? <View className="flex-col">{banners}</View> : null}

      {/* Top bar. h-control-md = 44 px @ regular density, matches the
          navigation.md phone wireframe's ~44 px top bar. */}
      <View
        className={cn(
          'h-control-md flex-row items-center gap-2 border-b border-border bg-bg-base px-3',
        )}
      >
        {leftSlot}
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <TextClassContext.Provider value="leading-none">
            <View className="min-w-0 flex-shrink flex-row items-center">{title}</View>
          </TextClassContext.Provider>
          {inlineCenterExtras != null ? (
            <View className="flex-row items-center gap-2">{inlineCenterExtras}</View>
          ) : null}
        </View>
        {rightCluster}
      </View>

      {/* Token-progress strip — in-story only, always rendered for
          layout stability. 3 px tall horizontal bar; fill width =
          chapterProgress %. */}
      {isInStory ? (
        <View
          accessibilityRole="progressbar"
          aria-label="Chapter progress"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-[3px] w-full bg-bg-sunken"
        >
          <View className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </View>
      ) : null}

      {/* Phone-only chip strip — state chips left, mobileChipAction
          right-anchored via flex-1 spacer. */}
      {isPhone && (chipStripCenterExtras != null || mobileChipAction != null) ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-bg-base px-3 py-2">
          <View className="flex-row items-center gap-2">{chipStripCenterExtras}</View>
          <View className="flex-1" />
          {mobileChipAction}
        </View>
      ) : null}

      {/* Body. Consumer territory — no scroll wrapping. */}
      <View className="flex-1">{children}</View>
    </View>
  )
}

export type { ScreenShellProps, ScreenShellVariant }
