import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

async function ruleIds(code: string): Promise<(string | null)[]> {
  // Non-test fixture path so the boundaries rule applies (test files are exempt).
  const [result] = await eslint.lintText(code, { filePath: 'components/__surface-fixture.tsx' })
  return result.messages.map((m) => m.ruleId)
}

describe('lib public-API surfaces', () => {
  it('flags deep imports into module internals', async () => {
    expect(
      await ruleIds("import { runPipeline } from '@/lib/pipeline/runtime/orchestrator'\n"),
    ).toContain('boundaries/dependencies')
    expect(
      await ruleIds("import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'\n"),
    ).toContain('boundaries/dependencies')
    // the raw generation store handle is reachable only by deep import -> flagged
    expect(
      await ruleIds("import { generationStore } from '@/lib/stores/domain/generation'\n"),
    ).toContain('boundaries/dependencies')
  })

  it('allows index imports', async () => {
    expect(await ruleIds("import { runPipeline } from '@/lib/pipeline'\n")).not.toContain(
      'boundaries/dependencies',
    )
    expect(await ruleIds("import { applyDeltaAction } from '@/lib/actions'\n")).not.toContain(
      'boundaries/dependencies',
    )
    expect(await ruleIds("import { domain } from '@/lib/stores'\n")).not.toContain(
      'boundaries/dependencies',
    )
  })
})
