// Aventuras Sheet primitive — built directly from @rn-primitives/dialog.
//
// react-native-reusables doesn't ship a Sheet component (verified via CLI),
// so this primitive is built from the rn-primitives layer using the same
// slot-first reshape discipline as the Popover scaffold per
// docs/ui/components.md. Implements the contract in patterns/overlays.md.
//
// What this primitive owns vs. delegates:
//
// - DELEGATES to @rn-primitives/dialog: open/close lifecycle, controlled
//   state (open / defaultOpen / onOpenChange), focus trap, scrim dismissal,
//   Portal hosting, Trigger composition.
// - OWNS: anchor (bottom / right) presentation, size scale (short / medium /
//   tall) for bottom anchor, drag-handle visual, slot-token wiring
//   (bg-overlay, border-strong, scrim color, radii on the open edge,
//   padding), native slide animation via reanimated.
//
// What's NOT here yet:
//
// - **Web entry / exit animations.** Match Popover's gap; pair with the
//   post-phase-2 animation pass. Sheet appears instantly on Electron until
//   then.
// - **Drag-to-dismiss.** Gesture-handler wiring pairs naturally with the
//   same post-phase-2 animation work; consumer-side dismissal still works
//   via tap-on-scrim and Escape.
// - **Per-theme scrim color.** Uses `bg-black/40` matching the light-mode
//   value; dark-mode would prefer 0.6 but Aventuras doesn't currently ship
//   a `--scrim` slot per the parked decision in
//   docs/ui/foundations/spacing.md.

import * as DialogPrimitive from '@rn-primitives/dialog'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import * as React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideInRight,
  SlideOutDown,
  SlideOutRight,
} from 'react-native-reanimated'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment

type SheetAnchor = 'bottom' | 'right'
type SheetSize = 'short' | 'medium' | 'tall'

const BOTTOM_HEIGHT_BY_SIZE: Record<SheetSize, string> = {
  short: 'h-[33vh]',
  medium: 'h-[60vh]',
  tall: 'h-[95vh]',
}

function SheetContent({
  className,
  anchor = 'bottom',
  size = 'medium',
  portalHost,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  anchor?: SheetAnchor
  size?: SheetSize
  portalHost?: string
}) {
  const isBottom = anchor === 'bottom'
  const slideEnter = isBottom ? SlideInDown.duration(250) : SlideInRight.duration(250)
  const slideExit = isBottom ? SlideOutDown : SlideOutRight

  return (
    <DialogPrimitive.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <NativeOnlyAnimatedView entering={FadeIn.duration(200)} exiting={FadeOut}>
          <DialogPrimitive.Overlay
            className="absolute inset-0 bg-black/40"
            style={Platform.select({ native: StyleSheet.absoluteFill })}
          />
        </NativeOnlyAnimatedView>
        <NativeOnlyAnimatedView entering={slideEnter} exiting={slideExit}>
          <TextClassContext.Provider value="text-fg-primary">
            <DialogPrimitive.Content
              className={cn(
                'absolute z-50 border border-border-strong bg-bg-overlay p-6 outline-none',
                isBottom
                  ? cn(
                      'bottom-0 left-0 right-0 rounded-t-lg border-b-0',
                      BOTTOM_HEIGHT_BY_SIZE[size],
                    )
                  : 'bottom-0 right-0 top-0 w-[440px] rounded-l-lg border-r-0',
                className,
              )}
              {...props}
            >
              {isBottom ? (
                <View className="bg-fg-muted/40 mx-auto mb-4 h-1 w-10 rounded-full" />
              ) : null}
              {children}
            </DialogPrimitive.Content>
          </TextClassContext.Provider>
        </NativeOnlyAnimatedView>
      </FullWindowOverlay>
    </DialogPrimitive.Portal>
  )
}

export { Sheet, SheetContent, SheetTrigger }
export type { SheetAnchor, SheetSize }
