import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

async function boundaryMessages(source: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath })
  return result.messages.filter((m) => m.ruleId === 'boundaries/dependencies').map((m) => m.message)
}

const CYCLE = 'lib/history imports the lib/actions barrel'
const VALUE_IMPORT =
  "import { humanizeDelta } from '@/lib/history'\nexport const f = humanizeDelta\n"

describe('lib/actions takes nothing from lib/history', () => {
  it.each([
    ['the delta layer', 'lib/actions/delta/__history-fixture.ts'],
    ['the barrel', 'lib/actions/__history-fixture.ts'],
    ['a domain', 'lib/actions/world/__history-fixture.ts'],
  ])('flags a value import from %s', async (_name, filePath) => {
    expect(await boundaryMessages(VALUE_IMPORT, filePath)).toEqual([expect.stringContaining(CYCLE)])
  })

  it('flags a type import too', async () => {
    expect(
      await boundaryMessages(
        "import type { HistoryRow } from '@/lib/history'\nexport type Row = HistoryRow\n",
        'lib/actions/delta/__history-fixture.ts',
      ),
    ).toEqual([expect.stringContaining(CYCLE)])
  })

  it('leaves lib/history importing the lib/actions barrel alone', async () => {
    expect(
      await boundaryMessages(
        "import { isPayloadMetaKey } from '@/lib/actions'\nexport const f = isPayloadMetaKey\n",
        'lib/history/__actions-fixture.ts',
      ),
    ).toEqual([])
  })

  it("leaves lib/actions' tests alone, as every boundaries rule does", async () => {
    expect(
      await boundaryMessages(VALUE_IMPORT, 'lib/actions/delta/__history-fixture.test.ts'),
    ).toEqual([])
  })
})
