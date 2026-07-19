'use dom'

import '@/global.css'

import { type DOMProps } from 'expo/dom'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { EntryCard, type EntryCardProps } from '@/components/compounds/entry-card'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { DensityProvider } from '@/lib/density'
import { ThemeProvider, useTheme } from '@/lib/themes'

// EntryCard renders entry HTML through a lowercase <div>, so it exists only in
// the web document — never a native RN tree. This dev gallery hosts it in a
// 'use dom' document exactly as the reader does, so it previews on every
// platform (a native RN tree has no div host and would crash).

const RESET_CSS =
  'html,body{margin:0;height:100%;background:transparent}' +
  '.entry-card-dev-root{position:fixed;inset:0;overflow-y:auto}'

// ThemeProvider seeds from initialThemeId at mount only; re-apply later switches
// (the native ThemePicker drives them) as prop updates, mirroring the reader.
function ThemeSync({ themeId }: { themeId: string }) {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme(themeId)
  }, [setTheme, themeId])
  return null
}

const aiMeta = { tokens: { prompt: 1840, completion: 312, reasoning: 87 } }

function Samples() {
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [lastAction, setLastAction] = useState<string | null>(null)

  const log = (action: string) => setLastAction(action)

  const startEdit = (id: string, initial: string) => {
    setEditing(id)
    setDrafts((d) => ({ ...d, [id]: initial }))
  }
  const commitEdit = (id: string) => {
    log(`Committed edit on ${id}: ${(drafts[id] ?? '').slice(0, 40)}…`)
    setEditing(null)
  }
  const cancelEdit = () => {
    log('Canceled edit')
    setEditing(null)
  }
  const updateDraft = (id: string, next: string) => setDrafts((d) => ({ ...d, [id]: next }))

  const editProps = (id: string, originalContent: string): Partial<EntryCardProps> =>
    editing === id
      ? {
          editing: true,
          content: drafts[id] ?? originalContent,
          onContentChange: (next) => updateDraft(id, next),
          onCommitEdit: () => commitEdit(id),
          onCancelEdit: cancelEdit,
        }
      : { onEdit: () => startEdit(id, originalContent) }

  const opening = 'The road from Ironshore is empty for a hundred miles.'
  const userTurn = 'I draw my sword and step toward the figure.'
  const aiTurn =
    'The figure raises a single gloved hand. The air thickens around your blade — you feel the metal hum, then go still in your grip.'

  return (
    <View className="flex-col gap-10 p-4">
      <View className="gap-3">
        <Heading level={2}>Reader narrative — interactive</Heading>
        <Text size="sm" variant="muted">
          Click pencil to enter edit mode. Edit-host wires save/cancel via callbacks; this dev route
          mirrors that.
        </Text>
        {lastAction != null ? (
          <Text size="xs" variant="muted">
            Last: {lastAction}
          </Text>
        ) : null}
        <View className="flex-col gap-3">
          <EntryCard
            kind="opening"
            content={opening}
            worldTimeLabel="Day 1 · 06:00"
            meta={{ tokens: { prompt: 1120, completion: 89 } }}
            onBranch={() => log('Branch from opening')}
            onFlipEra={() => log('Flip era on opening')}
            {...editProps('opening', opening)}
          />
          <EntryCard
            kind="user_action"
            content={userTurn}
            worldTimeLabel="Day 1 · 09:14"
            onDelete={() => log('Delete user turn')}
            onFlipEra={() => log('Flip era on user')}
            {...editProps('user', userTurn)}
          />
          <EntryCard
            kind="ai_reply"
            content={aiTurn}
            worldTimeLabel="Day 1 · 09:14"
            meta={aiMeta}
            reasoning="Lean on supernatural restraint over combat — telegraph 'cannot win this'."
            onRegen={() => log('Regen ai')}
            onBranch={() => log('Branch from ai')}
            onDelete={() => log('Delete ai')}
            onFlipEra={() => log('Flip era on ai')}
            {...editProps('ai', aiTurn)}
          />
          <EntryCard
            kind="streaming"
            streamingPhase="reasoning"
            content="Considering whether the warden answers in words or violence…"
          />
        </View>
      </View>

      <View className="gap-3">
        <Heading level={2}>System error</Heading>
        <Text size="sm" variant="muted">
          Inline retry/dismiss buttons inside the bubble; no top-right cluster, no world-time
          footer.
        </Text>
        <EntryCard
          kind="system"
          content="Generation failed: provider returned 503."
          detail="The model service is temporarily unavailable."
          onRetry={() => log('Retry')}
          onDismiss={() => log('Dismiss')}
        />
      </View>

      <View className="gap-3">
        <Heading level={2}>Disabled state (generation in flight)</Heading>
        <Text size="sm" variant="muted">
          All actions disabled with the host&apos;s reason. Hover an action on web for the tooltip.
        </Text>
        <EntryCard
          kind="ai_reply"
          content={aiTurn}
          worldTimeLabel="Day 1 · 09:14"
          meta={aiMeta}
          disabled
          disabledReason="Generation is in flight. Cancel to edit."
          onEdit={() => {}}
          onDelete={() => {}}
          onRegen={() => {}}
          onBranch={() => {}}
          onFlipEra={() => {}}
        />
      </View>
    </View>
  )
}

export default function EntryCardDevDocument({ themeId }: { themeId: string; dom?: DOMProps }) {
  return (
    <ThemeProvider initialThemeId={themeId}>
      <DensityProvider>
        <ThemeSync themeId={themeId} />
        <style>{RESET_CSS}</style>
        <div className="entry-card-dev-root bg-bg-base">
          <Samples />
        </div>
      </DensityProvider>
    </ThemeProvider>
  )
}
