import { sql, type SQL } from 'drizzle-orm'
import { useCallback, useEffect, useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { db } from '@/lib/db'

type Check = { label: string; result?: string; error?: string }

const CHECKS: [string, SQL][] = [
  ['sqlite-vec version', sql`select vec_version() as v`],
  ['tables', sql`select name from sqlite_master where type = 'table' order by name`],
  ['app_settings singleton', sql`select id, diagnostics from app_settings`],
]

async function runChecks(): Promise<Check[]> {
  const out: Check[] = []
  for (const [label, query] of CHECKS) {
    try {
      const rows = await db.all(query)
      out.push({ label, result: JSON.stringify(rows) })
    } catch (e) {
      out.push({ label, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

export default function DbCheckDevRoute() {
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)

  const run = useCallback(() => {
    setRunning(true)
    runChecks()
      .then(setChecks)
      .finally(() => setRunning(false))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-bg-base"
      contentContainerClassName="gap-4 p-4"
    >
      <Text size="lg">DB check — {Platform.OS}</Text>
      <Button variant="secondary" onPress={run} loading={running}>
        <Text>Re-run checks</Text>
      </Button>
      {checks.map((c) => (
        <View key={c.label} className="gap-1">
          <Text size="sm">{c.label}</Text>
          <Text variant="muted" size="xs">
            {c.error ? `✗ ${c.error}` : `✓ ${c.result}`}
          </Text>
        </View>
      ))}
    </ScrollView>
  )
}
