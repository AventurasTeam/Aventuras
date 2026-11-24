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

const onDb = (call: string) =>
  `import { db } from '@/lib/db'\nconst ctx = { db }\nexport const read = () => ${call}\n`

async function batchBans(code: string, filePath: string) {
  return (await messages(code, filePath)).filter(
    (m) => m.ruleId === 'no-restricted-syntax' && /\bbatch\b/.test(m.message),
  )
}

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

describe("the native driver's missing-batch ban", () => {
  it.each([
    ['components/__batch-fixture.tsx', 'db.batch([])'],
    ['components/__batch-fixture.tsx', 'ctx.db.batch([])'],
    ['lib/history/__batch-fixture.ts', 'db.batch([])'],
    ['lib/history/__batch-fixture.ts', 'ctx.db.batch([])'],
  ])('flags %s calling %s', async (filePath, call) => {
    expect(await batchBans(onDb(call), filePath)).toHaveLength(1)
  })

  it('points at readChainSnapshot and the canon section', async () => {
    const [ban] = await batchBans(onDb('db.batch([])'), 'components/__batch-fixture.tsx')
    expect(ban?.message).toContain('readChainSnapshot')
    expect(ban?.message).toContain('docs/architecture.md#walk-algorithm')
  })

  it('leaves lib/db/runtime alone and keeps its other bans', async () => {
    const code = `${onDb('db.batch([])')}export const sorted = [2, 1].toSorted()\n`
    const filePath = 'lib/db/runtime/__batch-fixture.ts'
    const hermes = (await messages(code, filePath)).filter(
      (m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('Hermes'),
    )
    expect(hermes).toHaveLength(1)
    expect(await batchBans(code, filePath)).toHaveLength(0)
  })
})
