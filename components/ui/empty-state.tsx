import { type ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type EmptyStateProps = ViewProps & {
  title: string
  subtext?: ReactNode
  className?: string
}

export function EmptyState({ title, subtext, className, ...props }: EmptyStateProps) {
  return (
    <View
      accessibilityRole="text"
      className={cn('items-center justify-center px-6 py-12', className)}
      {...props}
    >
      <Text className="text-center text-base font-medium text-fg-primary">{title}</Text>
      {subtext && (
        <Text className="mt-2 max-w-md text-center text-sm text-fg-secondary">{subtext}</Text>
      )}
    </View>
  )
}

export type { EmptyStateProps }
