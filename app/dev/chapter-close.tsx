import { skipToken, useQuery } from '@tanstack/react-query'
import { Link, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { readerHref } from '@/components/reader/reader-href'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { single } from '@/components/world/world-selection'
import { useColdOpenStory } from '@/hooks/use-cold-open-story'
import { startManualClose } from '@/lib/actions'
import { canEndChapter } from '@/lib/chapters'
import { db, openRegionSeries, runInTransaction } from '@/lib/db'
import { pipelineErrorDetail, type RejectedStart, type TxResult } from '@/lib/pipeline'
import { currentStoryStore, generationStore } from '@/lib/stores'

const ctx = { db, runInTransaction }

function describeResult(result: TxResult | RejectedStart): string {
  switch (result.outcome) {
    case 'completed':
    case 'aborted':
      return result.outcome
    case 'rejected':
      return `rejected: ${result.blockedBy}`
    case 'failed':
      return `failed: ${result.error.kind}: ${pipelineErrorDetail(result.error) ?? ''}`
  }
}

// No __DEV__ gate: it is false under E2E, which drives this route until real starts land (M5.10).
export default function ChapterCloseDevRoute() {
  const params = useLocalSearchParams<{ branchId?: string | string[] }>()
  const openBranchId = currentStoryStore.useCurrentStory((open) => open?.branchId ?? null)
  const branchId = single(params.branchId) ?? openBranchId
  if (branchId == null)
    return (
      <View className="flex-1 bg-bg-base p-4">
        <Text>{'Open a story first, or pass ?branchId=<id>.'}</Text>
      </View>
    )
  return <ChapterClose key={branchId} branchId={branchId} />
}

function ChapterClose({ branchId }: { branchId: string }) {
  const open = useColdOpenStory(branchId, 'dev_chapter_close')
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const replies = useQuery({
    queryKey: ['dev-chapter-close', branchId, settleCount],
    queryFn:
      open == null
        ? skipToken
        : async () => (await openRegionSeries(branchId, ctx)).filter(canEndChapter),
  })
  const [status, setStatus] = useState('idle')

  const close = async (endEntryId: string) => {
    setStatus('running')
    try {
      setStatus(describeResult(await startManualClose(branchId, endEntryId, ctx)))
    } catch (e) {
      setStatus(`error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-bg-base"
      contentContainerClassName="gap-3 p-4"
    >
      <Text size="lg">Chapter close</Text>
      <Text size="sm" variant="muted">
        {open == null ? `Opening ${branchId}…` : `${open.storyId} · ${branchId}`}
      </Text>
      <View className="flex-row gap-2">
        <Link href={{ pathname: '/plot/[branchId]', params: { branchId } }} asChild>
          <Button variant="secondary">
            <Text>Open Plot</Text>
          </Button>
        </Link>
        <Link href={readerHref(branchId)} asChild>
          <Button variant="secondary">
            <Text>Open reader</Text>
          </Button>
        </Link>
      </View>
      <Text testID="dev-close-result">{status}</Text>
      {replies.error ? (
        <Text size="sm" className="text-danger">
          {replies.error.message}
        </Text>
      ) : null}
      {replies.data?.length === 0 ? (
        <Text size="sm" variant="muted">
          No reply in the open region.
        </Text>
      ) : null}
      {replies.data?.map((row) => (
        <Button
          key={row.id}
          variant="secondary"
          disabled={status === 'running'}
          onPress={() => void close(row.id)}
        >
          <Text>{`Close at #${row.position}`}</Text>
        </Button>
      ))}
    </ScrollView>
  )
}
