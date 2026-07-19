import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import ReaderDocumentSpike from '@/components/dev/reader-document-spike'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { readRecentEntries } from '@/lib/actions'
import { db, type StoryEntry } from '@/lib/db'
import { useTheme } from '@/lib/themes'

// SPIKE surface for the single-document reader pivot — see
// components/dev/reader-document-spike.tsx. Needs a seeded DB (/dev/reseed).

const SPIKE_BRANCHES = [
  { key: 'rich', label: 'Rich story', branchId: 'branch_rich_main' },
  { key: 'hero', label: 'MD-only story', branchId: 'branch_hero_main' },
] as const

export default function ReaderWebviewSpikeRoute() {
  const { theme } = useTheme()
  const [branchId, setBranchId] = useState<string>(SPIKE_BRANCHES[0].branchId)
  const [rows, setRows] = useState<StoryEntry[] | null>(null)
  const [firstPaintMs, setFirstPaintMs] = useState<number | null>(null)
  const mountedAtRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setFirstPaintMs(null)
    void readRecentEntries(branchId, db).then((loaded) => {
      if (cancelled) return
      mountedAtRef.current = Date.now()
      setRows(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [branchId])

  const handleFirstPaint = useCallback(async () => {
    setFirstPaintMs(Date.now() - mountedAtRef.current)
  }, [])

  return (
    <View className="flex-1 bg-bg-base">
      <View className="flex-row items-center gap-2 p-2">
        {SPIKE_BRANCHES.map((b) => (
          <Button
            key={b.key}
            size="sm"
            variant={b.branchId === branchId ? 'primary' : 'secondary'}
            onPress={() => setBranchId(b.branchId)}
          >
            <Text>{b.label}</Text>
          </Button>
        ))}
        <Text size="xs" variant="muted">
          {rows == null ? 'loading rows…' : `${rows.length} entries`}
          {firstPaintMs != null ? ` · first paint ${firstPaintMs}ms` : ''}
        </Text>
      </View>
      <View className="flex-1">
        {rows != null ? (
          <ReaderDocumentSpike
            key={branchId}
            rows={rows}
            themeId={theme.id}
            onFirstPaint={handleFirstPaint}
            dom={{ scrollEnabled: false, style: { flex: 1 } }}
          />
        ) : null}
      </View>
    </View>
  )
}
