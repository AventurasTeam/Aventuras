// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResolveFailureKind } from '@/lib/ai'
import { t } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'
import type { PipelineError } from '@/lib/pipeline'

import { describeSuggestionFailure } from './suggestion-failure'
import {
  describePassFailure,
  describeTurnFailure,
  useConfigFixAction,
} from './system-entry-actions'

vi.mock('expo-router', () => ({ useRouter: () => ({ navigate: vi.fn(), push: vi.fn() }) }))

afterEach(cleanup)

type WordingSet = 'turn' | 'pass' | 'suggestion' | 'fix'

// Spelled out here rather than read off the resolvers, so a swapped pair there fails here; the
// Record makes a new kind a type error in this file too.
const EXPECTED: Record<ResolveFailureKind, Record<WordingSet, string>> = {
  'no-profile-assigned': {
    turn: 'reader:systemEntry.failure.noProfileAssigned',
    pass: 'reader:systemEntry.failure.memoryNoProfileAssigned',
    suggestion: 'reader:suggestions.failure.noProfileAssigned',
    fix: 'reader:systemEntry.assignProfile',
  },
  'profile-missing': {
    turn: 'reader:systemEntry.failure.profileMissing',
    pass: 'reader:systemEntry.failure.memoryProfileMissing',
    suggestion: 'reader:suggestions.failure.profileMissing',
    fix: 'reader:systemEntry.fixProfile',
  },
  'provider-missing': {
    turn: 'reader:systemEntry.failure.providerMissing',
    pass: 'reader:systemEntry.failure.memoryProviderMissing',
    suggestion: 'reader:suggestions.failure.providerMissing',
    fix: 'reader:systemEntry.fixDefault',
  },
  'override-provider-missing': {
    turn: 'reader:systemEntry.failure.overrideProviderMissing',
    pass: 'reader:systemEntry.failure.memoryOverrideProviderMissing',
    suggestion: 'reader:suggestions.failure.overrideProviderMissing',
    fix: 'reader:systemEntry.fixOverride',
  },
}

const KINDS = Object.keys(EXPECTED) as ResolveFailureKind[]
const SETS: WordingSet[] = ['turn', 'pass', 'suggestion', 'fix']

const copyOf = (key: string) => (t as unknown as (k: string) => string)(key)

function resolverError(failure: ResolveFailureKind): PipelineError {
  return { kind: 'config-resolver', failure, target: 'narrative', phaseName: 'narrative' }
}

function resolve(kind: ResolveFailureKind, set: WordingSet): string | undefined {
  const error = resolverError(kind)
  if (set === 'turn') return describeTurnFailure(error).content
  if (set === 'pass') return describePassFailure({ held: false, error }).content
  if (set === 'suggestion') return describeSuggestionFailure(error)
  return renderHook(() => useConfigFixAction(kind, 'story_1', (proceed) => proceed())).result
    .current?.label
}

describe('resolver failure copy', () => {
  // Distinct copy per kind is what lets the per-kind checks below tell a swap apart.
  it.each(SETS)('gives each kind its own real %s copy', (set) => {
    const keys = KINDS.map((kind) => EXPECTED[kind][set])
    expect(keys.filter((key) => !hasCopy(key))).toEqual([])
    expect(new Set(keys.map(copyOf)).size).toBe(KINDS.length)
  })

  it.each(KINDS.flatMap((kind) => SETS.map((set) => [kind, set] as const)))(
    'resolves a %s failure to its own %s copy',
    (kind, set) => {
      expect(resolve(kind, set)).toBe(copyOf(EXPECTED[kind][set]))
    },
  )
})
