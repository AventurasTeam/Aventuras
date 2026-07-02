import { Banner } from '@/components/ui/banner'
import { t } from '@/lib/i18n'
import { appSettingsStore } from '@/lib/stores'

type AppBannerHostProps = { onConfigureProvider: () => void }

/**
 * Thin priority resolver for app-level banners. M2 has one reachable variant
 * (no-providers); embedder + profile-errors land later in priority order.
 */
export function AppBannerHost({ onConfigureProvider }: AppBannerHostProps) {
  const noProviders = appSettingsStore.useAppSettings((s) => s.providers.length === 0)
  if (noProviders) {
    return (
      <Banner
        message={t('landing:banner.aiNotConfigured')}
        ctaLabel={t('landing:banner.setUpProvider')}
        onCta={onConfigureProvider}
      />
    )
  }
  return null
}

export type { AppBannerHostProps }
