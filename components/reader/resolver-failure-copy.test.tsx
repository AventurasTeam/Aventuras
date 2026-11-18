// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { t } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'
import type { ConfigFailureKind, PipelineError } from '@/lib/pipeline'

import { describeSuggestionFailure } from './suggestion-failure'
import {
  describeCloseFailure,
  describePassFailure,
  describeTurnFailure,
  useConfigFixAction,
} from './system-entry-actions'

vi.mock('expo-router', () => ({ useRouter: () => ({ navigate: vi.fn(), push: vi.fn() }) }))

afterEach(cleanup)

type WordingSet = 'turn' | 'pass' | 'close' | 'suggestion' | 'fix'

// Spelled out here rather than read off the resolvers, so a swapped pair there fails here; the
// Record makes a new kind a type error in this file too.
const EXPECTED: Record<ConfigFailureKind, Record<WordingSet, string>> = {
  'no-profile-assigned': {
    turn: 'reader:systemEntry.failure.noProfileAssigned',
    pass: 'reader:systemEntry.failure.memoryNoProfileAssigned',
    close: 'reader:systemEntry.failure.closeNoProfileAssigned',
    suggestion: 'reader:suggestions.failure.noProfileAssigned',
    fix: 'reader:systemEntry.assignProfile',
  },
  'profile-missing': {
    turn: 'reader:systemEntry.failure.profileMissing',
    pass: 'reader:systemEntry.failure.memoryProfileMissing',
    close: 'reader:systemEntry.failure.closeProfileMissing',
    suggestion: 'reader:suggestions.failure.profileMissing',
    fix: 'reader:systemEntry.fixProfile',
  },
  'provider-missing': {
    turn: 'reader:systemEntry.failure.providerMissing',
    pass: 'reader:systemEntry.failure.memoryProviderMissing',
    close: 'reader:systemEntry.failure.closeProviderMissing',
    suggestion: 'reader:suggestions.failure.providerMissing',
    fix: 'reader:systemEntry.fixDefault',
  },
  'override-provider-missing': {
    turn: 'reader:systemEntry.failure.overrideProviderMissing',
    pass: 'reader:systemEntry.failure.memoryOverrideProviderMissing',
    close: 'reader:systemEntry.failure.closeOverrideProviderMissing',
    suggestion: 'reader:suggestions.failure.overrideProviderMissing',
    fix: 'reader:systemEntry.fixOverride',
  },
  // Only a close's pre-flight raises it: every other set takes its generic line, and its remedy
  // is the profile's, as profile-missing's is.
  'tool-calling-off': {
    turn: 'reader:systemEntry.failureMessage',
    pass: 'reader:systemEntry.failure.memory',
    close: 'reader:systemEntry.failure.closeToolCallingOff',
    suggestion: 'reader:suggestions.errorBody',
    fix: 'reader:systemEntry.fixProfile',
  },
}

const KINDS = Object.keys(EXPECTED) as ConfigFailureKind[]
const SETS: WordingSet[] = ['turn', 'pass', 'close', 'suggestion', 'fix']
const MODEL = 'gemma-4-26b'

const copyOf = (key: string) =>
  (t as unknown as (k: string, values: { model: string }) => string)(key, { model: MODEL })

function resolverError(failure: ConfigFailureKind): PipelineError {
  return {
    kind: 'config-resolver',
    failure,
    target: 'narrative',
    phaseName: 'narrative',
    modelId: MODEL,
  }
}

function resolve(kind: ConfigFailureKind, set: WordingSet): string | undefined {
  const error = resolverError(kind)
  if (set === 'turn') return describeTurnFailure(error).content
  if (set === 'pass') return describePassFailure({ held: false, error }).content
  if (set === 'close') return describeCloseFailure(error).content
  if (set === 'suggestion') return describeSuggestionFailure(error)
  return renderHook(() => useConfigFixAction(kind, 'story_1', (proceed) => proceed())).result
    .current?.label
}

describe('resolver failure copy', () => {
  // Distinct copy per key is what lets the per-kind checks below tell a swap apart. Two kinds share
  // a key only in the fix set, where profile-missing and tool-calling-off open the same screen.
  it.each(SETS)('gives each kind its own real %s copy', (set) => {
    const keys = KINDS.map((kind) => EXPECTED[kind][set])
    expect(keys.filter((key) => !hasCopy(key))).toEqual([])
    expect(new Set(keys.map(copyOf)).size).toBe(new Set(keys).size)
    expect(new Set(keys).size).toBe(set === 'fix' ? KINDS.length - 1 : KINDS.length)
  })

  it.each(KINDS.flatMap((kind) => SETS.map((set) => [kind, set] as const)))(
    'resolves a %s failure to its own %s copy',
    (kind, set) => {
      expect(resolve(kind, set)).toBe(copyOf(EXPECTED[kind][set]))
    },
  )

  it("names the model in the close's can't-call-tools line", () => {
    expect(resolve('tool-calling-off', 'close')).toBe(
      "Chapter close can't run: its model, gemma-4-26b, is marked as unable to call tools, which the close needs. Pick another model for chapter close, or set this story's own on its Models tab.",
    )
  })
})
