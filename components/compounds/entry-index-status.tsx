import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'

export type EntryIndexStatusProps = {
  /** The index read failed; otherwise it's still being read. */
  failed: boolean
  onRetry: () => void
  loadingTitle: string
  failedTitle: string
  failedBody: string
  retryLabel: string
}

/** What a surface waiting on the branch's entry index shows: loading, or a failure with Retry. */
export function EntryIndexStatus({
  failed,
  onRetry,
  loadingTitle,
  failedTitle,
  failedBody,
  retryLabel,
}: EntryIndexStatusProps): ReactNode {
  if (!failed) return <EmptyState title={loadingTitle} />
  return (
    <View className="items-center gap-3">
      <EmptyState title={failedTitle} subtext={failedBody} />
      <Button variant="secondary" onPress={onRetry}>
        <Text>{retryLabel}</Text>
      </Button>
    </View>
  )
}
