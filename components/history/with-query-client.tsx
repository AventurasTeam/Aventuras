import type { Decorator } from '@storybook/react-native-web-vite'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { createQueryClient } from '@/lib/cache'

function WithQueryClient({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Stories only: a fresh React Query client per story, for trees that read through React Query
 * (`useEntryIndex`), since the Storybook preview provides none.
 */
export const withQueryClient: Decorator = (Story) => (
  <WithQueryClient>
    <Story />
  </WithQueryClient>
)
