import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { SaveBar } from '@/components/compounds/save-bar'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'

type Settings = {
  description: string
  hair: string
  traits: string
}

const INITIAL: Settings = {
  description: 'Apprentice swordsmith haunted by an unfinished blade.',
  hair: 'Black, shoulder-length, often pinned back.',
  traits: 'Patient. Anxious in crowds. Fluent in Old Yamato.',
}

const FIELD_LABELS: Record<keyof Settings, string> = {
  description: 'description',
  hair: 'visual.hair',
  traits: 'traits',
}

export default function SaveBarDevRoute() {
  const [persisted, setPersisted] = useState<Settings>(INITIAL)
  const [draft, setDraft] = useState<Settings>(INITIAL)
  const [saving, setSaving] = useState(false)
  const [lastEvent, setLastEvent] = useState<string | null>(null)

  const dirtyKeys = (Object.keys(draft) as (keyof Settings)[]).filter(
    (k) => draft[k] !== persisted[k],
  )
  const dirtyFields = dirtyKeys.map((k) => FIELD_LABELS[k])
  const isDirty = dirtyFields.length > 0

  const handleSave = async () => {
    setSaving(true)
    // Pretend we're hitting SQLite — 600 ms shows the disabled state.
    await new Promise((r) => setTimeout(r, 600))
    setPersisted(draft)
    setSaving(false)
    setLastEvent(`Saved at ${new Date().toLocaleTimeString()}`)
  }

  const handleDiscard = () => {
    setDraft(persisted)
    setLastEvent(`Discarded at ${new Date().toLocaleTimeString()}`)
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-8 p-4">
        <View className="gap-2">
          <Heading level={2}>Live save session</Heading>
          <Text size="sm" variant="muted">
            Edit any field to surface the bar. Dirty-note left, actions right. The bar unmounts when
            nothing differs from the last save. ⌘S / Ctrl+S fires save (web only). The 600 ms
            `saving` state is simulated to demonstrate disabled actions.
          </Text>
          <View className="gap-4 rounded-md border border-border bg-bg-base p-4">
            <FormRow label="Description" hint="Free-form prose, save-on-explicit.">
              <Input
                value={draft.description}
                onChangeText={(v) => setDraft({ ...draft, description: v })}
                multiline
              />
            </FormRow>
            <FormRow label="Hair" hint="Visual subfield.">
              <Input value={draft.hair} onChangeText={(v) => setDraft({ ...draft, hair: v })} />
            </FormRow>
            <FormRow label="Traits" hint="Comma-separated.">
              <Input value={draft.traits} onChangeText={(v) => setDraft({ ...draft, traits: v })} />
            </FormRow>
          </View>
          {isDirty ? (
            <SaveBar
              dirtyFields={dirtyFields}
              onSave={handleSave}
              onDiscard={handleDiscard}
              saving={saving}
            />
          ) : (
            <View className="rounded-md border border-dashed border-border bg-bg-base p-3">
              <Text size="xs" variant="muted">
                Clean — no save bar. Edit a field above to surface it.
              </Text>
            </View>
          )}
          {lastEvent != null ? (
            <Text size="xs" variant="muted">
              {lastEvent}
            </Text>
          ) : null}
        </View>

        <View className="gap-2">
          <Heading level={2}>Notice variant</Heading>
          <Text size="sm" variant="muted">
            Surface-specific propagation warnings layer in via the `notice` prop — single row, no
            second line. Hover the ⚠ icon on web for the tooltip.
          </Text>
          <SaveBar
            dirtyFields={['name', 'era_set']}
            notice="Saving propagates the new era set to 3 stories using this calendar."
            onSave={() => {}}
            onDiscard={() => {}}
          />
        </View>

        <View className="gap-2">
          <Heading level={2}>Many fields (truncation)</Heading>
          <Text size="sm" variant="muted">
            When the field list overflows, it clips at the row&apos;s right edge via `numberOfLines=
            {1}`. Actions stay reachable.
          </Text>
          <SaveBar
            dirtyFields={[
              'description',
              'visual.hair',
              'traits',
              'goals',
              'relationships.spouse',
              'inventory.weapons',
              'tags',
            ]}
            onSave={() => {}}
            onDiscard={() => {}}
          />
        </View>
      </View>
    </ScrollView>
  )
}
