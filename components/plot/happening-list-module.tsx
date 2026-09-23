import type { ListModule } from '@/components/list/list-module'
import type { Happening } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  groupHappeningsByBucket,
  HAPPENING_SEARCH_SCOPE,
  happeningFilters,
  queryHappenings,
  type HappeningBucket,
  type HappeningFilter,
  type PlotListSignals,
} from '@/lib/list-modules'

import { HappeningRow } from './happening-row'
import { plotListCopy } from './plot-list-copy'

export type HappeningListModule = ListModule<
  Happening,
  HappeningFilter,
  PlotListSignals,
  HappeningBucket
>

// One instance so consumers compare by identity.
export const happeningListModule: HappeningListModule = {
  filters: happeningFilters,
  query: queryHappenings,
  grouping: {
    group: groupHappeningsByBucket,
    label: (key) => t(`plot:buckets.${key}`),
  },
  copy: plotListCopy('happening', HAPPENING_SEARCH_SCOPE),
  Row: HappeningRow,
}
