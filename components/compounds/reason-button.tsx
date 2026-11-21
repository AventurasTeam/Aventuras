import type { ComponentProps, ReactElement } from 'react'
import { Platform, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export type ReasonButtonProps = ComponentProps<typeof Button> & {
  /** 'start' and 'end' keep the button label-sized at that end of a row; 'stretch' fills it. Default 'start'. */
  layout?: 'start' | 'end' | 'stretch'
}

const LAYOUT_CLASS = {
  start: 'items-start self-start',
  end: 'ml-auto items-end self-start',
  stretch: 'self-stretch',
} as const

/**
 * A Button whose disabled reason reaches native readers too: web keeps Button's tooltip, and native,
 * which has none, shows the reason as a muted line under the button while it is disabled.
 */
export function ReasonButton({ layout = 'start', ...props }: ReasonButtonProps): ReactElement {
  const disabled = props.disabled === true || props.loading === true
  const line = Platform.OS !== 'web' && disabled ? props.disabledReason : undefined
  return (
    <View className={cn('gap-0.5', LAYOUT_CLASS[layout])}>
      <Button {...props} />
      {line != null && line !== '' ? (
        <Text size="xs" variant="muted">
          {line}
        </Text>
      ) : null}
    </View>
  )
}
