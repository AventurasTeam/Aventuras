import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Text } from '@/components/ui/text'

export default function PopoverDevRoute() {
  const [focusEvent, setFocusEvent] = useState('—')

  return (
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Default</Heading>
          <View className="mt-2">
            <Popover ariaLabel="Popover heading">
              <PopoverTrigger asChild>
                <Button>
                  <Text>Open popover</Text>
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <View className="flex-col gap-2">
                  <Heading level={4}>Popover heading</Heading>
                  <Text variant="muted" size="sm">
                    Anchored, content-sized, no scrim. Outside-tap and Escape dismiss. State is
                    uncontrolled.
                  </Text>
                </View>
              </PopoverContent>
            </Popover>
          </View>
        </View>
        <View>
          <Heading level={3}>Placements</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            side=top|bottom × align=start|center|end.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Popover ariaLabel="top start placement">
              <PopoverTrigger asChild>
                <Button variant="secondary">
                  <Text>top + start</Text>
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-48">
                <Text size="sm">side=top align=start</Text>
              </PopoverContent>
            </Popover>
            <Popover ariaLabel="top end placement">
              <PopoverTrigger asChild>
                <Button variant="secondary">
                  <Text>top + end</Text>
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-48">
                <Text size="sm">side=top align=end</Text>
              </PopoverContent>
            </Popover>
            <Popover ariaLabel="bottom center placement">
              <PopoverTrigger asChild>
                <Button variant="secondary">
                  <Text>bottom + center</Text>
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="center" className="w-48">
                <Text size="sm">side=bottom align=center</Text>
              </PopoverContent>
            </Popover>
          </View>
        </View>
        <View>
          <Heading level={3}>Rich content</Heading>
          <View className="mt-2">
            <Popover ariaLabel="Settings">
              <PopoverTrigger asChild>
                <Button>
                  <Text>Settings</Text>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <View className="flex-col gap-3">
                  <Heading level={4}>Settings</Heading>
                  <Text variant="secondary" size="sm">
                    Popovers can host arbitrary content — headings, body copy, action rows.
                  </Text>
                  <View className="mt-1 border-t border-border pt-3">
                    <Button variant="ghost" size="sm">
                      <Text>Action</Text>
                    </Button>
                  </View>
                </View>
              </PopoverContent>
            </Popover>
          </View>
        </View>
        <View>
          <Heading level={3}>ARIA pipeline</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            accessibilityRole, ariaLabel + ariaDescribedBy, and focus overrides. Focus-event
            callbacks are web-only — native keeps the line at the dash.
          </Text>
          <Text variant="muted" size="xs" className="mt-1">
            Last focus event: {focusEvent}
          </Text>
          <View className="mt-3">
            <Popover
              ariaLabel="Notification settings"
              ariaDescribedBy="popover-dev-desc"
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                setFocusEvent('open (default autofocus prevented)')
              }}
              onCloseAutoFocus={() => setFocusEvent('close')}
            >
              <PopoverTrigger asChild>
                <Button>
                  <Text>Notifications</Text>
                </Button>
              </PopoverTrigger>
              <PopoverContent accessibilityRole="dialog">
                <View className="flex-col gap-2">
                  <Heading level={4}>Notifications</Heading>
                  <Text id="popover-dev-desc" variant="muted" size="sm">
                    role=dialog, an accessible name via ariaLabel, and a described-by body.
                  </Text>
                </View>
              </PopoverContent>
            </Popover>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
