import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { PlotSaveResult } from '@/lib/actions'
import type { Thread } from '@/lib/db'
import type { EntryIndex, EntryRef } from '@/lib/entry-refs'
import type { ThreadDraft } from '@/lib/plot'
import type { RecentlyClassified } from '@/lib/row-signals'

import { ThreadDetailPane } from './thread-detail-pane'

function thread(overrides: Partial<Thread> & Pick<Thread, 'id'>): Thread {
  return {
    branchId: 'br_1',
    title: '',
    description: null,
    category: null,
    icon: null,
    status: 'pending',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const AMULET = thread({
  id: 'thread_amulet',
  title: 'What the amulet wants',
  description: 'The Veilstone reacts to places, not people. Find out why.',
  category: 'mystery',
  icon: 'sparkles',
  status: 'active',
  injectionMode: 'always',
  triggeredAtEntryId: 'e_5',
})

const TRUST = thread({
  id: 'thread_trust',
  title: 'Earn Mira’s trust',
  description: 'She is testing you. So far you are passing.',
  category: 'relationship',
  icon: 'handshake',
  status: 'resolved',
  triggeredAtEntryId: 'e_8',
  resolvedAtEntryId: 'e_50',
})

const ENTRY_INDEX: EntryIndex = new Map(
  Array.from({ length: 60 }, (_, i): EntryRef => {
    const position = i + 1
    return {
      id: `e_${position}`,
      position,
      kind: 'ai_reply',
      chapterId: position <= 30 ? 'chap_1' : null,
      excerpt: `Entry ${position}`,
    }
  }).map((entry) => [entry.id, entry]),
)

const CATEGORIES = ['goal', 'mystery', 'relationship']
const NEW_ID = 'thr_new'
const BLOCKED_REASON = 'Generation is in flight. Cancel to edit.'
const FAILED_TEXT = "Couldn't save your changes. They're still here — try again."
const IN_FLIGHT_TEXT = "Couldn't save while generation is in flight. Your changes are still here."
// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 3000 }

function savedRow(prev: Thread | null, id: string, draft: ThreadDraft): Thread {
  const text = (value: string) => value.trim() || null
  return {
    ...(prev ?? thread({ id })),
    id,
    title: draft.title.trim(),
    description: text(draft.description),
    category: text(draft.category),
    icon: draft.icon,
    status: draft.status,
    injectionMode: draft.injectionMode,
  }
}

type HarnessProps = {
  row: Thread | null
  blocked?: boolean
  recentlyClassified?: RecentlyClassified
  /** Every save resolves to this; by default `ok` with the row's id, or a new one on create. */
  saveResult?: PlotSaveResult
  /** Every save throws instead, as a failed transaction would. */
  saveThrows?: boolean
  /** `onSaved` throws after the row is selected, as a failing success toast would. */
  savedThrows?: boolean
  initialTab?: string
  onSave: (draft: ThreadDraft) => void
  onRejected: (reason: string) => void
  /** What a leave requested through the pane's session handle runs once released. */
  onLeave: () => void
}

/**
 * Mimics the route: an update's store patch lands while the save is in flight; a create's new
 * row is selected from `onSaved`, which switches the pane's row mid-commit. Capture-phase keys
 * stand in for the route (a button click would be an outside click): F2 flips `blocked`, as a
 * run starting mid-edit would; F3 requests a leave through the handle from `onSession`.
 */
function Harness({
  row: initialRow,
  blocked: initialBlocked = false,
  recentlyClassified,
  saveResult,
  saveThrows = false,
  savedThrows = false,
  initialTab,
  onSave,
  onRejected,
  onLeave,
}: HarnessProps) {
  const [row, setRow] = useState(initialRow)
  const [blocked, setBlocked] = useState(initialBlocked)
  const created = useRef(new Map<string, ThreadDraft>())
  const session = useRef<RowSessionHandle | null>(null)
  const onSession = useCallback((handle: RowSessionHandle | null) => {
    session.current = handle
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setBlocked((prev) => !prev)
      if (e.key === 'F3') session.current?.requestLeave(onLeave)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onLeave])

  const save = useCallback(
    async (draft: ThreadDraft): Promise<PlotSaveResult> => {
      onSave(draft)
      if (saveThrows) throw new Error('SQLITE_BUSY: database is locked')
      const result = saveResult ?? { status: 'ok', id: row?.id ?? NEW_ID }
      if (result.status !== 'ok') return result
      if (row == null) {
        created.current.set(result.id, draft)
      } else {
        setRow(savedRow(row, result.id, draft))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return result
    },
    [onSave, saveResult, saveThrows, row],
  )

  const onSaved = useCallback(
    (id: string) => {
      const draft = created.current.get(id)
      if (draft != null) setRow(savedRow(null, id, draft))
      if (savedThrows) throw new Error('toast failed')
    },
    [savedThrows],
  )

  return (
    // Past FormRow's 640 px threshold, like the desktop detail pane: its first-frame two-column
    // guess holds, so no control remounts under a play (lessons-learned/formrow-narrow-story-remount.md).
    <View style={{ width: 860, maxWidth: '100%', height: 720 }} className="border border-border">
      <ThreadDetailPane
        row={row}
        entryIndex={ENTRY_INDEX}
        categories={CATEGORIES}
        recentlyClassified={recentlyClassified}
        blocked={blocked}
        blockedReason={BLOCKED_REASON}
        initialTab={initialTab}
        onSave={save}
        onSaved={onSaved}
        onRejected={onRejected}
        onSession={onSession}
      />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/Plot/ThreadDetailPane',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { row: AMULET, onSave: fn(), onRejected: fn(), onLeave: fn() },
}
export default meta
type Story = StoryObj<typeof Harness>

const description = () => screen.getByRole('textbox', { name: 'Description' })
const saveBar = () => screen.getByTestId('save-bar')

async function editDescription(text: string) {
  await userEvent.type(await screen.findByRole('textbox', { name: 'Description' }), text)
  return await screen.findByTestId('save-bar', {}, WAIT)
}

/** An edit raises the bar with the field's label; Discard restores the committed text. */
export const Active: Story = {
  args: { recentlyClassified: 'fresh' },
  play: async ({ args }) => {
    expect(await screen.findByRole('button', { name: 'Edit What the amulet wants' })).toBeVisible()
    expect(screen.getByText('Recently classified')).toBeVisible()
    // Status is an Overview field; the head carries no lowercase status pill.
    expect(screen.queryByText('active')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Status' })).toHaveTextContent('Active')
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByText('entry #5')).toBeVisible()
    expect(screen.queryByText('Resolved at')).not.toBeInTheDocument()
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()

    const bar = await editDescription(' Soon.')
    expect(within(bar).getByText(/^1 unsaved change$/)).toBeVisible()
    expect(bar).toHaveTextContent('Description')

    await userEvent.click(within(bar).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(description()).toHaveValue(AMULET.description)
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** Save writes the draft; the store patch lands mid-commit and the pane settles clean on it. */
export const SaveCommits: Story = {
  play: async ({ args }) => {
    await editDescription(' Soon.')
    await userEvent.click(screen.getByRole('button', { name: 'Icon' }))
    await userEvent.click(await screen.findByRole('option', { name: 'No icon' }, WAIT))
    await waitFor(() => expect(saveBar()).toHaveTextContent('2 unsaved changes'), WAIT)

    await userEvent.click(within(saveBar()).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        description: `${AMULET.description} Soon.`,
        icon: null,
        status: 'active',
      }),
    )
    expect(description()).toHaveValue(`${AMULET.description} Soon.`)
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveTextContent('No icon')
    expect(args.onRejected).not.toHaveBeenCalled()
  },
}

export const Resolved: Story = {
  args: { row: TRUST },
  play: async () => {
    expect(await screen.findByText('Resolved at')).toBeVisible()
    expect(screen.getByText('entry #50')).toBeVisible()
    expect(screen.getByText('Triggered at')).toBeVisible()
    expect(screen.getByText('entry #8')).toBeVisible()
  },
}

export const DanglingRef: Story = {
  args: { row: { ...AMULET, triggeredAtEntryId: 'gone' } },
  play: async () => {
    expect(await screen.findByText(/Entry no longer exists/)).toBeVisible()
  },
}

/** A stored icon key outside the catalog still shows, and stays pickable. */
export const UnknownIconKey: Story = {
  args: { row: { ...AMULET, icon: 'lantern' } },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'Icon' })).toHaveTextContent('lantern')
  },
}

/** `[+] Blank`: no row yet, so no menu; saving selects the new row mid-commit. */
export const Create: Story = {
  args: { row: null },
  play: async ({ args }) => {
    expect(await screen.findByRole('button', { name: 'More actions' })).toBeDisabled()
    expect(screen.getByText('not recorded')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Untitled' }))
    await userEvent.type(await screen.findByPlaceholderText('Untitled'), 'The drowned bell{Enter}')
    const bar = await editDescription('It rings under the river.')
    await waitFor(() => expect(bar).toHaveTextContent('2 unsaved changes'), WAIT)

    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'The drowned bell',
        description: 'It rings under the river.',
        status: 'pending',
        injectionMode: 'auto',
      }),
    )
    expect(args.onRejected).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(FAILED_TEXT)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit The drowned bell' })).toBeVisible()
    expect(description()).toHaveValue('It rings under the river.')
    expect(screen.getByRole('button', { name: 'Status' })).toHaveTextContent('Pending')
    expect(screen.getByRole('button', { name: 'More actions' })).toBeEnabled()
  },
}

