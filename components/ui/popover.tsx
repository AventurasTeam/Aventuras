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
