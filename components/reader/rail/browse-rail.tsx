import { ChevronRight } from 'lucide-react-native'
import type { ReactNode, Ref } from 'react'
import { View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { t } from '@/lib/i18n'
import type { RailCategory, RailView } from '@/lib/reader-rail'

import { RailCategorySelect } from './rail-category-select'
import { RailList } from './rail-list'
import type { RailData } from './use-rail-data'

export type BrowseRailProps = {
  data: RailData
  view: RailView
  onViewChange: (view: RailView) => void
  onCategoryChange: (category: RailCategory) => void
  onRowPress: (category: RailCategory, id: string) => void
  onCollapse: () => void
  /** The collapse chevron, for the column to hand focus to after an expand. */
  collapseRef?: Ref<View>
}

/** The expanded rail's content (desktop / tablet); the column around it owns width and border. */
export function BrowseRail({
  data,
  view,
  onViewChange,
  onCategoryChange,
  onRowPress,
  onCollapse,
  collapseRef,
}: BrowseRailProps): ReactNode {
  const collapseLabel = t('reader:rail.collapse')
  return (
    <View testID="reader-rail" className="flex-1 bg-bg-base">
      <RailList
        data={data}
        view={view}
        onViewChange={onViewChange}
        header={<RailCategorySelect value={view.category} onValueChange={onCategoryChange} />}
        headerAction={
          // IconAction titles only its disabled reason; canon gives the chevron a hover tooltip.
          <ReasonTooltip reason={collapseLabel}>
            <IconAction
              ref={collapseRef}
              icon={ChevronRight}
              label={collapseLabel}
              size="sm"
              onPress={onCollapse}
            />
          </ReasonTooltip>
        }
        onRowPress={onRowPress}
      />
    </View>
  )
}
