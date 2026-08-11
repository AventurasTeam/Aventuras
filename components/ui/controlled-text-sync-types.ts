import type { ComponentProps, Ref } from 'react'
import type { TextInput } from 'react-native'

type TextInputProps = ComponentProps<typeof TextInput>

export type ControlledTextSyncArgs = {
  value: TextInputProps['value']
  defaultValue: TextInputProps['defaultValue']
  multiline: TextInputProps['multiline']
  onChange: TextInputProps['onChange']
}

export type ControlledTextSyncResult = {
  hostRef: Ref<TextInput> | undefined
  fieldProps: Pick<TextInputProps, 'value' | 'defaultValue' | 'onChange'>
}
