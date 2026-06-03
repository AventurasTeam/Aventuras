import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

describe('lib/ai public API boundary', () => {
  it('allows root imports and rejects internal deep imports', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })

    const [publicResult] = await eslint.lintText("import { getModel } from '@/lib/ai'\n", {
      filePath: 'components/__ai-public.tsx',
    })
    expect(publicResult.messages.map((message) => message.ruleId)).not.toContain(
      'boundaries/dependencies',
    )

    const [deepResult] = await eslint.lintText(
      "import { createFetchWithCapture } from '@/lib/ai/transport/fetch'\n",
      { filePath: 'components/__ai-deep.tsx' },
    )
    expect(deepResult.messages.map((message) => message.ruleId)).toContain(
      'boundaries/dependencies',
    )
  })
})
