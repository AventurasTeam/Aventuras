import type { Meta, StoryObj } from '@storybook/react-native-web-vite'

import type { StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'

import { ReaderSurface } from './reader-surface'
import { describeTurnFailure } from './system-entry-actions'

const NOW = 1752900000000

const BASE_META = { sceneEntities: [], currentLocationId: null, worldTime: NOW }

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

const noopHandlers = {
  onNearTop: async () => {},
  onCommitEdit: async () => ({ ok: true }),
  onRequestRollback: async () => {},
  onEditWorldTime: async () => ({ ok: true }),
  onRequestEditWorldTime: async () => {},
  onRetrySystemEntry: async () => {},
  onDismissSystemEntry: async () => {},
  onFixSystemEntry: async () => {},
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
    calendar: null,
    worldTimeOrigin: null,
    streaming: null,
    branchKey: 'branch_story',
    hasOlder: false,
    editBlocked: false,
    jumpButtonEnabled: true,
    ...noopHandlers,
  },
} satisfies Meta<typeof ReaderSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

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
