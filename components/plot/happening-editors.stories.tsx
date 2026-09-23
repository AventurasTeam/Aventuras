import { zodResolver } from '@hookform/resolvers/zod'
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import { happeningDraftSchema, type HappeningDraft } from '@/lib/plot'

import { AwarenessEditor } from './awareness-editor'
import { DecayResistanceField } from './decay-resistance-field'
import { InvolvementsEditor } from './involvements-editor'

function entity(id: string, kind: Entity['kind'], name: string): Entity {
  return {
    id,
    branchId: 'br_1',
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

const ENTITIES: Entity[] = [
  entity('char_kael', 'character', 'Kael'),
  entity('char_mira', 'character', 'Mira'),
  entity('loc_market', 'location', 'Night Market'),
  entity('fac_watch', 'faction', 'The Watch'),
  entity('char_sage', 'character', 'The Ashen Sage'),
]

const ENTRIES: EntryRef[] = Array.from({ length: 60 }, (_, i) => {
  const position = 60 - i
  return {
    id: `e_${position}`,
    position,
    kind: 'ai_reply',
    chapterId: position <= 30 ? 'chap_1' : null,
    excerpt: `Entry ${position}`,
  }
})

const DEFAULT_VALUES: HappeningDraft = {
  title: 'The alley ambush',
  description: '',
  category: '',
  icon: null,
  commonKnowledge: false,
  occurredAtEntryId: null,
  temporal: '',
  involvements: [{ id: 'hinv_kael', entityId: 'char_kael', role: 'target' }],
  awareness: [
    {
      id: 'haw_mira',
      characterId: 'char_mira',
      learnedAtEntryId: 'e_11',
      decayResistance: 0.6,
      source: 'told',
    },
  ],
}

const BLOCKED_REASON = 'Generation is in flight. Cancel to edit.'

const onOpenEntity = fn()

function useHappeningForm(defaultValues: HappeningDraft = DEFAULT_VALUES) {
  return useForm<HappeningDraft>({
    defaultValues,
    resolver: zodResolver(happeningDraftSchema),
    mode: 'onChange',
  })
}

function InvolvementsHarness() {
  const form = useHappeningForm()
  const values = useWatch({ control: form.control })
  return (
    <View className="gap-4">
      <InvolvementsEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        blocked={false}
        onOpenEntity={onOpenEntity}
      />
      <Button variant="secondary" size="sm" onPress={() => void form.trigger()}>
        <Text>Trigger</Text>
      </Button>
      <Text testID="values">{JSON.stringify(values)}</Text>
    </View>
  )
}

function AwarenessHarness() {
  const form = useHappeningForm()
  const values = useWatch({ control: form.control })
  return (
    <View className="gap-4">
      <AwarenessEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        entries={ENTRIES}
        blocked={false}
        onOpenEntity={onOpenEntity}
      />
      <Button variant="secondary" size="sm" onPress={() => void form.trigger()}>
        <Text>Trigger</Text>
      </Button>
      <Text testID="values">{JSON.stringify(values)}</Text>
    </View>
  )
}

const DUPLICATE_INVOLVEMENTS: HappeningDraft = {
  ...DEFAULT_VALUES,
  involvements: [
    { id: 'hinv_a', entityId: 'char_kael', role: 'actor' },
    { id: 'hinv_b', entityId: 'char_kael', role: 'target' },
  ],
}

// excludeIds blocks a fresh on-screen duplicate — this harness pre-loads one (classifier shape).
function DuplicateInvolvementsHarness() {
  const form = useHappeningForm(DUPLICATE_INVOLVEMENTS)
  return (
    <View className="gap-4">
      <InvolvementsEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        blocked={false}
        onOpenEntity={onOpenEntity}
      />
      <Button variant="secondary" size="sm" onPress={() => void form.trigger()}>
        <Text>Trigger</Text>
      </Button>
    </View>
  )
}

function DecayPresetsHarness() {
  const [value, setValue] = useState<number | null>(0.6)
  return (
    <DecayResistanceField
      value={value}
      onChange={setValue}
      label={t('plot:fields.decayResistance')}
    />
  )
}

function BlockedHarness() {
  const form = useHappeningForm()
  return (
    <View className="gap-4">
      <InvolvementsEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        blocked
        blockedReason={BLOCKED_REASON}
        onOpenEntity={onOpenEntity}
      />
      <AwarenessEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        entries={ENTRIES}
        blocked
        blockedReason={BLOCKED_REASON}
        onOpenEntity={onOpenEntity}
      />
    </View>
  )
}

// role/source '' (a committed null normalizes via `happeningDraftFrom`), unset decay, and an
// entity id absent from `entities` — the shape a classifier-authored row loads as, untouched.
const CLASSIFIER_SHAPED: HappeningDraft = {
  ...DEFAULT_VALUES,
  involvements: [{ id: 'hinv_ghost', entityId: 'char_ghost', role: '' }],
  awareness: [
    {
      id: 'haw_ghost',
      characterId: 'char_ghost',
      learnedAtEntryId: null,
      decayResistance: null,
      source: '',
    },
  ],
}

function ClassifierShapedHarness() {
  const form = useHappeningForm(CLASSIFIER_SHAPED)
  return (
    <View className="gap-4">
      <InvolvementsEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        blocked={false}
        onOpenEntity={onOpenEntity}
      />
      <AwarenessEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        entries={ENTRIES}
        blocked={false}
        onOpenEntity={onOpenEntity}
      />
    </View>
  )
}

function ResetIdentityHarness() {
  const form = useHappeningForm()
  return (
    <View className="gap-4">
      <InvolvementsEditor
        control={form.control}
        trigger={form.trigger}
        entities={ENTITIES}
        blocked={false}
        onOpenEntity={onOpenEntity}
      />
      <Button variant="secondary" size="sm" onPress={() => form.reset(form.getValues())}>
        <Text>Reset</Text>
      </Button>
    </View>
  )
}

const meta: Meta = {
  title: 'Compounds/Plot/HappeningEditors',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      // Past FormRow's 640px threshold (matches the happening detail pane) — avoids remount
      // under a play (lessons-learned/formrow-narrow-story-remount.md).
      <View style={{ width: 860, maxWidth: '100%' }} className="gap-4 border border-border p-4">
        <Story />
      </View>
    ),
  ],
}
export default meta
type Story = StoryObj

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 3000 }
const valuesText = () => screen.getByTestId('values')
const row = (testId: string) => screen.getByTestId(testId)
const lowLabel = t('plot:fields.decayPreset.low')
const mediumLabel = t('plot:fields.decayPreset.medium')
const highLabel = t('plot:fields.decayPreset.high')

