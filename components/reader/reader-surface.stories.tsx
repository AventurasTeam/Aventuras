import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'

import { ReaderSurface } from './reader-surface'
import { describeTurnFailure } from './system-entry-actions'

const NOW = 1752900000000

const BASE_META = { sceneEntities: [], currentLocationId: null, worldTime: NOW }

// Module scope keeps the frame referentially stable — the edit form's tuple
// memo keys on its identity.
const WORLD_TIME_ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

function entry(
  partial: Partial<StoryEntry> & Pick<StoryEntry, 'id' | 'kind' | 'content' | 'position'>,
): StoryEntry {
  return {
    branchId: 'branch_story',
    chapterId: null,
    metadata: null,
    createdAt: NOW,
    ...partial,
  }
}

const RICH_HTML = [
  '<style>.gal{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gal div{padding:12px;background:linear-gradient(135deg,#1c2541,#3a506b);color:#fff;border-radius:6px}</style>',
  '<div class="gal"><div>East wing</div><div>West wing</div></div>',
].join('\n')

const ROWS: StoryEntry[] = [
  entry({
    id: 'e1',
    kind: 'opening',
    content: 'The gallery had no doors, and yet every visitor arrived.',
    position: 1,
  }),
  entry({
    id: 'e2',
    kind: 'user_action',
    content: 'I step through the frame of the first painting.',
    position: 2,
  }),
  entry({
    id: 'e3',
    kind: 'ai_reply',
    content:
      'Paint parts around you like water. *The room beyond is impossible* — wider than the building itself.',
    position: 3,
    metadata: {
      ...BASE_META,
      reasoning: 'The visitor tests the gallery rules; escalate spatial impossibility.',
    },
  }),
  entry({ id: 'e4', kind: 'ai_reply', content: RICH_HTML, position: 4 }),
  entry({
    id: 'e5',
    kind: 'user_action',
    content: 'I map the two wings against each other.',
    position: 5,
  }),
]

const sceneWiring = {
  entityNames: [],
  sceneOptions: { characters: [], items: [], locations: [] },
  tailEntryId: null,
}

const noopHandlers = {
  onEditScene: async () => ({ ok: true }),
  onRequestEditScene: () => {},
  onNearTop: async () => {},
  onCommitEdit: async () => ({ ok: true }),
  onRequestRollback: async () => {},
  onEditWorldTime: async () => ({ ok: true }),
  onRequestEditWorldTime: async () => {},
  onRegenerate: async () => {},
  onRetrySystemEntry: async () => {},
  onDismissSystemEntry: async () => {},
  onFixSystemEntry: async () => {},
}

const HEAD_TURN_ROWS = ROWS.slice(0, 3)
const EDITED_ACTION = 'I step through the frame of the second painting.'

function entryRow(id: string): HTMLElement {
  const row = document.querySelector(`[data-entry-row="${id}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${id}`)
  return row
}

async function startEditingHeadAction() {
  await userEvent.click(
    within(entryRow('e2')).getByRole('button', { name: t('reader:entryCard.editEntry') }),
  )
  const textarea = await waitFor(() =>
    screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
  )
  await userEvent.clear(textarea)
  await userEvent.type(textarea, EDITED_ACTION)
  await waitFor(() => expect(textarea).toHaveValue(EDITED_ACTION))
}

