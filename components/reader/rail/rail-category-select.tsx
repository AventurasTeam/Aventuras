import type { ReactNode } from 'react'

import { Select } from '@/components/ui/select'
import { t } from '@/lib/i18n'
import { isRailCategory, RAIL_CATEGORIES, railGroupOf, type RailCategory } from '@/lib/reader-rail'

import { railCategoryLabel } from './rail-modules'

/** Category picker, grouped per principles.md → World / Plot split. */
export function RailCategorySelect({
  value,
  onValueChange,
}: {
  value: RailCategory
  onValueChange: (category: RailCategory) => void
}): ReactNode {
  return (
    <Select
      mode="dropdown"
      size="sm"
      label={t('reader:rail.categorySelect')}
      value={value}
      onValueChange={(next) => {
        if (isRailCategory(next)) onValueChange(next)
      }}
      options={RAIL_CATEGORIES.map((category) => ({
        value: category,
        label: railCategoryLabel(category),
        group: t(`reader:rail.groups.${railGroupOf(category)}`),
      }))}
    />
  )
}
