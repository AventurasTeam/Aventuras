import type { ListModule } from '@/components/list/list-module'
import type { Thread } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  groupThreadsByTier,
  queryThreads,
  THREAD_FILTERS,
  THREAD_SEARCH_SCOPE,
  type PlotListSignals,
  type ThreadFilter,
  type ThreadTier,
} from '@/lib/list-modules'

import { plotListCopy } from './plot-list-copy'
import { ThreadRow } from './thread-row'

export type ThreadListModule = ListModule<Thread, ThreadFilter, PlotListSignals, ThreadTier>

// One instance so consumers compare by identity.
export const threadListModule: ThreadListModule = {
  filters: () => THREAD_FILTERS,
  query: (rows, input) => queryThreads(rows, input),
  grouping: {
    group: (rows) => groupThreadsByTier(rows),
    label: (key) => t(`plot:tiers.${key}`),
  },
  copy: plotListCopy('thread', THREAD_SEARCH_SCOPE),
  Row: ThreadRow,
}
