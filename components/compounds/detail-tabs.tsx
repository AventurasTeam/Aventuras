import { View } from 'react-native'

import { Select } from '@/components/ui/select'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTier } from '@/hooks/use-tier'

type DetailTab = { value: string; label: string; count?: number }

type DetailTabsProps = {
  tabs: readonly DetailTab[]
  value: string
  onValueChange: (value: string) => void
  /** The Select's accessible label when the strip gives way. */
  selectLabel: string
}

/**
 * tabs.md → Tab-strip overflow rule: strip on desktop at every count, on tablet up to three;
 * otherwise the tab list goes to the Select primitive, whose cascade picks segment vs dropdown.
 * Renders inside the consumer's `<Tabs>` root, in DetailPane's `tabs` slot.
 */
export function DetailTabs({ tabs, value, onValueChange, selectLabel }: DetailTabsProps) {
  const tier = useTier()
  const strip = tier === 'desktop' || (tier === 'tablet' && tabs.length <= 3)
  if (strip) {
    return (
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} count={tab.count}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    )
  }
  return (
    <View className="pb-2">
      <Select
        label={selectLabel}
        size="sm"
        value={value}
        onValueChange={onValueChange}
        options={tabs.map((tab) => ({
          value: tab.value,
          label: tab.count != null ? `${tab.label} ${tab.count}` : tab.label,
        }))}
      />
    </View>
  )
}

export type { DetailTab, DetailTabsProps }
