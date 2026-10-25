import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

// docs/code-conventions.md → Syncing a store after a write: only the run's owners drive a run.
async function flagged(code: string, filePath: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.some((m) => m.ruleId === 'no-restricted-properties')
}

const IMPORT = "import { generationStore } from '@/lib/stores'\n"

describe('generationStore run-mutator lint', () => {
  it.each(['startRun', 'finishRun', 'abortRun', 'setReversalInProgress'])(
    'flags %s called from a component',
    async (mutator) => {
      expect(
        await flagged(
          `${IMPORT}export const x = () => generationStore.${mutator}('r')\n`,
          'components/reader/__mutator-fixture.ts',
        ),
      ).toBe(true)
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
    expect(
      await flagged(
        `${IMPORT}export const x = () => generationStore.startRun('r')\n`,
        'lib/pipeline/runtime/__mutator-fixture.ts',
      ),
    ).toBe(false)
    expect(
      await flagged(
        `${IMPORT}export const x = () => generationStore.getTxState()\n`,
        'components/reader/__mutator-fixture.ts',
      ),
    ).toBe(false)
  })
})
