import { zodResolver } from '@hookform/resolvers/zod'
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import { happeningDraftSchema, type HappeningDraft } from '@/lib/plot'

import { AwarenessEditor } from './awareness-editor'
import { CommonKnowledgeNotice } from './common-knowledge-notice'
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

const onOpenEntity = fn()

function useHappeningForm() {
  return useForm<HappeningDraft>({
    defaultValues: DEFAULT_VALUES,
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

function CommonKnowledgeHarness() {
  const form = useHappeningForm()
  const commonKnowledge = useWatch({ control: form.control, name: 'commonKnowledge' })
  return (
    <View className="gap-4">
      <Controller
        control={form.control}
        name="commonKnowledge"
        render={({ field }) => (
          <View className="flex-row items-center gap-2">
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-label={t('plot:fields.commonKnowledge')}
            />
            <Text>{t('plot:fields.commonKnowledge')}</Text>
          </View>
        )}
      />
      {commonKnowledge ? (
        <CommonKnowledgeNotice />
      ) : (
        <AwarenessEditor
          control={form.control}
          entities={ENTITIES}
          entries={ENTRIES}
          blocked={false}
          onOpenEntity={onOpenEntity}
        />
      )}
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

// Two rows already point at the same entity (classifier/import data) — the picker's own
// `excludeIds` prevents creating a fresh duplicate by clicking, so this loads one instead.
function DuplicateInvolvementsHarness() {
  const form = useForm<HappeningDraft>({
    defaultValues: DUPLICATE_INVOLVEMENTS,
    resolver: zodResolver(happeningDraftSchema),
    mode: 'onChange',
  })
  return (
    <View className="gap-4">
      <InvolvementsEditor
        control={form.control}
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

const meta: Meta = {
  title: 'Compounds/Plot/HappeningEditors',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      // Past FormRow's 640 px threshold, like the happening detail pane, so no control
      // remounts under a play (lessons-learned/formrow-narrow-story-remount.md).
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

export const Involvements: Story = {
  render: () => <InvolvementsHarness />,
  play: async () => {
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
      within(row('involvement-0')).getByRole('button', { name: t('plot:involvements.remove') }),
    )
    await waitFor(() => expect(valuesText()).not.toHaveTextContent('char_kael'), WAIT)
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
    await userEvent.click(within(newRow).getByRole('button', { name: 'High' }))
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
    expect(within(newRow).getByRole('button', { name: 'High' })).toHaveAttribute(
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

// Duplicate errors go stale in `onChange` mode: a resolver rerun after a leaf change only
// patches that leaf's own error slot, so a different row's stale `duplicateEntity` survives
// a fix unless the whole array is re-validated (`rules: { deps }`).
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

    // Row 0's own exclude list is empty here (its only taken twin is its own current value),
    // so this fix goes through the real picker rather than bypassing it.
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

export const DecayPresetsExactMatch: Story = {
  render: () => <DecayPresetsHarness />,
  play: async () => {
    for (const name of ['Low', 'Medium', 'High']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
    await userEvent.click(screen.getByRole('button', { name: 'Medium' }))
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute(
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

export const CommonKnowledgeSwap: Story = {
  render: () => <CommonKnowledgeHarness />,
  play: async () => {
    expect(await screen.findByRole('button', { name: t('plot:awareness.add') })).toBeVisible()

    await userEvent.click(screen.getByRole('switch', { name: t('plot:fields.commonKnowledge') }))
    await waitFor(() => expect(screen.getByText(t('plot:awareness.ckBody'))).toBeVisible(), WAIT)
    expect(screen.queryByRole('button', { name: t('plot:awareness.add') })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('switch', { name: t('plot:fields.commonKnowledge') }))
    await waitFor(() => expect(within(row('awareness-0')).getByText('Mira')).toBeVisible(), WAIT)
  },
}
