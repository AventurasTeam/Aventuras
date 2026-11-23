import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

async function messages(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  return (await messages(code, filePath)).map((m) => m.ruleId)
}

const NATIVE_FIXTURE = 'lib/db/runtime/__expo-fixture.native.ts'
const IMPORT_BAN = '@typescript-eslint/no-restricted-imports'

const onExpoDb = (call: string) =>
  `import { expoDb } from './client.native'\nexport const run = () => expoDb.${call}\n`

const VALUE_IMPORT =
  "import { openDatabaseSync } from 'expo-sqlite'\nexport const handle = openDatabaseSync('second.db')\n"

describe("the native chain read's async-API ban", () => {
  it.each([
    "getAllAsync('SELECT 1')",
    "runAsync('DELETE FROM x')",
    'withTransactionAsync(async () => {})',
    "execAsync('SELECT 1')",
    "prepareAsync('SELECT 1')",
  ])('flags expoDb.%s', async (call) => {
    expect(await ruleIds(onExpoDb(call), NATIVE_FIXTURE)).toContain('no-restricted-syntax')
  })

  it('names the guarantee and the canon section', async () => {
    const ban = (await messages(onExpoDb("getAllAsync('SELECT 1')"), NATIVE_FIXTURE)).find(
      (m) => m.ruleId === 'no-restricted-syntax',
    )
    expect(ban?.message).toContain('docs/architecture.md#walk-algorithm')
  })

  it.each(["getAllSync('SELECT 1')", "runSync('DELETE FROM x')", 'withTransactionSync(() => {})'])(
    'leaves expoDb.%s alone',
    async (call) => {
      expect(await ruleIds(onExpoDb(call), NATIVE_FIXTURE)).not.toContain('no-restricted-syntax')
    },
  )
})

describe('the expo-sqlite import ban', () => {
  it.each([NATIVE_FIXTURE, 'components/__expo-fixture.tsx'])(
    'flags a value import in %s',
    async (filePath) => {
      expect(await ruleIds(VALUE_IMPORT, filePath)).toContain(IMPORT_BAN)
    },
  )

  it('lets the native client open the handle', async () => {
    expect(await ruleIds(VALUE_IMPORT, 'lib/db/runtime/client.native.ts')).not.toContain(IMPORT_BAN)
  })

  it.each([
    "import type { SQLiteDatabase } from 'expo-sqlite'\nexport type Handle = SQLiteDatabase\n",
    "import { type SQLiteDatabase } from 'expo-sqlite'\nexport type Handle = SQLiteDatabase\n",
  ])('permits a type import: %s', async (code) => {
    expect(await ruleIds(code, NATIVE_FIXTURE)).not.toContain(IMPORT_BAN)
  })
})
