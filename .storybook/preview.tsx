import type { Preview } from '@storybook/react-native-web-vite'
import React from 'react'

import { DensityProvider } from '@/lib/density/density-provider'
import { useDensity } from '@/lib/density/use-density'
import type { DensitySetting } from '@/lib/density/types'
import { themes as registryThemes } from '@/lib/themes/registry'
import { ThemeProvider } from '@/lib/themes/theme-provider'
import { useTheme } from '@/lib/themes/use-theme'

import '../global.css'

function ThemeApplier({ themeId, children }: { themeId: string; children: React.ReactNode }) {
  const { setTheme } = useTheme()
  React.useEffect(() => setTheme(themeId), [themeId, setTheme])
  return <>{children}</>
}

function DensityApplier({
  setting,
  children,
}: {
  setting: DensitySetting
  children: React.ReactNode
}) {
  const { setSetting } = useDensity()
  React.useEffect(() => setSetting(setting), [setting, setSetting])
  return <>{children}</>
}

const themeOptions = registryThemes.map((t) => ({ value: t.id, title: t.name }))

const densityOptions: { value: DensitySetting; title: string }[] = [
  { value: 'default', title: 'Default (per tier)' },
  { value: 'compact', title: 'Compact' },
  { value: 'regular', title: 'Regular' },
  { value: 'comfortable', title: 'Comfortable' },
]

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
  },
  globalTypes: {
    theme: {
      description: 'Active theme (drives useTheme context)',
      defaultValue: registryThemes[0].id,
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: themeOptions,
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Active density (drives useDensity context)',
      defaultValue: 'default',
      toolbar: {
        title: 'Density',
        icon: 'ruler',
        items: densityOptions,
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const themeId = (context.globals.theme as string) ?? registryThemes[0].id
      const densitySetting = (context.globals.density as DensitySetting) ?? 'default'
      return (
        <ThemeProvider>
          <DensityProvider>
            <ThemeApplier themeId={themeId}>
              <DensityApplier setting={densitySetting}>
                <Story />
              </DensityApplier>
            </ThemeApplier>
          </DensityProvider>
        </ThemeProvider>
      )
    },
  ],
}

export default preview
