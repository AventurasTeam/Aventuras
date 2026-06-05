import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

describe('lib/* public-API boundary', () => {
  it('flags a deep import of lib/db internals from outside the module', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })
    const [result] = await eslint.lintText("import { stories } from '@/lib/db/schema'\n", {
      filePath: 'components/__deep-import-fixture.tsx',
    })
    expect(result.messages.map((m) => m.ruleId)).toContain('boundaries/dependencies')
  })

  it('permits barrel imports of new table row types, JSON types, and schemas via @/lib/db', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })
    const [result] = await eslint.lintText(
      "import { storySettingsSchema } from '@/lib/db'\nimport type { Entity, EntityState } from '@/lib/db'\n",
      { filePath: 'components/__barrel-import-fixture.tsx' },
    )
    expect(result.messages.map((m) => m.ruleId)).not.toContain('boundaries/dependencies')
  })
})