export const Involvements: Story = {
  render: () => <InvolvementsHarness />,
  play: async () => {
    onOpenEntity.mockClear()
    await userEvent.click(
      within(row('involvement-0')).getByRole('button', {
        name: t('plot:involvements.openInWorld', { name: 'Kael' }),
      }),
    )
    expect(onOpenEntity).toHaveBeenCalledWith(ENTITIES[0])

    await userEvent.click(screen.getByRole('button', { name: t('plot:involvements.add') }))
    const newRow = row('involvement-1')
    await userEvent.click(within(newRow).getByRole('button', { name: t('plot:fields.entity') }))
    expect(await screen.findByRole('option', { name: /Night Market/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Kael/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('option', { name: /Night Market/ }))
    await userEvent.type(
      within(newRow).getByRole('textbox', { name: t('plot:fields.role') }),
      'site',
    )
    await waitFor(() => expect(valuesText()).toHaveTextContent('"entityId":"loc_market"'), WAIT)
    expect(valuesText()).toHaveTextContent('"role":"site"')

    await userEvent.click(
      within(row('involvement-0')).getByRole('button', {
        name: t('plot:involvements.removeNamed', { name: 'Kael' }),
      }),
    )
    await waitFor(() => expect(valuesText()).not.toHaveTextContent('char_kael'), WAIT)
    // The survivor shifted down to index 0 and kept its own picked entity and typed role.
    expect(within(row('involvement-0')).getByText('Night Market')).toBeVisible()
    expect(
      within(row('involvement-0')).getByRole('textbox', { name: t('plot:fields.role') }),
    ).toHaveValue('site')
  },
}

export const Awareness: Story = {
  render: () => <AwarenessHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: t('plot:awareness.add') }))
    const newRow = row('awareness-1')
    await userEvent.click(within(newRow).getByRole('button', { name: t('plot:fields.character') }))
    expect(await screen.findByRole('option', { name: /Ashen Sage/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Mira/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Night Market/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('option', { name: /Ashen Sage/ }))
    await userEvent.click(within(newRow).getByRole('button', { name: highLabel }))
    await waitFor(() => expect(valuesText()).toHaveTextContent('"decayResistance":0.8'), WAIT)

    const decayInput = within(newRow).getByRole('textbox', {
      name: t('plot:fields.decayResistance'),
    })
    await userEvent.clear(decayInput)
    await userEvent.type(decayInput, '1.5')
    await waitFor(
      () => expect(within(newRow).getByText(t('plot:validation.decayRange'))).toBeVisible(),
      WAIT,
    )

    await userEvent.clear(decayInput)
    await userEvent.type(decayInput, '0.9')
    await waitFor(
      () =>
        expect(within(newRow).queryByText(t('plot:validation.decayRange'))).not.toBeInTheDocument(),
      WAIT,
    )
    expect(within(newRow).getByRole('button', { name: highLabel })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await waitFor(() => expect(valuesText()).toHaveTextContent('"decayResistance":0.9'), WAIT)

    await userEvent.click(within(newRow).getByRole('button', { name: t('plot:fields.learnedAt') }))
    await userEvent.type(await screen.findByRole('combobox'), '#12')
    await userEvent.click(await screen.findByRole('option', { name: /entry #12/ }))
    await waitFor(() => expect(valuesText()).toHaveTextContent('"learnedAtEntryId":"e_12"'), WAIT)
  },
}

// Duplicate errors go stale in `onChange` mode: a leaf-only resolver rerun patches just that
// leaf's error slot, so a fix needs `rules: { deps }` to re-validate the whole array.
export const CrossRowDuplicateRevalidatesOnFix: Story = {
  render: () => <DuplicateInvolvementsHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }))
    await waitFor(
      () =>
        expect(
          within(row('involvement-1')).getByText(t('plot:validation.duplicateEntity')),
        ).toBeVisible(),
      WAIT,
    )
    expect(
      within(row('involvement-0')).queryByText(t('plot:validation.duplicateEntity')),
    ).not.toBeInTheDocument()

    // Row 0's exclude list is empty here (its only taken twin is its own value), so this fix
    // goes through the real picker rather than bypassing it.
    await userEvent.click(within(row('involvement-0')).getByRole('button', { name: /Entity/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Night Market/ }))
    await waitFor(
      () =>
        expect(
          within(row('involvement-1')).queryByText(t('plot:validation.duplicateEntity')),
        ).not.toBeInTheDocument(),
      WAIT,
    )
  },
}

