import { describe, expect, it } from 'vitest'

import type { EntryMetadata } from '@/lib/db'

import { unappliedStateRole } from './unapplied'

type Report = NonNullable<EntryMetadata['stateReport']>

const tagged = (over: Partial<Report> = {}): Report => ({
  layer: 'piggyback_tagged_block',
  ...over,
})
const fallback = (over: Partial<Report> = {}): Report => ({ layer: 'per_turn_classifier', ...over })
const narrativeFailure = { field: 'currentLocation', detail: 'no such id' }
const fallbackFailure = { field: 'classifier', detail: 'classifier call failed: provider' }
const dropped = {
  field: 'sceneEntities',
  ref: 'f1',
  reason: 'wrong-kind',
  detail: 'f1 names a faction',
}

describe('unappliedStateRole', () => {
  it.each<[string, Report | undefined]>([
    ['no report', undefined],
    ['a clean tagged block', tagged({ currentLocation: 'loc_1' })],
    ['a clamped delta', tagged({ worldTimeDelta: -50, worldTimeDeltaApplied: 0 })],
    ['a narrative failure the fallback recovered', fallback({ failedFields: [narrativeFailure] })],
    ['a classifier with piggyback off', fallback({ currentLocation: 'loc_1' })],
    ['an applied condition', tagged({ conditions: [{ id: 'loc_1', text: 'flooded' }] })],
  ])('is null for %s', (_label, report) => {
    expect(unappliedStateRole(report)).toBeNull()
  })

  it.each<[string, Report, 'narrative' | 'classifier']>([
    [
      'a rejected location on the tagged path',
      tagged({ currentLocationRejected: true }),
      'narrative',
    ],
    [
      'a rejected condition on the tagged path',
      tagged({ conditions: [{ id: 'char_1', text: 'flooded', rejected: true }] }),
      'narrative',
    ],
    [
      'a tagged failure nothing recovered',
      tagged({ failedFields: [narrativeFailure] }),
      'narrative',
    ],
    [
      'a fallback that failed after the fold',
      tagged({ failedFields: [narrativeFailure, fallbackFailure] }),
      'classifier',
    ],
    ['a fallback that failed alone', fallback({ failedFields: [fallbackFailure] }), 'classifier'],
    [
      'a dropped ref',
      fallback({ failedFields: [narrativeFailure], droppedRefs: [dropped] }),
      'classifier',
    ],
    [
      'a rejected location on the fallback',
      fallback({ currentLocationRejected: true }),
      'classifier',
    ],
  ])('names the model for %s', (_label, report, role) => {
    expect(unappliedStateRole(report)).toBe(role)
  })
})
