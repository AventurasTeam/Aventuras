import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./check-skills.sh', import.meta.url).href)
const REPO_SKILLS = fileURLToPath(new URL('../.agents/skills', import.meta.url).href)

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-skills-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const put = (relativePath: string, content: string) => {
  const path = join(dir, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

const check = (skillsDir = dir) => {
  const run = spawnSync('sh', [SCRIPT, skillsDir], { encoding: 'utf8' })
  return { status: run.status, stderr: run.stderr }
}

describe('check-skills.sh size', () => {
  it('passes an 18,999-byte SKILL.md and refuses a 19,000-byte one', () => {
    put('aventuras-a/SKILL.md', 'x'.repeat(18999))
    expect(check().status).toBe(0)

    put('aventuras-a/SKILL.md', 'x'.repeat(19000))
    const refused = check()
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('aventuras-a/SKILL.md is 19000 bytes')
  })

  it('counts bytes, so multi-byte characters count in full', () => {
    put('aventuras-a/SKILL.md', `${'x'.repeat(18997)}—`)
    expect(check().stderr).toContain('aventuras-a/SKILL.md is 19000 bytes')
  })

  it('leaves vendored skills outside the aventuras- namespace unchecked', () => {
    put('vendored/SKILL.md', 'x'.repeat(40000))
    expect(check().status).toBe(0)
  })

  it('ignores the size of files beside SKILL.md', () => {
    put('aventuras-a/SKILL.md', 'short')
    put('aventuras-a/references/long.md', 'x'.repeat(40000))
    expect(check().status).toBe(0)
  })
})

describe('check-skills.sh scenario prompts', () => {
  it('refuses a pressure-scenario prompt in plain text anywhere in a skill', () => {
    put('aventuras-a/SKILL.md', 'short')
    put(
      'aventuras-a/references/campaign.md',
      'IMPORTANT: This is a real scenario. Choose and act.\n',
    )
    const refused = check()
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('aventuras-a/references/campaign.md:1')
  })

  it('allows the phrase inside a fenced code block', () => {
    put('aventuras-a/SKILL.md', 'short')
    put(
      'aventuras-a/references/how-to-test.md',
      'Example:\n\n```markdown\nIMPORTANT: This is a real scenario. Choose and act.\n```\n',
    )
    expect(check().status).toBe(0)
  })

  it("doesn't carry one file's unclosed fence into the next file", () => {
    const content = 'This is a real scenario. Choose and act.\n```\nunclosed\n'
    put('aventuras-a/x.md', content)
    put('aventuras-a/y.md', content)
    const { stderr } = check()
    expect(stderr).toContain('aventuras-a/x.md:1')
    expect(stderr).toContain('aventuras-a/y.md:1')
  })

  it('refuses the phrase after a fenced block has closed, in any skill', () => {
    put('vendored/SKILL.md', 'short')
    put(
      'vendored/notes.md',
      '```\nfenced\n```\nThis is a real scenario. You must choose and act.\n',
    )
    expect(check().stderr).toContain('vendored/notes.md:4')
  })
})

describe("the repo's own skills", () => {
  it('pass the check', () => {
    const run = check(REPO_SKILLS)
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
  })
})
