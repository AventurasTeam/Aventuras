import { useCallback, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { queryRows, runInTransaction } from '@/lib/db'
import {
  armDeepCapture,
  capturesForStoryQuery,
  clearCapturesForStoryOp,
  decodeCaptures,
  deleteCaptureOp,
  type StoredCapture,
} from '@/lib/probe'

type CorruptCapture = { id: string; branchId: string; error: Error }

export default function ProbeCapturesDevRoute() {
  const [storyId, setStoryId] = useState('')
  const [captures, setCaptures] = useState<StoredCapture[]>([])
  const [corrupt, setCorrupt] = useState<CorruptCapture[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const q = capturesForStoryQuery(storyId)
      const decoded = decodeCaptures(await queryRows(q.sql, q.params))
      setCaptures(decoded.ok)
      setCorrupt(decoded.corrupt)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [storyId])

  return (
    <ScrollView className="flex-1 bg-bg-base" contentContainerClassName="gap-3 p-4">
      <Text size="lg">Probe captures</Text>
      <View className="flex-row gap-2">
        <Input
          value={storyId}
          onChangeText={setStoryId}
          placeholder="story id"
          className="flex-1"
        />
        <Button variant="secondary" onPress={load}>
          <Text>Load</Text>
        </Button>
      </View>
      <View className="flex-row gap-2">
        <Button variant="secondary" onPress={armDeepCapture}>
          <Text>Arm deep capture</Text>
        </Button>
        <Button
          variant="destructive"
          onPress={() => runInTransaction([clearCapturesForStoryOp(storyId)]).then(load)}
        >
          <Text>Clear story</Text>
        </Button>
      </View>
      {error ? (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      ) : null}
      {captures.map((c) => (
        <View key={`${c.branchId}:${c.id}`} className="gap-1 border-t border-border pt-2">
          <View className="flex-row items-center justify-between">
            <Text size="sm">
              {c.id} · {c.branchId} · {c.captureMode} · {c.payloadSize ?? 0} B
              {c.failureReason ? ` · FAILED: ${c.failureReason}` : ''}
            </Text>
            <Button
              variant="ghost"
              onPress={() => runInTransaction([deleteCaptureOp(c.branchId, c.id)]).then(load)}
            >
              <Text>Delete</Text>
            </Button>
          </View>
          <Text size="xs" className="font-mono">
            {JSON.stringify(c.payload, null, 2)}
          </Text>
        </View>
      ))}
      {corrupt.map((c) => (
        <View key={`corrupt:${c.branchId}:${c.id}`} className="gap-1 border-t border-danger pt-2">
          <View className="flex-row items-center justify-between">
            <Text size="sm" className="text-danger">
              {c.id} · {c.branchId} · corrupt — {c.error.message}
            </Text>
            <Button
              variant="ghost"
              onPress={() => runInTransaction([deleteCaptureOp(c.branchId, c.id)]).then(load)}
            >
              <Text>Delete</Text>
            </Button>
          </View>
        </View>
      ))}
    </ScrollView>
  )
}
