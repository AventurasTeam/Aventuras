import { useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { reseedDevDatabase } from '@/lib/db'

type Status =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; tables: number; rows: number }
  | { phase: 'error'; message: string }

export default function ReseedDevRoute() {
  const [status, setStatus] = useState<Status>({ phase: 'idle' })

  const runReseed = async () => {
    setStatus({ phase: 'running' })
    try {
      const summary = await reseedDevDatabase()
      setStatus({ phase: 'done', ...summary })
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <ScrollView className="flex-1 bg-bg-base" contentContainerClassName="gap-4 p-4">
      <Heading level={2}>Reseed database</Heading>
      <Text variant="muted">
        Wipes every table and reinserts the dev seed dataset — the same data as `pnpm db:seed` on
        desktop, including the rich-rendering validation story. All existing stories and settings on
        this device are lost.
      </Text>
      {Platform.OS === 'web' ? (
        <Text variant="muted">On desktop/web, run `pnpm db:seed` instead.</Text>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={status.phase === 'running'}>
            <Text>Wipe and reseed</Text>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wipe this device&apos;s data?</AlertDialogTitle>
            <AlertDialogDescription>
              Every story, entity, and setting in the on-device database is deleted and replaced
              with the seed dataset. There is no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">
                <Text>Cancel</Text>
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onPress={() => void runReseed()}>
                <Text>Wipe and reseed</Text>
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <View>
        {status.phase === 'running' ? <Text variant="muted">Reseeding…</Text> : null}
        {status.phase === 'done' ? (
          <Text>
            Done — {status.rows} rows across {status.tables} tables. Restart the app (or reopen the
            story list) so stores rehydrate from the fresh data.
          </Text>
        ) : null}
        {status.phase === 'error' ? <Text className="text-danger">{status.message}</Text> : null}
      </View>
    </ScrollView>
  )
}
