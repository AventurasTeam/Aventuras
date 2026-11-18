import type { ComponentProps, ReactElement } from 'react'
import { Platform, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export type ReasonButtonProps = ComponentProps<typeof Button> & {
  /** 'start' keeps the button label-sized; 'stretch' fills the row. Default 'start'. */
  layout?: 'start' | 'stretch'
}

/**
 * A Button whose disabled reason reaches native readers too: web keeps Button's tooltip, and native,
 * which has none, shows the reason as a muted line under the button while it is disabled.
 */
export function ReasonButton({ layout = 'start', ...props }: ReasonButtonProps): ReactElement {
  const disabled = props.disabled === true || props.loading === true
  const line = Platform.OS !== 'web' && disabled ? props.disabledReason : undefined
  return (
    <View
      className={cn('gap-0.5', layout === 'stretch' ? 'self-stretch' : 'items-start self-start')}
    >
      <Button {...props} />
      {line != null && line !== '' ? (
        <Text size="xs" variant="muted">
          {line}
        </Text>
      ) : null}
    </View>
  )
}
