import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { ImporterMenu, type ImporterMenuOption } from '@/components/compounds/importer-menu'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

// Live event log so the dev route surfaces which option fired —
// useful for sanity-checking the menu close-after-select behavior
// against the caller's onPress wiring.
function useEventLog() {
  const [events, setEvents] = React.useState<string[]>([])
  const log = React.useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString()
    setEvents((prev) => [`${ts} · ${msg}`, ...prev].slice(0, 8))
  }, [])
  return { events, log }
}

export default function ImporterMenuDevRoute() {
  const entityLog = useEventLog()
  const calendarLog = useEventLog()
  const storyLog = useEventLog()

  const entityOptions: ImporterMenuOption[] = [
    { key: 'blank', label: 'Blank', onPress: () => entityLog.log('blank') },
    { key: 'json', label: 'From JSON file…', onPress: () => entityLog.log('from-json') },
    {
      key: 'vault',
      label: 'From Vault…',
      disabled: true,
      disabledReason: 'Vault library coming later.',
    },
  ]

  const calendarOptions: ImporterMenuOption[] = [
    {
      key: 'clone',
      label: 'Clone built-in…',
      description: 'Start from Earth, Imperial Japan, or another preset.',
      onPress: () => calendarLog.log('clone-built-in'),
    },
    {
      key: 'json',
      label: 'From JSON file…',
      description: 'Upload an .avts file with a calendar envelope.',
      onPress: () => calendarLog.log('from-json'),
    },
    {
      key: 'scratch',
      label: 'From scratch',
      description: 'Build leap rules and era sets manually.',
      disabled: true,
      disabledReason: 'Deferred to L3 — clone an existing calendar for now.',
    },
  ]

  const storyOptions: ImporterMenuOption[] = [
    { key: 'json', label: 'From JSON file…', onPress: () => storyLog.log('from-json') },
    {
      key: 'vault',
      label: 'From Vault…',
      disabled: true,
      disabledReason: 'Vault library coming later.',
    },
  ]

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-8 p-4">
        <Section title="Per-row entity (+ New character ▾)" log={entityLog.events}>
          <ImporterMenu label="+ New character" options={entityOptions} />
        </Section>

        <Section title="Vault calendar add (+ Add calendar ▾)" log={calendarLog.events}>
          <ImporterMenu label="+ Add calendar" options={calendarOptions} />
        </Section>

        <Section title="Story import — secondary variant" log={storyLog.events}>
          <ImporterMenu label="Import story" options={storyOptions} variant="secondary" />
        </Section>

        <Section title="Disabled trigger" log={[]}>
          <ImporterMenu label="+ New character" options={entityOptions} disabled />
          <Text size="xs" variant="muted" className="mt-2">
            The trigger button is gated; the menu can&apos;t open.
          </Text>
        </Section>
      </View>
    </ScrollView>
  )
}

function Section({
  title,
  log,
  children,
}: {
  title: string
  log: string[]
  children: React.ReactNode
}) {
  return (
    <View className="gap-3">
      <Heading level={3}>{title}</Heading>
      <View className="flex-row items-start">{children}</View>
      {log.length > 0 ? (
        <View className="rounded-md border border-border bg-bg-sunken p-3">
          {log.map((line) => (
            <Text key={line} size="xs" variant="muted" className="font-mono">
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  )
}
