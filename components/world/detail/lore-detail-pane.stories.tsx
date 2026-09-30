import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useRef, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { HistoryLoaderProvider } from '@/components/history/history-loader'
import { withQueryClient } from '@/components/history/with-query-client'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { LoreSaveResult } from '@/lib/actions'
import type { Lore } from '@/lib/db'
import type { HistoryChunk } from '@/lib/history'
import type { RecentlyClassified } from '@/lib/row-signals'
import type { LoreDraft } from '@/lib/world'

import { LoreDetailPane } from './lore-detail-pane'

const WAIT = { timeout: 5000 }
const NEW_ID = 'lore_new'
// Deliberately distinct from the pane's real fallback text, so BlockedWithoutReason (which
// unsets this) can only pass by the fallback actually firing, not by this default leaking through.
const BLOCKED_REASON = 'Story harness: generation blocked.'
const CATEGORIES = ['cosmology', 'religion']

const AETHERIUM: Lore = {
  id: 'lore_aetherium',
  branchId: 'br_1',
  title: 'The Aetherium',
  body: 'A sea of light above the clouds, where the old gods left their tools.',
  category: 'cosmology',
  tags: ['core'],
  keywords: ['Aetherium'],
  injectionMode: 'auto',
  priority: 20,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

function savedLore(id: string, draft: LoreDraft): Lore {
  return {
    ...AETHERIUM,
    id,
    title: draft.title,
    body: draft.body,
    category: draft.category === '' ? null : draft.category,
    injectionMode: draft.injectionMode,
    priority: draft.priority,
    keywords: draft.keywords,
    tags: draft.tags,
  }
}

type HarnessProps = {
  row: Lore | null
  categories?: readonly string[]
  recentlyClassified?: RecentlyClassified
  blocked?: boolean
  blockedReason?: string
  onSave: (draft: LoreDraft) => void
  onSaved: (id: string) => void
  onDelete: (row: Lore) => void
}

/** Mimics the route: a save's row lands by `onSaved`; `Blank` is a `[+] Blank` (a new `seq`). */
function Harness({
  row: initialRow,
  categories = CATEGORIES,
  recentlyClassified,
  blocked = false,
  blockedReason,
  onSave,
  onSaved,
  onDelete,
}: HarnessProps) {
  const [row, setRow] = useState(initialRow)
  const [createSeq, setCreateSeq] = useState(1)
  const created = useRef(new Map<string, LoreDraft>())
  const onSession = useCallback(() => {}, [])

  const save = useCallback(
    async (draft: LoreDraft): Promise<LoreSaveResult> => {
      onSave(draft)
      const id = row?.id ?? NEW_ID
      if (row == null) created.current.set(id, draft)
      else setRow(savedLore(id, draft))
      return { status: 'ok', id }
    },
    [onSave, row],
  )
  const saved = useCallback(
    (id: string) => {
      const draft = created.current.get(id)
      if (draft != null) setRow(savedLore(id, draft))
      onSaved(id)
    },
    [onSaved],
  )

  return (
    // Wider than FormRow's 640px breakpoint, so no control remounts under a play
    // (lessons-learned/formrow-narrow-story-remount.md); maxWidth fits the phone viewport.
    <View className="gap-2" style={{ width: 860, maxWidth: '100%' }}>
      <View style={{ height: 640 }} className="border border-border">
        <LoreDetailPane
          branchId="br_1"
          row={row}
          createSeq={row == null ? createSeq : undefined}
          categories={categories}
          recentlyClassified={recentlyClassified}
          blocked={blocked}
          blockedReason={blockedReason}
          onSave={save}
          onSaved={saved}
          onDelete={onDelete}
          onSession={onSession}
        />
      </View>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => {
          setRow(null)
          setCreateSeq((n) => n + 1)
        }}
      >
        <Text>Blank</Text>
      </Button>
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/World/LoreDetailPane',
  component: Harness,
  parameters: { layout: 'padded' },
  args: {
    row: AETHERIUM,
    blockedReason: BLOCKED_REASON,
    onSave: fn(),
    onSaved: fn(),
    onDelete: fn(),
  },
  // The real db loader and React Query are unavailable in Storybook; a story opening History
  // overrides this with its own provider nested closer to the tree.
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={async () => ({ rows: [], nextCursor: null })}>
        <Story />
      </HistoryLoaderProvider>
    ),
    withQueryClient,
  ],
}
export default meta
type Story = StoryObj<typeof Harness>