const meta = {
  title: 'Compounds/Reader/ReaderSurface',
  component: ReaderSurface,
  decorators: [
    (Story) => (
      <div style={{ height: 480, border: '1px solid #ccc' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    rows: ROWS,
    // Footer behavior is covered at the compound layer (entry-card.stories);
    // these stories exercise the surface's scroll/edit machinery instead.
    worldTimeDecorations: {},
    worldTimeFrame: null,
    streaming: null,
    branchKey: 'branch_story',
    hasOlder: false,
    editBlocked: false,
    jumpButtonEnabled: true,
    ...noopHandlers,
    ...sceneWiring,
  },
} satisfies Meta<typeof ReaderSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/**
 * The adapter between the host's `EditResult` and EntryCard's boolean is the one
 * link the compound-layer stories cannot reach: dropping the `.ok` unwrap here
 * returns `undefined`, which would close the Dialog on a write that failed and
 * discard the typed tuple. Driven through the surface for exactly that reason.
 */
export const WorldTimeEditFailureKeepsOverlayOpen: Story = {
  args: {
    worldTimeDecorations: { e3: { label: 'Day 12 · 14:33', raw: 90 } },
    worldTimeFrame: { calendar: EARTH_GREGORIAN, origin: WORLD_TIME_ORIGIN },
    onEditWorldTime: fn(async () => ({ ok: false })),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditWorldTime).toHaveBeenCalledWith('e3', 105))

    expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45')
  },
}

/**
 * The surface resolves the tier for the whole list, so this is the only layer where the
 * viewport → `useTier` → request-fork wiring is still exercised end to end; the compound
 * now takes the resolved value as a prop and states it outright.
 */
export const PhoneRequestsHostOverlay: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: {
    worldTimeDecorations: { e3: { label: 'Day 12 · 14:33', raw: 90 } },
    worldTimeFrame: { calendar: EARTH_GREGORIAN, origin: WORLD_TIME_ORIGIN },
    onRequestEditWorldTime: fn(async () => {}),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(args.onRequestEditWorldTime).toHaveBeenCalledWith('e3'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/**
 * `Save & regenerate` is a compose seam the compound layer cannot reach: the
 * commit must land before the run starts, because the pipeline re-reads its
 * prompt from the branch tail rather than from anything threaded in.
 */
export const SaveAndRegenerateHeadTurn: Story = {
  args: {
    rows: HEAD_TURN_ROWS,
    tailEntryId: 'e3',
    onCommitEdit: fn(async () => ({ ok: true })),
    onRegenerate: fn(async () => {}),
  },
  play: async ({ args }) => {
    const order: string[] = []
    ;(args.onCommitEdit as ReturnType<typeof fn>).mockImplementation(async () => {
      order.push('commit')
      return { ok: true }
    })
    ;(args.onRegenerate as ReturnType<typeof fn>).mockImplementation(async () => {
      order.push('regenerate')
    })

    await startEditingHeadAction()
    await userEvent.click(
      screen.getByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    )

    await waitFor(() => expect(args.onRegenerate).toHaveBeenCalledWith('e3'))
    expect(args.onCommitEdit).toHaveBeenCalledWith('e2', EDITED_ACTION)
    expect(order).toEqual(['commit', 'regenerate'])
  },
}

/** A refused write must not spend a generation on prose the branch never took. */
export const SaveAndRegenerateHeldByFailedWrite: Story = {
  args: {
    rows: HEAD_TURN_ROWS,
    tailEntryId: 'e3',
    onCommitEdit: fn(async () => ({ ok: false })),
    onRegenerate: fn(async () => {}),
  },
  play: async ({ args }) => {
    await startEditingHeadAction()
    await userEvent.click(
      screen.getByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    )

    await waitFor(() => expect(args.onCommitEdit).toHaveBeenCalledWith('e2', EDITED_ACTION))
    expect(args.onRegenerate).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: t('reader:entryCard.editContent') })).toHaveValue(
      EDITED_ACTION,
    )
  },
}

/** Only the head turn's action gets the third button; every other row keeps Save / Cancel. */
export const SaveAndRegenerateAbsentOffHead: Story = {
  args: { rows: HEAD_TURN_ROWS, tailEntryId: 'e3' },
  play: async () => {
    await userEvent.click(
      within(entryRow('e1')).getByRole('button', { name: t('reader:entryCard.editEntry') }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
      ).toBeVisible(),
    )
    expect(
      screen.queryByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    ).not.toBeInTheDocument()
  },
}

export const OlderBoundaryShimmer: Story = {
  args: { hasOlder: true },
}

export const Streaming: Story = {
  args: {
    streaming: {
      content: 'The corridor keeps unfolding as you walk, each step adding',
      reasoning: '',
    },
  },
}

// Composed through describeTurnFailure rather than literals so each bubble shows
// the copy the pipeline would actually persist, magnitude suffix included.
const PROVIDER_FAILURE = describeTurnFailure({
  kind: 'provider',
  reason: 'auth',
  detail: 'provider returned 401 — invalid API key',
})

// No fix action: useSystemEntryActions yields one only for config-resolver and
// embedder failures, so a provider bubble carries Retry and Dismiss alone.
export const SystemFailure: Story = {
  args: {
    rows: [
      ...ROWS,
      entry({
        id: 'e6',
        kind: 'system',
        content: PROVIDER_FAILURE.content,
        position: 6,
        metadata: {
          ...BASE_META,
          systemFailure: { kind: 'provider', detail: PROVIDER_FAILURE.detail },
        },
      }),
    ],
  },
}

const EMBED_FAILURE = describeTurnFailure({
  kind: 'embedder',
  reason: 'call',
  detail: 'embedding request failed: 503',
  staleCount: 2,
})

export const EmbedderFailure: Story = {
  args: {
    rows: [
      ...ROWS,
      entry({
        id: 'e6',
        kind: 'system',
        content: EMBED_FAILURE.content,
        position: 6,
        metadata: {
          ...BASE_META,
          systemFailure: { kind: 'embedder', detail: EMBED_FAILURE.detail },
        },
      }),
    ],
    systemFixLabel: t('reader:systemEntry.switchEmbedder'),
  },
}