/** Blocked from the start: nothing in the pane can be edited. */
export const Blocked: Story = {
  args: { blocked: true },
  play: async () => {
    expect(await screen.findByText('What the amulet wants')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Status' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Icon' })).toBeDisabled()
    const injection = within(screen.getByRole('radiogroup', { name: 'Injection' })).getAllByRole(
      'radio',
    )
    expect(injection).toHaveLength(3)
    for (const radio of injection) expect(radio).toHaveAttribute('aria-disabled', 'true')
    // The Autocomplete's input carries no accessible name yet; its placeholder is unique here.
    const category = screen.getByPlaceholderText('e.g. mystery, goal, conflict')
    expect(category).toHaveAttribute('readonly')
    expect(category).toHaveValue('mystery')
    expect(description()).toHaveAttribute('readonly')
    await userEvent.type(description(), 'x')
    expect(description()).toHaveValue(AMULET.description)
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

/** A run starting mid-edit disables Save with the gate's reason; Discard stays live. */
export const BlockedWhileDirty: Story = {
  play: async ({ args }) => {
    const bar = await editDescription(' Soon.')
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeEnabled()

    await userEvent.keyboard('{F2}')
    await waitFor(
      () => expect(within(bar).getByLabelText(BLOCKED_REASON)).toBeInTheDocument(),
      WAIT,
    )
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled()
    expect(description()).toHaveAttribute('readonly')

    await userEvent.click(within(bar).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(description()).toHaveValue(AMULET.description)
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** An empty title can't be written: the bar says why and Save disables. */
export const InvalidTitle: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Edit What the amulet wants' }))
    await userEvent.clear(await screen.findByDisplayValue('What the amulet wants'))
    await userEvent.keyboard('{Enter}')

    const bar = await screen.findByTestId('save-bar', {}, WAIT)
    expect(bar).toHaveTextContent('Title')
    await waitFor(
      () => expect(within(bar).getByLabelText('A title is required.')).toBeInTheDocument(),
      WAIT,
    )
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled()
    expect(within(bar).getByRole('button', { name: 'Discard' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Untitled' })).toBeVisible()
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** A refusal shows translated text, never the action's developer reason, and is reported. */
export const SaveRejected: Story = {
  args: {
    saveResult: { status: 'rejected', reason: 'generation in flight', code: 'in-flight' },
  },
  play: async ({ args }) => {
    const bar = await editDescription(' Soon.')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(args.onRejected).toHaveBeenCalledWith(IN_FLIGHT_TEXT), WAIT)
    await waitFor(
      () => expect(within(saveBar()).getByLabelText(IN_FLIGHT_TEXT)).toBeVisible(),
      WAIT,
    )
    expect(screen.queryByLabelText('generation in flight')).not.toBeInTheDocument()
    expect(saveBar()).toHaveTextContent('Description')
  },
}

export const SaveFailed: Story = {
  args: { saveResult: { status: 'rejected', reason: 'UNIQUE constraint failed' } },
  play: async ({ args }) => {
    const bar = await editDescription(' Soon.')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(args.onRejected).toHaveBeenCalledWith(FAILED_TEXT), WAIT)
    await waitFor(() => expect(within(saveBar()).getByLabelText(FAILED_TEXT)).toBeVisible(), WAIT)
    expect(screen.queryByLabelText('UNIQUE constraint failed')).not.toBeInTheDocument()
  },
}

/** A thrown save shows the generic failure; the raw error stays in the log. */
export const SaveThrows: Story = {
  args: { saveThrows: true },
  play: async ({ args }) => {
    const bar = await editDescription(' Soon.')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(args.onRejected).toHaveBeenCalledWith(FAILED_TEXT), WAIT)
    await waitFor(() => expect(within(saveBar()).getByLabelText(FAILED_TEXT)).toBeVisible(), WAIT)
    expect(screen.queryByLabelText(/SQLITE_BUSY/)).not.toBeInTheDocument()
  },
}

/** A throwing `onSaved` after the write landed is not a failed save: no error, the bar clears. */
export const SavedHandlerThrows: Story = {
  args: { savedThrows: true },
  play: async ({ args }) => {
    const bar = await editDescription(' Soon.')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onRejected).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(FAILED_TEXT)).not.toBeInTheDocument()
    expect(description()).toHaveValue(`${AMULET.description} Soon.`)
  },
}

/**
 * A leave requested through the session handle waits on the dialog; the gate disables its Save
 * with the gate's reason, and Discard releases the leave.
 */
export const LeaveGuard: Story = {
  play: async ({ args }) => {
    await editDescription(' Soon.')
    await userEvent.keyboard('{F3}')
    const dialog = await screen.findByRole('alertdialog', { name: 'Unsaved changes' }, WAIT)
    expect(args.onLeave).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()

    await userEvent.keyboard('{F2}')
    await waitFor(
      () => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled(),
      WAIT,
    )
    expect(within(dialog).getByText(BLOCKED_REASON)).toBeVisible()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(args.onLeave).toHaveBeenCalledTimes(1), WAIT)
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(description()).toHaveValue(AMULET.description)
  },
}

