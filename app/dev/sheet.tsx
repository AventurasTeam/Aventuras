import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'

function KeyboardOrderingProbe() {
  const [note, setNote] = useState('')
  // Controlled deliberately. Sheet swaps Input's TextInput for gorhom's
  // BottomSheetTextInput, which renders gesture-handler's wrapped TextInput
  // rather than RN's — so a value round-trip inside a sheet takes a different
  // path to every other field in the app. An uncontrolled probe cannot see it.
  const [sheetNote, setSheetNote] = useState('')
  return (
    <View>
      <Heading level={3}>Keyboard ordering (phone)</Heading>
      <Text variant="muted" size="xs" className="mt-1">
        Focus the field, then — without dismissing — open the sheet. Sheet.tsx dismisses an open
        keyboard before presenting, because gorhom only learns about the keyboard from show/hide
        events and would otherwise open underneath it. Expect: keyboard closes, sheet opens at its
        detent, focusing the sheet&apos;s own field lifts it.
      </Text>
      <View className="mt-3 flex-col gap-3">
        <Input value={note} onChangeText={setNote} placeholder="Focus me first" aria-label="Note" />
        <Sheet ariaLabel="Keyboard ordering">
          <SheetTrigger asChild>
            <Button variant="secondary">
              <Text>Open short sheet</Text>
            </Button>
          </SheetTrigger>
          <SheetContent anchor="bottom" size="short">
            <View className="flex-col gap-3">
              <Heading level={4}>Short sheet</Heading>
              <Input
                value={sheetNote}
                onChangeText={setSheetNote}
                placeholder="Then focus this one"
                aria-label="Sheet field"
              />
              <Text variant="muted" size="xs">
                Cursor probe: type `Buh`, put the caret between `u` and `h`, press backspace. Expect
                `Bh` with the caret still between `B` and `h` — not jumped to the start.
              </Text>
            </View>
          </SheetContent>
        </Sheet>
      </View>
    </View>
  )
}

export default function SheetDevRoute() {
  const [noteValue, setNoteValue] = useState('')

  return (
    <ScrollView className="flex-1 bg-bg-base" keyboardShouldPersistTaps="handled">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <KeyboardOrderingProbe />

        <View>
          <Heading level={3}>Default</Heading>
          <View className="mt-2">
            <Sheet ariaLabel="Sheet">
              <SheetTrigger asChild>
                <Button>
                  <Text>Open sheet</Text>
                </Button>
              </SheetTrigger>
              <SheetContent>
                <View className="flex-col gap-3">
                  <Heading level={3}>Sheet</Heading>
                  <Text variant="muted" size="sm">
                    Bottom-anchored, medium height. Tap outside or press the back gesture to
                    dismiss.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
        <View>
          <Heading level={3}>Anchors</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            On phone, bottom is the natural shape; right is included for parity (collapses awkwardly
            on narrow screens).
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Sheet ariaLabel="Bottom anchor">
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>bottom</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="medium">
                <View className="flex-col gap-2">
                  <Heading level={4}>Bottom anchor</Heading>
                  <Text variant="muted" size="sm">
                    Slides up from the bottom edge with a drag handle.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
            <Sheet ariaLabel="Right anchor">
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>right</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="right">
                <View className="flex-col gap-2">
                  <Heading level={4}>Right anchor</Heading>
                  <Text variant="muted" size="sm">
                    Slides in from the right edge. Desktop / wide-tablet shape; tight on phone.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
        <View>
          <Heading level={3}>Sizes</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            short ~33vh, medium ~60vh, tall ~95vh — applies to bottom anchor only.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Sheet ariaLabel="Short sheet">
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>short</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="short">
                <View className="flex-col gap-2">
                  <Heading level={4}>Short</Heading>
                  <Text variant="muted" size="sm">
                    ~33vh — flat lists of short labels.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
            <Sheet ariaLabel="Medium sheet">
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>medium</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="medium">
                <View className="flex-col gap-2">
                  <Heading level={4}>Medium</Heading>
                  <Text variant="muted" size="sm">
                    ~60vh — grouped or rich-row lists.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
            <Sheet ariaLabel="Tall sheet">
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>tall</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="tall">
                <View className="flex-col gap-2">
                  <Heading level={4}>Tall</Heading>
                  <Text variant="muted" size="sm">
                    ~95vh — rich detail (peek drawer, raw JSON viewer).
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
        <View>
          <Heading level={3}>Auto size</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            size=&quot;auto&quot; — no fixed height; content drives the panel, capped at 95vh. Best
            for short editors whose intrinsic height doesn&apos;t fit any rigid size
            (ColorPicker&apos;s custom-color editor uses this).
          </Text>
          <View className="mt-3">
            <Sheet ariaLabel="Confirm action">
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>auto</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="auto">
                <View className="flex-col gap-3">
                  <Heading level={4}>Auto-sized</Heading>
                  <Text variant="muted" size="sm">
                    Content drives the height. No dead space below the actions.
                  </Text>
                  <View className="flex-row justify-end gap-2">
                    <Button variant="ghost">
                      <Text>Cancel</Text>
                    </Button>
                    <Button>
                      <Text>Confirm</Text>
                    </Button>
                  </View>
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
        <View>
          <Heading level={3}>With input inside (auto — canonical)</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Input-bearing sheets use size=&quot;auto&quot;. The panel hugs its content and the
            underlying library translates it above the keyboard when an input is focused. No
            consumer-side keyboard wiring needed.
          </Text>
          <View className="mt-3">
            <Sheet ariaLabel="Add note">
              <SheetTrigger asChild>
                <Button>
                  <Text>Add note…</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="auto">
                <View className="flex-col gap-3">
                  <Heading level={4}>Add note</Heading>
                  <Text variant="muted" size="sm">
                    Type to test keyboard avoidance on native.
                  </Text>
                  <Input value={noteValue} onChangeText={setNoteValue} placeholder="Type here…" />
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