// `useFieldArray`'s post-remove revalidation only compares the array path's root error
// type/message (a no-op for per-index errors) — needs explicit `trigger()` after `remove()`.
export const DuplicateEntityClearsOnRemove: Story = {
  render: () => <DuplicateInvolvementsHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }))
    await waitFor(
      () =>
        expect(
          within(row('involvement-1')).getByText(t('plot:validation.duplicateEntity')),
        ).toBeVisible(),
      WAIT,
    )

    await userEvent.click(
      within(row('involvement-0')).getByRole('button', {
        name: t('plot:involvements.removeNamed', { name: 'Kael' }),
      }),
    )
    // The survivor shifted down to index 0; its stale error must not follow it.
    await waitFor(
      () =>
        expect(
          within(row('involvement-0')).queryByText(t('plot:validation.duplicateEntity')),
        ).not.toBeInTheDocument(),
      WAIT,
    )
  },
}

export const DecayPresetsExactMatch: Story = {
  render: () => <DecayPresetsHarness />,
  play: async () => {
    for (const name of [lowLabel, mediumLabel, highLabel]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
    await userEvent.click(screen.getByRole('button', { name: mediumLabel }))
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: mediumLabel })).toHaveAttribute(
          'aria-pressed',
          'true',
        ),
      WAIT,
    )
    expect(screen.getByRole('textbox', { name: t('plot:fields.decayResistance') })).toHaveValue(
      '0.5',
    )
  },
}

