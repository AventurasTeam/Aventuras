import { useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { ActionsMenu, type ActionGroup } from '@/components/compounds/actions-menu'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

type Surface = 'reader' | 'world' | 'story-list' | 'app-settings'

const SURFACE_LABEL: Record<Surface, string> = {
  reader: 'Reader',
  world: 'World',
  'story-list': 'Story List (off-story)',
  'app-settings': 'App Settings (off-story, thinnest)',
}

export default function ActionsMenuDevRoute() {
  const [surface, setSurface] = useState<Surface>('reader')
  const [inFlight, setInFlight] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [lastFired, setLastFired] = useState<string>('')

  const fire = (id: string) => () => setLastFired(`${id} @ ${new Date().toLocaleTimeString()}`)

  const inFlightReason = 'Generation in progress — fields lock until complete'
  const withInFlightGating = (g: ActionGroup, mutating: ReadonlySet<string>): ActionGroup => ({
    ...g,
    entries: g.entries.map((e) =>
      inFlight && mutating.has(e.id) ? { ...e, disabled: true, disabledReason: inFlightReason } : e,
    ),
  })

  // GO TO with current-surface self-omit applied at the consumer level.
  const goToFor = (s: Surface): ActionGroup => {
    const allGoTo = [
      { id: 'open-reader', label: 'Open Reader', onActivate: fire('open-reader') },
      { id: 'open-world', label: 'Open World', onActivate: fire('open-world') },
      { id: 'open-plot', label: 'Open Plot', onActivate: fire('open-plot') },
      {
        id: 'open-chapter-timeline',
        label: 'Open Chapter Timeline',
        onActivate: fire('open-chapter-timeline'),
      },
      {
        id: 'open-story-settings',
        label: 'Open Story Settings',
        onActivate: fire('open-story-settings'),
      },
    ]
    const selfOmitId = s === 'reader' ? 'open-reader' : s === 'world' ? 'open-world' : undefined
    return {
      id: 'go-to',
      header: 'Go to',
      entries: selfOmitId ? allGoTo.filter((e) => e.id !== selfOmitId) : allGoTo,
    }
  }

  const storyTools: ActionGroup = withInFlightGating(
    {
      id: 'story-tools',
      header: 'Story tools',
      entries: [
        { id: 'set-lead', label: 'Set lead character…', onActivate: fire('set-lead') },
        { id: 'flip-era', label: 'Flip era…', onActivate: fire('flip-era') },
        { id: 'close-chapter', label: 'Close chapter…', onActivate: fire('close-chapter') },
      ],
    },
    new Set(['set-lead', 'flip-era', 'close-chapter']),
  )

  const app: ActionGroup = {
    id: 'app',
    header: 'App',
    entries: [
      { id: 'return-library', label: 'Return to Library', onActivate: fire('return-library') },
      {
        id: 'open-app-settings',
        label: 'Open App Settings',
        onActivate: fire('open-app-settings'),
      },
      {
        id: 'open-diagnostics',
        label: 'Open Diagnostics Hub',
        onActivate: fire('open-diagnostics'),
      },
    ],
  }

  // App-level surfaces drop their own destination from APP.
  const appFor = (s: Surface): ActionGroup => {
    const drop =
      s === 'story-list' ? 'return-library' : s === 'app-settings' ? 'open-app-settings' : undefined
    return drop ? { ...app, entries: app.entries.filter((e) => e.id !== drop) } : app
  }

  const contextualFor = (s: Surface): ActionGroup | undefined => {
    if (s === 'reader') {
      return withInFlightGating(
        {
          id: 'reader-context',
          header: 'On this screen',
          entries: [
            { id: 'jump-top', label: 'Jump to top of branch', onActivate: fire('jump-top') },
            { id: 'jump-bottom', label: 'Jump to bottom', onActivate: fire('jump-bottom') },
          ],
        },
        new Set(),
      )
    }
    if (s === 'world') {
      return withInFlightGating(
        {
          id: 'world-context',
          header: 'On this screen',
          entries: [
            { id: 'add-entity', label: 'Add entity…', onActivate: fire('add-entity') },
            { id: 'add-lore', label: 'Add lore…', onActivate: fire('add-lore') },
          ],
        },
        new Set(['add-entity', 'add-lore']),
      )
    }
    if (s === 'story-list') {
      return withInFlightGating(
        {
          id: 'story-list-context',
          header: 'On this screen',
          entries: [
            { id: 'new-story', label: 'New story…', onActivate: fire('new-story') },
            { id: 'import-story', label: 'Import story…', onActivate: fire('import-story') },
          ],
        },
        new Set(['new-story', 'import-story']),
      )
    }
    return undefined
  }

  const coreGroups: ActionGroup[] =
    surface === 'story-list' || surface === 'app-settings'
      ? [appFor(surface)]
      : [goToFor(surface), storyTools, app]

  const shortcutHint = Platform.OS === 'web' ? ' · press Cmd/Ctrl-K to open' : ''

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-4 p-4">
        <Heading level={3}>ActionsMenu</Heading>
        <Text variant="muted" size="xs">
          ⚲ trigger sits at the top-right of the surface row{shortcutHint}. Flip controls to inspect
          each state; selecting an entry fires its action and the menu closes.
        </Text>

        <View className="flex-row flex-wrap gap-2">
          {(Object.keys(SURFACE_LABEL) as Surface[]).map((s) => (
            <Button
              key={s}
              variant={surface === s ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => setSurface(s)}
            >
              <Text>{SURFACE_LABEL[s]}</Text>
            </Button>
          ))}
        </View>

        <View className="flex-row flex-wrap gap-2">
          <Button
            variant={inFlight ? 'primary' : 'secondary'}
            size="sm"
            onPress={() => setInFlight((v) => !v)}
          >
            <Text>{inFlight ? 'in-flight: ON' : 'in-flight: off'}</Text>
          </Button>
          <Button
            variant={blocked ? 'primary' : 'secondary'}
            size="sm"
            onPress={() => setBlocked((v) => !v)}
          >
            <Text>{blocked ? 'blocked: ON' : 'blocked: off'}</Text>
          </Button>
        </View>

        <View className="flex-row items-center justify-between gap-2 rounded-md border border-border bg-bg-overlay px-3 py-2">
          <Text size="sm" className="font-medium">
            {SURFACE_LABEL[surface]}
          </Text>
          <ActionsMenu
            contextual={contextualFor(surface)}
            coreGroups={coreGroups}
            blocked={blocked}
          />
        </View>

        <Text size="xs" variant="muted">
          Last fired: {lastFired || '(none yet)'}
        </Text>
      </View>
    </ScrollView>
  )
}