const body = () => screen.getByRole('textbox', { name: 'Body' })
const saveButton = () =>
  within(screen.getByTestId('save-bar')).getByRole('button', { name: /^Save/ })

/** world.md → Lore: Body / Settings / History; the head carries the badge and a lead-free menu. */
export const Populated: Story = {
  args: { recentlyClassified: 'fresh' },
  play: async () => {
    await expect(await screen.findByDisplayValue(AETHERIUM.body ?? '', {}, WAIT)).toBeVisible()
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    await expect(tabs.map((tab) => tab.textContent)).toEqual(['Body', 'Settings', 'History'])
    await expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('cosmology')
    await expect(screen.getByText('Recently classified')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    // The popover fades in; the role alone can outrace opacity settling.
    const viewJson = await screen.findByRole('menuitem', { name: 'View raw JSON' }, WAIT)
    await waitFor(() => expect(viewJson).toBeVisible(), WAIT)
    await expect(screen.getByRole('menuitem', { name: /^Export lore as JSON/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(screen.queryByRole('menuitem', { name: /Set as lead/ })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    const injection = await screen.findByRole('radiogroup', { name: 'Injection' }, WAIT)
    await expect(within(injection).getByRole('radio', { name: /^Auto/ })).toBeChecked()
    await expect(screen.getByRole('textbox', { name: 'Priority' })).toHaveValue('20')
  },
}

/** world.md → Required body: clearing the body disables Save with its reason. */
export const EmptyBody: Story = {
  play: async ({ args }) => {
    await userEvent.clear(await screen.findByRole('textbox', { name: 'Body' }, WAIT))
    await waitFor(() => expect(saveButton()).toBeDisabled(), WAIT)
    await expect(saveButton().closest('[title]')).toHaveAttribute(
      'title',
      'Body: Lore needs a body.',
    )
    await expect(screen.getByText('Lore needs a body.')).toBeVisible()
    // The Save shortcut can't write the invalid draft either.
    await userEvent.keyboard('{Control>}s{/Control}')
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(body()).toHaveValue('')
  },
}

/** An issue on a tab the user has left names that tab on the save bar. */
export const PriorityIssueNamesItsTab: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: 'Settings' }, WAIT))
    const priority = await screen.findByRole('textbox', { name: 'Priority' }, WAIT)
    await userEvent.clear(priority)
    await userEvent.type(priority, '150')
    await userEvent.click(screen.getByRole('tab', { name: 'Body' }))
    await expect(await screen.findByRole('textbox', { name: 'Body' }, WAIT)).toBeVisible()
    const issue = 'Settings: Enter a whole number from 0 to 100.'
    await waitFor(() => expect(saveButton()).toBeDisabled(), WAIT)
    await expect(saveButton().closest('[title]')).toHaveAttribute('title', issue)
    await expect(
      within(screen.getByTestId('save-bar')).getByRole('button', { name: issue }),
    ).toBeVisible()
  },
}

/** Settings fields reach the draft Save writes. */
export const SettingsSave: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: 'Settings' }, WAIT))
    const injection = await screen.findByRole('radiogroup', { name: 'Injection' }, WAIT)
    await userEvent.click(within(injection).getByRole('radio', { name: /^Always/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Keywords' }), 'Vael{Enter}')
    await waitFor(() => expect(screen.getByTestId('save-bar')).toHaveTextContent('Keywords'), WAIT)
    await userEvent.click(saveButton())
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        injectionMode: 'always',
        keywords: ['Aetherium', 'Vael'],
        body: AETHERIUM.body,
      }),
    )
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
  },
}

