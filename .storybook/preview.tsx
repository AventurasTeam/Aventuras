import type { Preview } from '@storybook/react-native-web-vite'
import React from 'react'

import { themes as registryThemes } from '@/lib/themes/registry'
import { ThemeProvider } from '@/lib/themes/theme-provider'
import { useTheme } from '@/lib/themes/use-theme'

import '../global.css'

function ThemeApplier({ themeId, children }: { themeId: string; children: React.ReactNode }) {
  const { setTheme } = useTheme()
  React.useEffect(() => setTheme(themeId), [themeId, setTheme])
  return <>{children}</>
}

const themeOptions = registryThemes.map((t) => ({ value: t.id, title: t.name }))

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
  },
  decorators: [
    (Story, context) => {
      const themeId = (context.globals.theme as string) ?? registryThemes[0].id
      return (
        <ThemeProvider>
          <ThemeApplier themeId={themeId}>
            <Story />
          </ThemeApplier>
        </ThemeProvider>
      )
    },
  ],
}

export default preview
