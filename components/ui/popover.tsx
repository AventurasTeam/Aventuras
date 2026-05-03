// Aventuras Popover primitive — reshaped from react-native-reusables
// baseline. Implements the contract in docs/ui/patterns/overlays.md.
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: color tokens (bg-popover → bg-bg-overlay; text-popover-foreground
//   → text-fg-primary). outline-hidden → outline-none for Tailwind 3. Shadow
//   classes stripped per Aventuras's flat-depth principle (foundations/spacing.md
//   → Depth metaphor — popovers are bg-overlay + border, no shadow). Web
//   entry/exit animation classes (animate-in / fade-in-0 / zoom-in-95 / slide-*
//   / radix-CSS-var origin) stripped pending the NativeWind transition
//   followup; popover appears instantly on web until that lands. Native
//   animation retained via reanimated's FadeIn / FadeOut.
// - ACCEPTED: rn-primitives composition (Portal, Overlay, Root, Trigger,
//   Content), iOS FullWindowOverlay z-index handling from react-native-screens,
//   anchor positioning math, focus-trap mechanics, NativeOnlyAnimatedView
//   helper.

import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import * as PopoverPrimitive from '@rn-primitives/popover'
import * as React from 'react'
import { Platform, StyleSheet } from 'react-native'
import { FadeIn, FadeOut } from 'react-native-reanimated'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  portalHost,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  portalHost?: string
}) {
  return (
    <PopoverPrimitive.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <PopoverPrimitive.Overlay style={Platform.select({ native: StyleSheet.absoluteFill })}>
          <NativeOnlyAnimatedView entering={FadeIn.duration(200)} exiting={FadeOut}>
            <TextClassContext.Provider value="text-fg-primary">
              <PopoverPrimitive.Content
                align={align}
                sideOffset={sideOffset}
                className={cn(
                  'z-50 w-72 rounded-md border border-border bg-bg-overlay p-4 outline-none',
                  className,
                )}
                {...props}
              />
            </TextClassContext.Provider>
          </NativeOnlyAnimatedView>
        </PopoverPrimitive.Overlay>
      </FullWindowOverlay>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent, PopoverTrigger }
