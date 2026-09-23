import { useCallback, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { TagInput } from '@/components/compounds/tag-input'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function TagInputDevRoute() {
  const [storyTags, setStoryTags] = useState<string[]>(['sci-fi', 'fantasy', 'dystopia'])
  const [entityTags, setEntityTags] = useState<string[]>([])
  const [capped, setCapped] = useState<string[]>([])
  const [genInFlight, setGenInFlight] = useState(false)
  const [eventLog, setEventLog] = useState<string[]>([])

  const log = useCallback((msg: string) => {
    setEventLog((prev) => [`${new Date().toLocaleTimeString()} · ${msg}`, ...prev].slice(0, 8))
  }, [])

  return (
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-10 p-4">
        <View className="gap-3">
          <Heading level={2}>Story tags (populated)</Heading>
          <Text size="sm" variant="muted">
            Free-form string array per the data-model `tags json` shape. Commit on Enter, comma, or
            blur. Backspace on empty input removes the last chip (web only — native iOS doesn&apos;t
            fire Backspace `onKeyPress` on already-empty inputs).
          </Text>
          <TagInput
            value={storyTags}
            onChange={(next) => {
              setStoryTags(next)
              log(`story tags: ${JSON.stringify(next)}`)
            }}
            placeholder="Add tags…"
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Entity tags (empty)</Heading>
          <Text size="sm" variant="muted">
            Empty state shows the placeholder until the first chip lands. Try pasting `sci-fi,
            fantasy, dystopia,` (with trailing comma) — all three split-and-commit.
          </Text>
          <TagInput
            value={entityTags}
            onChange={(next) => {
              setEntityTags(next)
              log(`entity tags: ${JSON.stringify(next)}`)
            }}
            placeholder="Add entity tags…"
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Capped (maxCount = 3)</Heading>
          <Text size="sm" variant="muted">
            When the cap is reached the input visually disables; chip × still removes. Try adding a
            fourth tag to confirm it&apos;s blocked.
          </Text>
          <TagInput
            value={capped}
            onChange={(next) => {
              setCapped(next)
              log(`capped: ${JSON.stringify(next)} (${next.length}/3)`)
            }}
            placeholder="Up to 3 tags…"
            maxCount={3}
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Per-tag length cap (maxTagLength = 12)</Heading>
          <Text size="sm" variant="muted">
            Typing past 12 chars is blocked via TextInput&apos;s `maxLength`. Paste-split pieces
            longer than 12 chars get truncated.
          </Text>
          <TagInput
            value={[]}
            onChange={(next) => log(`length-capped: ${JSON.stringify(next)}`)}
            placeholder="Try 'pneumonoultramicroscopic'…"
            maxTagLength={12}
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Edit-restrictions gate</Heading>
          <View className="flex-row items-center gap-3">
            <Button
              variant={genInFlight ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => setGenInFlight((g) => !g)}
            >
              <Text>{genInFlight ? 'Generation IN flight' : 'Start mock generation'}</Text>
            </Button>
            <Text size="xs" variant="muted">
              Toggle to disable the input + chip × buttons; web tooltip on hover.
            </Text>
          </View>
          <TagInput
            value={['sci-fi', 'fantasy']}
            onChange={() => {}}
            placeholder="Add tags…"
            disabled={genInFlight}
            disabledReason="Generation is in flight. Cancel to edit."
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Invalid state</Heading>
          <Text size="sm" variant="muted">
            `aria-invalid` flips the border to `--danger` (and the focus-ring to `--danger/20` on
            web). Consumers wire this from form validation.
          </Text>
          <TagInput
            value={[]}
            onChange={() => {}}
            placeholder="Required field…"
            aria-invalid="true"
          />
        </View>

        {eventLog.length > 0 ? (
          <View className="gap-2">
            <Heading level={3}>Event log</Heading>
            <View className="rounded-md border border-border bg-bg-sunken p-3">
              {eventLog.map((line) => (
                <Text key={line} size="xs" variant="muted" className="font-mono">
                  {line}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  )
}
