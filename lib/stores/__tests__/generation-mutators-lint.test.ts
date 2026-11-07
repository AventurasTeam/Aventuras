import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

// docs/code-conventions.md → Syncing a store after a write: each mutator has its owners.
async function flagged(code: string, filePath: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.some((m) => m.ruleId === 'no-restricted-properties')
}

const IMPORT = "import { generationStore } from '@/lib/stores'\n"

const call = (mutator: string): string =>
  `${IMPORT}export const x = () => generationStore.${mutator}('r')\n`

const RUN_MUTATORS = [
  'startRun',
  'finishRun',
  'abortRun',
  'setReversalInProgress',
  'setCurrentPhase',
  'recordPhaseResult',
]

const RECORD_MUTATORS = [
  'setPendingClose',
  'clearPendingClose',
  'clearDeferredClose',
  'dropBranchRecords',
]

// eslint.config.js's record-writer block.
const RECORD_WRITERS = [
  'lib/actions/chapters/__mutator-fixture.ts',
  'lib/actions/stories/delete-story.ts',
  'lib/pipeline/definitions/chapter-close-boundary.ts',
  'lib/pipeline/definitions/memory-chain.ts',
]

async function verdicts(
  filePath: string,
  mutators: readonly string[],
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  for (const mutator of mutators) out[mutator] = await flagged(call(mutator), filePath)
  return out
}

describe('generationStore mutator lint', () => {
  it.each([...RUN_MUTATORS, ...RECORD_MUTATORS, 'setCloseProgress'])(
    'flags %s called from a component',
    async (mutator) => {
      expect(await flagged(call(mutator), 'components/reader/__mutator-fixture.ts')).toBe(true)
    },
  )

  it('flags a mutator pulled off the store by destructuring', async () => {
    expect(
      await flagged(
        `${IMPORT}const { finishRun } = generationStore\nexport const x = finishRun\n`,
        'components/reader/__mutator-fixture.ts',
      ),
    ).toBe(true)
  })

  it('leaves the orchestrator, and every read, alone', async () => {
    expect(await flagged(call('startRun'), 'lib/pipeline/runtime/__mutator-fixture.ts')).toBe(false)
    expect(
      await flagged(
        `${IMPORT}export const x = () => generationStore.getTxState()\n`,
        'components/reader/__mutator-fixture.ts',
      ),
    ).toBe(false)
  })

  it("lets the orchestrator set a close's progress", async () => {
    expect(
      await flagged(call('setCloseProgress'), 'lib/pipeline/runtime/__mutator-fixture.ts'),
    ).toBe(false)
  })

  it.each(RECORD_WRITERS)(
    "lets %s write a close's records, but neither drive a run nor set progress",
    async (filePath) => {
      expect(
        await verdicts(filePath, [...RECORD_MUTATORS, 'startRun', 'setCloseProgress']),
      ).toEqual({
        setPendingClose: false,
        clearPendingClose: false,
        clearDeferredClose: false,
        dropBranchRecords: false,
        startRun: true,
        setCloseProgress: true,
      })
    },
  )

  // The writer block sits before the tests' off-block, so a writer's own tests stay exempt.
  it("leaves a record writer's tests alone", async () => {
    expect(await flagged(call('startRun'), 'lib/actions/chapters/__mutator-fixture.test.ts')).toBe(
      false,
    )
  })
})
