import { BookMarked } from 'lucide-react-native'
import { useRef, useState, type ComponentRef } from 'react'
import { ScrollView, View } from 'react-native'

import { ListRow } from '@/components/compounds/list-row'
import { IconAction } from '@/components/ui/icon-action'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'
import { type WizardPreset } from '@/lib/wizard'

export type PresetBrowserProps = {
  presets: readonly WizardPreset[]
  /** Accessible name for the trigger and the overlay heading. */
  ariaLabel: string
  onPick: (preset: WizardPreset) => void
}

export function PresetBrowser({ presets, ariaLabel, onPick }: PresetBrowserProps) {
  const isPhone = useTier() === 'phone'
  const [phoneOpen, setPhoneOpen] = useState(false)
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  function closeOverlay() {
    if (isPhone) setPhoneOpen(false)
    // rn-primitives Popover has no controlled `open` prop; PopoverTrigger's
    // ref exposes an imperative close() that flips the shared root context.
    else triggerRef.current?.close()
  }

  function handlePick(preset: WizardPreset) {
    onPick(preset)
    closeOverlay()
  }

  function handleTriggerPress() {
    if (isPhone) setPhoneOpen(true)
  }

  const rows = (
    <ScrollView className="max-h-72">
      <View className="gap-2">
        {presets.map((preset) => (
          <ListRow
            key={preset.id}
            label={preset.displayName}
            description={preset.tagline}
            onPress={() => handlePick(preset)}
          />
        ))}
      </View>
    </ScrollView>
  )

  const trigger = (
    <IconAction
      icon={BookMarked}
      label={t('wizard:world.browsePresets')}
      onPress={handleTriggerPress}
    />
  )

  if (isPhone) {
    // Sheet's DialogPrimitive.Root renders a real portaled View sibling even
    // while closed; a bare Fragment would leak two layout children into the
    // consumer's row (substrate-fragment-layout-leak lesson).
    return (
      <View>
        {trigger}
        <Sheet open={phoneOpen} onOpenChange={setPhoneOpen} ariaLabel={ariaLabel}>
          <SheetContent anchor="bottom" size="auto">
            {rows}
          </SheetContent>
        </Sheet>
      </View>
    )
  }

  return (
    <Popover ariaLabel={ariaLabel}>
      {/* asChild Slot injects ref + handlers; the trigger must accept them
          (aschild-slot-props lesson). */}
      <PopoverTrigger ref={triggerRef} asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-80">{rows}</PopoverContent>
    </Popover>
  )
}
