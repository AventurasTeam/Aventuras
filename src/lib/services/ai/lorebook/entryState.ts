/**
 * The blank tracked state an entry of each type starts from.
 *
 * Its own module because both the session ledger and the service need it, and neither
 * should have to import the other for it.
 */

import type { Entry } from '$lib/types'

export function createDefaultEntryState(type: Entry['type']): Entry['state'] {
  switch (type) {
    case 'character':
      return {
        type: 'character',
        isPresent: false,
        lastSeenLocation: null,
        currentDisposition: null,
        relationship: { level: 0, status: 'neutral', history: [] },
        knownFacts: [],
        revealedSecrets: [],
      }
    case 'location':
      return {
        type: 'location',
        isCurrentLocation: false,
        visitCount: 0,
        changes: [],
        presentCharacters: [],
        presentItems: [],
      }
    case 'item':
      return {
        type: 'item',
        inInventory: false,
        currentLocation: null,
        condition: null,
        uses: [],
      }
    case 'faction':
      return {
        type: 'faction',
        playerStanding: 0,
        status: 'unknown',
        knownMembers: [],
      }
    case 'concept':
      return {
        type: 'concept',
        revealed: false,
        comprehensionLevel: 'unknown',
        relatedEntries: [],
      }
    case 'event':
      return {
        type: 'event',
        occurred: false,
        occurredAt: null,
        witnesses: [],
        consequences: [],
      }
  }
}
