import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

const FIXTURE = 'components/reader/__scoped-read-fixture.ts'

async function flagged(body: string): Promise<boolean> {
  const code = `import { entitiesStore } from '@/lib/stores'\nexport const x = (id: string) => ${body}\n`
  const [result] = await eslint.lintText(code, { filePath: FIXTURE })
  return result.messages.some(
    (m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('getLoadedBranch'),
  )
}

describe('the loaded-branch read ban', () => {
  it('flags a scoped read handed the loaded branch', async () => {
    expect(await flagged('entitiesStore.getRows(entitiesStore.getLoadedBranch())')).toBe(true)
    expect(await flagged("entitiesStore.getById(entitiesStore.getLoadedBranch(), 'e1')")).toBe(true)
  })

  it('leaves a comparison, an object property and an assertion alone', async () => {
    expect(await flagged('entitiesStore.getLoadedBranch() === id')).toBe(false)
    expect(await flagged('({ loadedBranchId: entitiesStore.getLoadedBranch() })')).toBe(false)
    expect(await flagged('expect(entitiesStore.getLoadedBranch()).toBe(id)')).toBe(false)
  })
})
