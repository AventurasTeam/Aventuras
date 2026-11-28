import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

// docs/code-conventions.md → Syncing a store after a write: each mutator has its owners.
async function flagged(code: string, filePath: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.some((m) => m.ruleId === 'no-restricted-properties')
}

async function aliasBanned(code: string, filePath: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.some((m) => m.ruleId === 'no-restricted-syntax')
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

const CLOSE_RECORD_MUTATORS = ['setPendingClose', 'clearPendingClose', 'clearDeferredClose']

const BRANCH_DROP_MUTATORS = ['dropBranchRecords']

const RERUN_RECORD_MUTATORS = ['setPendingRerun', 'clearPendingRerun']

const RECORD_MUTATORS = [
  ...CLOSE_RECORD_MUTATORS,
  ...BRANCH_DROP_MUTATORS,
  ...RERUN_RECORD_MUTATORS,
]

// eslint.config.js's record-writer block; prose reversal's clearPendingClose is its own block.
const RECORD_WRITERS = [
  'lib/actions/chapters/__mutator-fixture.ts',
  'lib/pipeline/definitions/chapter-close-boundary.ts',
  'lib/pipeline/definitions/memory-chain.ts',
]

// eslint.config.js's delete block: each drops the records of the branches it removes.
const RECORD_DROPPERS = [
  'lib/actions/stories/delete-story.ts',
  'lib/actions/stories/delete-branch.ts',
]

const RERUN_START = 'lib/actions/chapters/close-rerun.ts'

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

  it('flags an aliased import and a copy, which the fences would miss', async () => {
    const filePath = 'components/reader/__mutator-fixture.ts'
    expect(
      await aliasBanned(
        "import { generationStore as g } from '@/lib/stores'\nexport const x = () => g.dropBranchRecords('r')\n",
        filePath,
      ),
    ).toBe(true)
    expect(
      await aliasBanned(
        `${IMPORT}const s = generationStore\nexport const x = () => s.finishRun('r')\n`,
        filePath,
      ),
    ).toBe(true)
    expect(await aliasBanned(call('getTxState'), filePath)).toBe(false)
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

  it('lets the orchestrator drive a run and set progress, but write no close record', async () => {
    expect(
      await verdicts('lib/pipeline/runtime/__mutator-fixture.ts', [
        ...RUN_MUTATORS,
        'setCloseProgress',
        ...RECORD_MUTATORS,
      ]),
    ).toEqual({
      startRun: false,
      finishRun: false,
      abortRun: false,
      setReversalInProgress: false,
      setCurrentPhase: false,
      recordPhaseResult: false,
      setCloseProgress: false,
      setPendingClose: true,
      clearPendingClose: true,
      clearDeferredClose: true,
      dropBranchRecords: true,
      setPendingRerun: true,
      clearPendingRerun: true,
    })
  })

  it('lets prose reversal drive a run and clear a pick, and nothing else', async () => {
    expect(
      await verdicts('lib/actions/story-entries/prose-reversal.ts', [
        ...RUN_MUTATORS,
        'setCloseProgress',
        ...RECORD_MUTATORS,
      ]),
    ).toEqual({
      startRun: false,
      finishRun: false,
      abortRun: false,
      setReversalInProgress: false,
      setCurrentPhase: false,
      recordPhaseResult: false,
      setCloseProgress: true,
      setPendingClose: true,
      clearPendingClose: false,
      clearDeferredClose: true,
      dropBranchRecords: true,
      setPendingRerun: true,
      clearPendingRerun: true,
    })
  })

  it.each(RECORD_WRITERS)(
    "lets %s write a close's records, but neither a re-run's nor a drop, drive a run nor set progress",
    async (filePath) => {
      expect(
        await verdicts(filePath, [...RECORD_MUTATORS, 'startRun', 'setCloseProgress']),
      ).toEqual({
        setPendingClose: false,
        clearPendingClose: false,
        clearDeferredClose: false,
        dropBranchRecords: true,
        setPendingRerun: true,
        clearPendingRerun: true,
        startRun: true,
        setCloseProgress: true,
      })
    },
  )

  it("lets the re-run's start write its record and a close's, but neither drop, drive a run nor set progress", async () => {
    expect(
      await verdicts(RERUN_START, [...RECORD_MUTATORS, 'startRun', 'setCloseProgress']),
    ).toEqual({
      setPendingClose: false,
      clearPendingClose: false,
      clearDeferredClose: false,
      dropBranchRecords: true,
      setPendingRerun: false,
      clearPendingRerun: false,
      startRun: true,
      setCloseProgress: true,
    })
  })

  it.each(RECORD_DROPPERS)(
    "lets %s drop a branch's records, but write none, drive no run and set no progress",
    async (filePath) => {
      expect(
        await verdicts(filePath, [...RECORD_MUTATORS, 'startRun', 'setCloseProgress']),
      ).toEqual({
        setPendingClose: true,
        clearPendingClose: true,
        clearDeferredClose: true,
        dropBranchRecords: false,
        setPendingRerun: true,
        clearPendingRerun: true,
        startRun: true,
        setCloseProgress: true,
      })
    },
  )

  // The owner blocks sit before the tests' off-block, so an owner's own tests stay exempt.
  it("leaves a record writer's tests alone", async () => {
    expect(await flagged(call('startRun'), 'lib/actions/chapters/__mutator-fixture.test.ts')).toBe(
      false,
    )
    expect(await flagged(call('setPendingRerun'), 'lib/actions/chapters/close-rerun.test.ts')).toBe(
      false,
    )
  })

  it("leaves the deletes' tests alone", async () => {
    expect(await flagged(call('startRun'), 'lib/actions/stories/delete-story.test.ts')).toBe(false)
    expect(await flagged(call('abortRun'), 'lib/actions/stories/delete-branch.test.ts')).toBe(false)
  })

  it("leaves the orchestrator's tests alone", async () => {
    expect(
      await flagged(call('setPendingClose'), 'lib/pipeline/runtime/__mutator-fixture.test.ts'),
    ).toBe(false)
  })
})