/** save-sessions.md: fields, source and destination inputs gate; navigation does not. */
export const Blocked: Story = {
  render: () => <BlockedHarness />,
  play: async () => {
    const involvementRow = row('involvement-0')
    const awarenessRow = row('awareness-0')

    expect(within(involvementRow).getByRole('button', { name: /^Entity/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(awarenessRow).getByRole('button', { name: /^Character/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(awarenessRow).getByRole('button', { name: /^Learned at/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    expect(
      within(involvementRow).getByRole('textbox', { name: t('plot:fields.role') }),
    ).toHaveAttribute('readonly')
    expect(
      within(awarenessRow).getByRole('textbox', { name: t('plot:fields.source') }),
    ).toHaveAttribute('readonly')
    expect(
      within(awarenessRow).getByRole('textbox', { name: t('plot:fields.decayResistance') }),
    ).toHaveAttribute('readonly')

    for (const name of [lowLabel, mediumLabel, highLabel]) {
      expect(within(awarenessRow).getByRole('button', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    }

    expect(within(awarenessRow).getByRole('button', { name: t('picker.clear') })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    // Remove buttons share the blocked reason as their accessible name while disabled — not
    // their normal label (lessons-learned/disabled-iconaction-renames-itself.md).
    expect(within(involvementRow).getByRole('button', { name: BLOCKED_REASON })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(awarenessRow).getByRole('button', { name: BLOCKED_REASON })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    expect(screen.getByRole('button', { name: t('plot:involvements.add') })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: t('plot:awareness.add') })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    // Open in World navigates through the leave guard, not this gate — stays enabled.
    expect(
      within(involvementRow).getByRole('button', {
        name: t('plot:involvements.openInWorld', { name: 'Kael' }),
      }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      within(awarenessRow).getByRole('button', {
        name: t('plot:awareness.openInWorld', { name: 'Mira' }),
      }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  },
}

export const ClassifierShapedRow: Story = {
  render: () => <ClassifierShapedHarness />,
  play: async () => {
    const involvementRow = row('involvement-0')
    const awarenessRow = row('awareness-0')

    // An entity id absent from `entities` shows the picker's missing-entity state — and no
    // Open in World, since there's nothing to open.
    expect(within(involvementRow).getByRole('button', { name: /Entity/ })).toHaveTextContent(
      t('picker.entityMissing'),
    )
    expect(within(involvementRow).queryByRole('button', { name: /^Open/ })).not.toBeInTheDocument()
    expect(
      within(involvementRow).getByRole('textbox', { name: t('plot:fields.role') }),
    ).toHaveValue('')
    expect(
      within(involvementRow).getByPlaceholderText(t('plot:fields.rolePlaceholder')),
    ).toBeVisible()

    expect(within(awarenessRow).getByRole('button', { name: /Character/ })).toHaveTextContent(
      t('picker.entityMissing'),
    )
    expect(within(awarenessRow).queryByRole('button', { name: /^Open/ })).not.toBeInTheDocument()
    for (const name of [lowLabel, mediumLabel, highLabel]) {
      expect(within(awarenessRow).getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    }
    expect(
      within(awarenessRow).getByRole('textbox', { name: t('plot:fields.decayResistance') }),
    ).toHaveValue('')
    expect(
      within(awarenessRow).getByRole('textbox', { name: t('plot:fields.source') }),
    ).toHaveValue('')
    expect(
      within(awarenessRow).getByPlaceholderText(t('plot:fields.sourcePlaceholder')),
    ).toBeVisible()
    expect(within(awarenessRow).getByText(t('plot:fields.learnedAtPlaceholder'))).toBeVisible()
  },
}

// react-hook-form regenerates every `field.id` on a full `reset()` (useRowSaveSession's
// post-save rebase) — keying by the draft's row id keeps DOM identity; focus/scroll survive.
export const CardIdentitySurvivesReset: Story = {
  render: () => <ResetIdentityHarness />,
  play: async () => {
    const before = row('involvement-0')
    await userEvent.type(
      within(before).getByRole('textbox', { name: t('plot:fields.role') }),
      ' extra',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(row('involvement-0')).toBe(before)
  },
}
