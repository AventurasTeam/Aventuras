import { View } from 'react-native'

import { Select } from '@/components/ui/select'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'

type DetailTab = { value: string; label: string; count?: number }

type DetailTabsProps = {
  tabs: readonly DetailTab[]
  value: string
  onValueChange: (value: string) => void
  /** The Select's accessible label when the strip gives way. */
  selectLabel: string
}

/**
 * tabs.md → Tab-strip overflow rule: strip on desktop, and on tablet up to 3 tabs; beyond that
 * it renders the Select instead. Expects the consumer's `<Tabs>` root already mounted around it.
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
    // flex-1 fills the shell's horizontal tabs ScrollView, which otherwise sizes the Select to
    // its content; pt-2 keeps it off the header divider the strip variant sits flush against.
    // Below it, the content's own top padding spaces it, as it does under the strip.
    <View className="flex-1 pt-2">
      <Select
        label={selectLabel}
        size="sm"
        value={value}
        onValueChange={onValueChange}
        // A plain label string can't style the count, and a bare trailing number reads as name.
        options={tabs.map((tab) => ({
          value: tab.value,
          label:
            tab.count != null
              ? t('labelWithCount', { label: tab.label, value: tab.count })
              : tab.label,
        }))}
      />
    </View>
  )
}

export type { DetailTab, DetailTabsProps }
