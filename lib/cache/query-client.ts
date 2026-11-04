import { QueryClient } from '@tanstack/react-query'

// Every query is a local SQLite read or a compute-derived value, never network state: nothing
// refetches on its own, a failure is logged rather than retried, and a read runs whatever the
// browser says about the network (TanStack's default pauses it on the window's `offline` event).
// A revisited key is rare, so entries go after 30 s rather than holding rows for 5 minutes.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
        retry: false,
        gcTime: 30_000,
      },
    },
  })
}

export const queryClient = createQueryClient()
