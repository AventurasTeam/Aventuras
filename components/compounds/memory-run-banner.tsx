import { Info } from 'lucide-react-native'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { t } from '@/lib/i18n'

import { useMemoryRunBanner } from './use-memory-run-banner'

type MemoryRunBannerViewProps = {
  label: string
  onCancel: () => void
}

/** The info-toned bar under the in-story chrome while a memory run holds the gate. */
export function MemoryRunBannerView({ label, onCancel }: MemoryRunBannerViewProps) {
  return (
    <View
      // E2E scope anchor: the banner's Cancel shares its role and name with the composer's.
      testID="memory-run-banner"
      role="status"
      className="relative w-full flex-row items-center gap-2 border-b border-info px-4 py-1.5"
    >
      <View
        aria-hidden
        style={POINTER_EVENTS_NONE}
        className="absolute inset-0 bg-info opacity-[.12]"
      />
      <Icon as={Info} size="sm" className="text-info" />
      <Text size="sm" className="flex-1 text-fg-primary">
        {label}
      </Text>
      <Button variant="ghost" size="sm" onPress={onCancel}>
        <Text>{t('cancel')}</Text>
      </Button>
    </View>
  )
}

/** The open branch's pass, as a banner; nothing while none runs. `ScreenShell` mounts it on `in-story`. */
export function MemoryRunBanner() {
  const banner = useMemoryRunBanner()
  if (banner == null) return null
  return <MemoryRunBannerView label={banner.label} onCancel={banner.onCancel} />
}

export type { MemoryRunBannerViewProps }
