import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { EntryCard, type EntryKind, type EntryMeta } from '@/components/compounds/entry-card'
import { ScreenShell } from '@/components/shells/screen-shell'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'

type ReaderEntry = {
  id: string
  kind: EntryKind
  content: string
  meta?: EntryMeta
}

export default function ReaderComposerRoute() {
  const router = useRouter()
  const tier = useTier()
  const showRail = tier !== 'phone'
  const [draft, setDraft] = useState('')

  // Entries arrive in a later slice; for now this stays empty and EmptyState shows.
  const entries: ReaderEntry[] = []

  return (
    <ScreenShell
      variant="in-story"
      title={<Text className="font-semibold">{t('reader:placeholderTitle')}</Text>}
      chapterProgress={0}
      onBack={() => router.back()}
      actions={<AppActionsMenu />}
    >
      <View className="flex-1 flex-row">
        <View className="flex-1">
          {entries.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState title={t('reader:emptyTitle')} subtext={t('reader:emptyBody')} />
            </View>
          ) : (
            <ScrollView className="flex-1" contentContainerClassName="gap-3 p-4">
              {entries.map((e) => (
                <EntryCard key={e.id} kind={e.kind} content={e.content} meta={e.meta} />
              ))}
            </ScrollView>
          )}
          <View className="gap-2 border-t border-border p-3">
            <Textarea
              placeholder={t('reader:composerPlaceholder')}
              value={draft}
              onChangeText={setDraft}
            />
            <View className="flex-row justify-end">
              <Button variant="primary" disabled>
                <Text>{t('reader:send')}</Text>
              </Button>
            </View>
          </View>
        </View>
        {showRail ? (
          <View className="w-[260px] border-l border-border bg-bg-sunken p-3">
            <Text variant="muted" size="sm">
              {t('reader:railPlaceholder')}
            </Text>
          </View>
        ) : null}
      </View>
    </ScreenShell>
  )
}
