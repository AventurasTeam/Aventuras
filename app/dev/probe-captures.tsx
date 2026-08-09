import { useCallback, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { JSONViewer } from '@/components/compounds/json-viewer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { queryRows, runInTransaction, type SqlOp } from '@/lib/db'
import {
  armDeepCapture,
  capturesForStoryQuery,
  clearCapturesForStoryOp,
  decodeCaptures,
  deleteCaptureOp,
  type CorruptCapture,
  type StoredCapture,
} from '@/lib/probe'

export default function ProbeCapturesDevRoute() {
  const [storyId, setStoryId] = useState('')
  const [captures, setCaptures] = useState<StoredCapture[]>([])
  const [corrupt, setCorrupt] = useState<CorruptCapture[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewingCapture, setViewingCapture] = useState<StoredCapture | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const q = capturesForStoryQuery(storyId)
      const decoded = decodeCaptures(await queryRows(q.sql, q.params))
      setCaptures(decoded.ok)
      setCorrupt(decoded.corrupt)
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [storyId])

  const runMutation = useCallback(
    (op: SqlOp) =>
      runInTransaction([op])
        .then(load)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    [load],
  )

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
        <Button variant="secondary" onPress={load} loading={loading}>
          <Text>Load</Text>
        </Button>
      </View>
      <View className="flex-row items-center gap-2">
        <Button
          variant="secondary"
          onPress={() => {
            armDeepCapture()
            setArmed(true)
          }}
        >
          <Text>Arm deep capture</Text>
        </Button>
        {armed ? (
          <Text size="xs" variant="muted">
            Armed for the next retrieval pass
          </Text>
        ) : null}
        <Button variant="destructive" onPress={() => runMutation(clearCapturesForStoryOp(storyId))}>
          <Text>Clear story</Text>
        </Button>
      </View>
      {error ? (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      ) : null}
      {loaded && !error && captures.length === 0 && corrupt.length === 0 ? (
        <Text size="sm" variant="muted">
          No captures for this story — check the story id, or write one first.
        </Text>
      ) : null}
      {captures.map((c) => (
        <View key={`${c.branchId}:${c.id}`} className="gap-1 border-t border-border pt-2">
          <View className="flex-row items-center justify-between">
            <Text size="sm">
              {c.id} · {c.branchId} · {c.captureMode} · {c.payloadSize ?? 0} B
              {c.failureReason ? ` · FAILED: ${c.failureReason}` : ''}
            </Text>
            <View className="flex-row gap-2">
              <Button variant="ghost" onPress={() => setViewingCapture(c)}>
                <Text>View JSON</Text>
              </Button>
              <Button
                variant="ghost"
                onPress={() => runMutation(deleteCaptureOp(c.branchId, c.id))}
              >
                <Text>Delete</Text>
              </Button>
            </View>
          </View>
        </View>
      ))}
      {corrupt.map((c) => (
        <View key={`corrupt:${c.branchId}:${c.id}`} className="gap-1 border-t border-danger pt-2">
          <View className="flex-row items-center justify-between">
            <Text size="sm" className="text-danger">
              {c.id} · {c.branchId} · corrupt — {c.error.message}
            </Text>
            <Button variant="ghost" onPress={() => runMutation(deleteCaptureOp(c.branchId, c.id))}>
              <Text>Delete</Text>
            </Button>
          </View>
        </View>
      ))}
      <JSONViewer
        open={viewingCapture !== null}
        onOpenChange={(open) => {
          if (!open) setViewingCapture(null)
        }}
        name={viewingCapture ? `${viewingCapture.id} · ${viewingCapture.branchId}` : ''}
        data={viewingCapture?.payload}
      />
    </ScrollView>
  )
}
