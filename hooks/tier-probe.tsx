import { expect, screen, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'

import { useTier, type Tier } from './use-tier'

// Play helpers for a story that selects a viewport tier. Stories import this; app code never does.

/** The tier `useTier` reads, rendered for a play to wait on. */
export function TierMark() {
  return <Text testID="tier">{useTier()}</Text>
}

/**
 * Resolves once the story's `TierMark` reads `tier`: RN-Web's Dimensions lag a viewport change
 * (lessons-learned/storybook-viewport-usetier-async.md).
 */
export async function waitForTier(tier: Tier, options?: { timeout?: number }): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent(tier), options)
}