/** entity.md → Recently-classified: only the row tint decays; the head badge stays at full strength. */
export const FadingBadgeAtFullStrength: Story = {
  args: { recentlyClassified: 'fading' },
  play: async ({ canvasElement }) => {
    const label = await screen.findByText('Recently classified', {}, WAIT)
    await expect(label).toBeVisible()
    await expect(label.closest('.bg-recently-classified-bg')).not.toBeNull()
    // A dimmed wrapper fades the badge as surely as a class on the badge does.
    await waitFor(() => {
      for (let node: Element | null = label; node !== canvasElement; node = node.parentElement) {
        if (node == null) throw new Error('The badge is outside the story canvas.')
        expect(getComputedStyle(node).opacity).toBe('1')
      }
    }, WAIT)
  },
}

/** Create mode: a title alone can't save; a body enables it. */
export const Create: Story = {
  args: { row: null },
  play: async ({ args }) => {
    await expect(await screen.findByRole('button', { name: 'More actions' }, WAIT)).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Unnamed' }))
    await userEvent.type(await screen.findByPlaceholderText('Unnamed', {}, WAIT), 'Vael{Enter}')
    await waitFor(() => expect(saveButton()).toBeDisabled(), WAIT)
    await userEvent.type(body(), 'A drowned city.')
    await waitFor(() => expect(saveButton()).toBeEnabled(), WAIT)
    await userEvent.click(saveButton())
    await waitFor(() => expect(args.onSaved).toHaveBeenCalledWith(NEW_ID), WAIT)
    await expect(args.onSave).toHaveBeenCalledWith({
      title: 'Vael',
      body: 'A drowned city.',
      category: '',
      injectionMode: 'auto',
      priority: 0,
      keywords: [],
      tags: [],
    })
    await expect(await screen.findByRole('button', { name: 'More actions' }, WAIT)).toBeEnabled()
  },
}

/** Create mode: a body alone can't save either; the bar names the missing title. */
export const CreateWithoutTitle: Story = {
  args: { row: null },
  play: async ({ args }) => {
    await userEvent.type(await screen.findByRole('textbox', { name: 'Body' }, WAIT), 'A city.')
    await waitFor(() => expect(saveButton()).toBeDisabled(), WAIT)
    await expect(saveButton().closest('[title]')).toHaveAttribute('title', 'A title is required.')
    await userEvent.keyboard('{Control>}s{/Control}')
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

const loreHistoryLoader = fn(async (): Promise<HistoryChunk> => ({ rows: [], nextCursor: null }))

/** History reads this lore row's deltas. */
export const HistoryReadsTheRow: Story = {
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={loreHistoryLoader}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
  play: async () => {
    loreHistoryLoader.mockClear()
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }, WAIT))
    await expect(await screen.findByText('No history yet', {}, WAIT)).toBeVisible()
    await waitFor(
      () =>
        expect(loreHistoryLoader).toHaveBeenCalledWith(
          expect.objectContaining({
            branchId: 'br_1',
            targetTable: 'lore',
            targetId: AETHERIUM.id,
          }),
        ),
      WAIT,
    )
  },
}

