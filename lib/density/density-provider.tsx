// Web density provider. Sets `data-density` attribute on the
// document body so CSS vars defined per `[data-density="X"]` block
// (emitted by css-generator.ts into global.css) resolve from any
// descendant.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTier } from '@/hooks/use-tier'
import { DensityContext, type DensityContextValue } from './density-context'
import { resolveDensity } from './resolve'
import type { DensitySetting } from './types'

export function DensityProvider({ children }: { children: ReactNode }) {
  const tier = useTier()
  const [setting, setSetting] = useState<DensitySetting>('default')
  const resolved = useMemo(() => resolveDensity(setting, tier), [setting, tier])
  const updateSetting = useCallback((s: DensitySetting) => setSetting(s), [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.setAttribute('data-density', resolved)
  }, [resolved])

  const value = useMemo<DensityContextValue>(
    () => ({ setting, resolved, setSetting: updateSetting }),
    [setting, resolved, updateSetting],
  )
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
}
