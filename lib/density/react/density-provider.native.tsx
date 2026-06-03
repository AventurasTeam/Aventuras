// Native density provider — uses NativeWind's `vars()` to inline
// the active density's tokens onto a wrapping View. Primitives
// using `h-control-md` etc. resolve to `var(--control-h-md)` per
// tailwind.config.js, and NativeWind's runtime evaluates the var
// against the wrapping View's vars-based style.
import { vars } from 'nativewind'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { View } from 'react-native'

import { useTier } from '@/hooks/use-tier'

import { DensityContext, type DensityContextValue } from './density-context'
import { densityTokens } from '../core/registry'
import { resolveDensity } from '../core/resolve'
import type { DensitySetting } from '../types'

export function DensityProvider({ children }: { children: ReactNode }) {
  const tier = useTier()
  const [setting, setSetting] = useState<DensitySetting>('default')
  const resolved = useMemo(() => resolveDensity(setting, tier), [setting, tier])
  const updateSetting = useCallback((s: DensitySetting) => setSetting(s), [])
  const densityVars = useMemo(() => vars(densityTokens[resolved]), [resolved])
  const value = useMemo<DensityContextValue>(
    () => ({ setting, resolved, setSetting: updateSetting }),
    [setting, resolved, updateSetting],
  )
  return (
    <DensityContext.Provider value={value}>
      <View className="flex-1" style={densityVars}>
        {children}
      </View>
    </DensityContext.Provider>
  )
}