/** A create's History starts at its first save, then reads the saved row's id. */
export const CreateThenHistoryTargetsTheSavedRow: Story = {
  args: { row: null },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={loreHistoryLoader}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
  play: async ({ args }) => {
    loreHistoryLoader.mockClear()
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }, WAIT))
    await expect(
      await screen.findByText('History starts at the first save', {}, WAIT),
    ).toBeVisible()
    await expect(loreHistoryLoader).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Unnamed' }))
    await userEvent.type(await screen.findByPlaceholderText('Unnamed', {}, WAIT), 'Vael{Enter}')
    await userEvent.click(screen.getByRole('tab', { name: 'Body' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Body' }, WAIT), 'A city.')
    await userEvent.click(screen.getByRole('tab', { name: 'History' }))
    await waitFor(() => expect(saveButton()).toBeEnabled(), WAIT)
    await userEvent.click(saveButton())
    await waitFor(() => expect(args.onSaved).toHaveBeenCalledWith(NEW_ID), WAIT)

    await expect(await screen.findByText('No history yet', {}, WAIT)).toBeVisible()
    await waitFor(
      () =>
        expect(loreHistoryLoader).toHaveBeenCalledWith(
          expect.objectContaining({ branchId: 'br_1', targetTable: 'lore', targetId: NEW_ID }),
        ),
      WAIT,
    )
  },
}

/** `[+] Blank` from a row on History lands the new draft on Body, and a repeat resets the draft. */
export const BlankLandsOnBody: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }, WAIT))
    await expect(await screen.findByText('No history yet', {}, WAIT)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Blank' }))
    await waitFor(
      () =>
        expect(screen.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true'),
      WAIT,
    )
    await expect(await screen.findByRole('textbox', { name: 'Body' }, WAIT)).toHaveValue('')

    await userEvent.type(body(), 'A half-written draft.')
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    await userEvent.click(screen.getByRole('button', { name: 'Blank' }))
    await waitFor(
      () =>
        expect(screen.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true'),
      WAIT,
    )
    await expect(await screen.findByRole('textbox', { name: 'Body' }, WAIT)).toHaveValue('')
    await expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

/** isUserEditBlocked: nothing in the pane can be edited. */
export const Blocked: Story = {
  args: { blocked: true },
  play: async () => {
    const name = within(await screen.findByTestId('world-detail-name', {}, WAIT))
    await expect(name.getByText('The Aetherium')).toBeVisible()
    await expect(name.queryByRole('button')).toBeNull()
    await expect(screen.getByRole('combobox', { name: 'Category' })).toHaveAttribute('readonly')
    await expect(body()).toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    const injection = await screen.findByRole('radiogroup', { name: 'Injection' }, WAIT)
    for (const radio of within(injection).getAllByRole('radio')) {
      await expect(radio).toHaveAttribute('aria-disabled', 'true')
    }
    for (const label of ['Priority', 'Keywords', 'Tags']) {
      await expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('readonly')
    }
  },
}

/** A blocked pane with no explicit reason still disables Delete — it must not fall through enabled. */
export const BlockedWithoutReason: Story = {
  args: { blocked: true, blockedReason: undefined },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    const remove = await screen.findByRole(
      'menuitem',
      { name: 'Delete, Generation is in flight. Cancel to edit.' },
      WAIT,
    )
    await expect(remove).toHaveAttribute('aria-disabled', 'true')
  },
}

/** Phone: the three tabs go to the Select, which reaches History. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    await waitFor(() => expect(screen.queryByRole('tablist')).toBeNull(), WAIT)
    await expect(body()).toHaveValue(AETHERIUM.body)
    await userEvent.click(await screen.findByRole('button', { name: 'Section' }, WAIT))
    const history = await screen.findByRole('option', { name: 'History' }, WAIT)
    await waitFor(() => expect(history).toBeVisible(), WAIT)
    await userEvent.click(history)
    await expect(await screen.findByText('No history yet', {}, WAIT)).toBeVisible()
  },
}

/** A category saves as typed, though the branch holds it in another casing. */
export const TypedCategorySavesAsTyped: Story = {
  play: async ({ args }) => {
    const category = await screen.findByRole('combobox', { name: 'Category' }, WAIT)
    await userEvent.click(category)
    await userEvent.clear(category)
    await userEvent.type(category, 'Religion')
    await userEvent.click(body())
    await waitFor(() => expect(saveButton()).toBeEnabled(), WAIT)
    await userEvent.click(saveButton())
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'Religion' }),
    )
  },
}

/** Picking one casing of a category the branch holds in two commits that casing. */
export const PickedCategoryKeepsItsCasing: Story = {
  args: { categories: ['cosmology', 'Cosmology', 'religion'] },
  play: async ({ args }) => {
    const category = await screen.findByRole('combobox', { name: 'Category' }, WAIT)
    await userEvent.click(category)
    await userEvent.clear(category)
    await userEvent.type(category, 'cosmo')
    await userEvent.click(await screen.findByRole('option', { name: 'Cosmology' }, WAIT))
    await waitFor(() => expect(category).toHaveValue('Cosmology'), WAIT)
    await waitFor(() => expect(saveButton()).toBeEnabled(), WAIT)
    await userEvent.click(saveButton())
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'Cosmology' }),
    )
  },
}