export const Menu: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    const viewJson = await screen.findByRole('menuitem', { name: 'View raw JSON' })
    await waitFor(() => expect(viewJson).toBeVisible(), WAIT)
    expect(viewJson).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('menuitem', { name: 'Export thread as JSON, Lands in Slice 4.6' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('menuitem', { name: 'Delete thread, Lands in Slice 4.2b' }),
    ).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(viewJson)
    expect(await screen.findByRole('button', { name: 'Close raw JSON viewer' }, WAIT)).toBeVisible()
    expect(screen.getByText(/"thread_amulet"/)).toBeInTheDocument()
  },
}

/** A deep link's unknown `tab` falls back to Overview rather than an empty pane. */
export const UnknownInitialTab: Story = {
  args: { initialTab: 'awareness' },
  play: async () => {
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeVisible()
  },
}

/** Phone: two tabs go to the Select's segment, not a tab strip. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    const segment = await waitFor(() => screen.getByRole('radiogroup', { name: 'Section' }), WAIT)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(within(segment).getByRole('radio', { name: 'Overview' })).toBeChecked()
    await userEvent.click(within(segment).getByRole('radio', { name: 'History' }))
    expect(await screen.findByText('History lands in Slice 4.2b', {}, WAIT)).toBeVisible()
  },
}
