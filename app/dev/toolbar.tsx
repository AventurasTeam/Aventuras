import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { Toolbar } from '@/components/compounds/toolbar'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Chip } from '@/components/ui/chip'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

const SORT_OPTIONS = [
  { value: 'last-opened', label: 'Last opened' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
]

const HISTORY_OP_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

export default function ToolbarDevRoute() {
  const [storyQuery, setStoryQuery] = useState('')
  const [storyFilter, setStoryFilter] = useState<'all' | 'favorited' | 'archived'>('all')
  const [storySort, setStorySort] = useState('last-opened')

  const [worldQuery, setWorldQuery] = useState('')
  const [worldFilter, setWorldFilter] = useState<'all' | 'in-scene' | 'staged' | 'retired'>('all')

  const [historyQuery, setHistoryQuery] = useState('')
  const [historyOp, setHistoryOp] = useState<'all' | 'create' | 'update' | 'delete'>('all')
  const [historySort, setHistorySort] = useState('newest')

  const [genInFlight, setGenInFlight] = useState(false)

  return (
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-10 p-4">
        <View className="gap-3">
          <Heading level={2}>Story List shape (search + chips + sort)</Heading>
          <Text size="sm" variant="muted">
            Default desktop layout — single horizontal row. Search expands; chips intrinsic; sort
            hugs content on the right.
          </Text>
          <Toolbar>
            <Toolbar.Search
              value={storyQuery}
              onChange={setStoryQuery}
              placeholder="Search title, description…"
              scope={['title', 'description', 'definition.genre.label', 'tags']}
            />
            <Toolbar.FilterChips>
              <Chip selected={storyFilter === 'all'} onPress={() => setStoryFilter('all')}>
                All
              </Chip>
              <Chip
                selected={storyFilter === 'favorited'}
                onPress={() => setStoryFilter('favorited')}
              >
                Favorited
              </Chip>
              <Chip
                selected={storyFilter === 'archived'}
                onPress={() => setStoryFilter('archived')}
              >
                Archived
              </Chip>
            </Toolbar.FilterChips>
            <Toolbar.Sort
              value={storySort}
              onChange={setStorySort}
              label="Sort"
              options={SORT_OPTIONS}
            />
          </Toolbar>
        </View>

        <View className="gap-3">
          <Heading level={2}>World list shape (search + chips, no sort)</Heading>
          <Text size="sm" variant="muted">
            Sort omitted on World main lists (static four-layer entity sort handles ordering). The
            host adds a 5-way kind-selector outside the toolbar.
          </Text>
          <Toolbar>
            <Toolbar.Search
              value={worldQuery}
              onChange={setWorldQuery}
              placeholder="Search characters…"
              scope={['name', 'description', 'tags']}
            />
            <Toolbar.FilterChips>
              <Chip selected={worldFilter === 'all'} onPress={() => setWorldFilter('all')}>
                All
              </Chip>
              <Chip
                selected={worldFilter === 'in-scene'}
                onPress={() => setWorldFilter('in-scene')}
              >
                In scene
              </Chip>
              <Chip selected={worldFilter === 'staged'} onPress={() => setWorldFilter('staged')}>
                Staged
              </Chip>
              <Chip selected={worldFilter === 'retired'} onPress={() => setWorldFilter('retired')}>
                Retired
              </Chip>
            </Toolbar.FilterChips>
          </Toolbar>
        </View>

        <View className="gap-3">
          <Heading level={2}>History tab shape (search + op-filter chips + sort)</Heading>
          <Text size="sm" variant="muted">
            History tabs (World, Plot) use the toolbar with op-filter chips. Sort dropdown forced
            even at 2 options — visual consistency with Story-List sort.
          </Text>
          <Toolbar>
            <Toolbar.Search
              value={historyQuery}
              onChange={setHistoryQuery}
              placeholder="Search field path, summary…"
              scope={['target_table', 'op', 'undo_payload']}
            />
            <Toolbar.FilterChips>
              <Chip selected={historyOp === 'all'} onPress={() => setHistoryOp('all')}>
                All
              </Chip>
              <Chip selected={historyOp === 'create'} onPress={() => setHistoryOp('create')}>
                Create
              </Chip>
              <Chip selected={historyOp === 'update'} onPress={() => setHistoryOp('update')}>
                Update
              </Chip>
              <Chip selected={historyOp === 'delete'} onPress={() => setHistoryOp('delete')}>
                Delete
              </Chip>
            </Toolbar.FilterChips>
            <Toolbar.Sort
              value={historySort}
              onChange={setHistorySort}
              label="Sort"
              options={HISTORY_OP_OPTIONS}
            />
          </Toolbar>
        </View>

        <View className="gap-3">
          <Heading level={2}>Narrow container (single column, ~600 px)</Heading>
          <Text size="sm" variant="muted">
            Search takes its own row first; chips and sort wrap beneath. Resize this section&apos;s
            wrapper to test the threshold (1024 px container width).
          </Text>
          <View
            style={{ maxWidth: 600 }}
            className="rounded-md border border-dashed border-border p-3"
          >
            <Toolbar>
              <Toolbar.Search
                value={storyQuery}
                onChange={setStoryQuery}
                placeholder="Search title, description…"
                scope={['title', 'description', 'tags']}
              />
              <Toolbar.FilterChips>
                <Chip selected onPress={() => {}}>
                  All
                </Chip>
                <Chip onPress={() => {}}>Favorited</Chip>
                <Chip onPress={() => {}}>Archived</Chip>
              </Toolbar.FilterChips>
              <Toolbar.Sort
                value={storySort}
                onChange={setStorySort}
                label="Sort"
                options={SORT_OPTIONS}
              />
            </Toolbar>
          </View>
        </View>

        <View className="gap-3">
          <Heading level={2}>Edit-restrictions gate (search disabled)</Heading>
          <View className="flex-row items-center gap-3">
            <Chip selected={genInFlight} onPress={() => setGenInFlight((g) => !g)}>
              {genInFlight ? 'Generation IN flight' : 'Start mock generation'}
            </Chip>
            <Text size="xs" variant="muted">
              Toggle to disable search; web tooltip on hover.
            </Text>
          </View>
          <Toolbar>
            <Toolbar.Search
              value=""
              onChange={() => {}}
              placeholder="Search title, description…"
              scope={['title', 'description', 'tags']}
              disabled={genInFlight}
              disabledReason="Generation is in flight. Cancel to edit."
            />
            <Toolbar.FilterChips>
              <Chip selected onPress={() => {}}>
                All
              </Chip>
            </Toolbar.FilterChips>
            <Toolbar.Sort
              value="last-opened"
              onChange={() => {}}
              label="Sort"
              options={SORT_OPTIONS}
              disabled={genInFlight}
            />
          </Toolbar>
        </View>
      </View>
    </ScrollView>
  )
}
