import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { Platform, type TextInput } from 'react-native'
import { Commands as AndroidTextInputCommands } from 'react-native/Libraries/Components/TextInput/AndroidTextInputNativeComponent'
import { Commands as MultilineTextInputCommands } from 'react-native/Libraries/Components/TextInput/RCTMultilineTextInputNativeComponent'
import { Commands as SinglelineTextInputCommands } from 'react-native/Libraries/Components/TextInput/RCTSingelineTextInputNativeComponent'

import type { ControlledTextSyncArgs, ControlledTextSyncResult } from './controlled-text-sync-types'

type ChangeEvent = Parameters<NonNullable<ComponentProps<typeof TextInput>['onChange']>>[0]

// Inside a portal (@rn-primitives/dialog — every Sheet/Select form), the
// consumer's state lives outside the portal, so a controlled `value` reaches
// the mounted TextInput one commit late. RN's internal sync effect sees the
// mismatch in that intermediate commit and rewrites the native text with a
// current event count — native accepts the revert and the caret snaps one
// position left on any mid-string edit. So: never hand `value` to the native
// TextInput. Track native text via onChange; push imperatively (the same
// setTextAndSelection command RN's own clear() uses) only when `value`
// genuinely diverges — clear buttons, resets, programmatic fills. While the
// field is being typed in, native text is authoritative.
// Full bisect: docs/implementation/lessons-learned/portal-controlled-textinput-caret.md
export function useControlledTextSync({
  value,
  defaultValue,
  multiline,
  onChange,
}: ControlledTextSyncArgs): ControlledTextSyncResult {
  const hostRef = useRef<TextInput | null>(null)
  const [initialText] = useState(() => value ?? defaultValue)
  const lastNativeTextRef = useRef(initialText ?? '')
  const eventCountRef = useRef(0)

  const handleChange = (event: ChangeEvent) => {
    lastNativeTextRef.current = event.nativeEvent.text
    eventCountRef.current = event.nativeEvent.eventCount
    onChange?.(event)
  }

  useLayoutEffect(() => {
    if (typeof value !== 'string' || value === lastNativeTextRef.current) return
    lastNativeTextRef.current = value
    const host = hostRef.current
    if (host == null) return
    const commands =
      Platform.OS === 'android'
        ? AndroidTextInputCommands
        : multiline === true
          ? MultilineTextInputCommands
          : SinglelineTextInputCommands
    commands.setTextAndSelection(host, eventCountRef.current, value, value.length, value.length)
  }, [value, multiline])

  return { hostRef, fieldProps: { defaultValue: initialText, onChange: handleChange } }
}
