import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = fileURLToPath(new URL('./check-commit-msg.sh', import.meta.url).href)

// The tail git writes under `git commit -v`, captured from a real run.
const VERBOSE_TAIL = [
  '# Please enter the commit message for your changes. Lines starting',
  "# with '#' will be ignored, and an empty message aborts the commit.",
  '#',
  '# On branch main',
  '# Changes to be committed:',
  '#\tmodified:   f.txt',
  '#',
  '# ------------------------ >8 ------------------------',
  '# Do not modify or remove the line above.',
  '# Everything below it will be ignored.',
  'diff --git a/f.txt b/f.txt',
  'index 78981922..71ac1b5d 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1 +1,8 @@',
  ' a',
  '+b',
  '+c',
  '+d',
  '+e',
  '+f',
  '+g',
  '+h',
  '',
].join('\n')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-commit-msg-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const check = (message: string) => {
  const file = join(dir, 'COMMIT_EDITMSG')
  writeFileSync(file, message)
  const run = spawnSync('sh', [HOOK, file], { encoding: 'utf8' })
  return { status: run.status, stderr: run.stderr }
}

describe('check-commit-msg.sh subject', () => {
  it('passes a 72-character subject and refuses a 73-character one', () => {
    const subject72 = `fix: ${'x'.repeat(67)}`
    const subject73 = `fix: ${'x'.repeat(68)}`
    expect(subject72).toHaveLength(72)
    expect(subject73).toHaveLength(73)

    expect(check(`${subject72}\n`).status).toBe(0)
    const refused = check(`${subject73}\n`)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('subject is 73 characters')
  })

  it('counts an em dash as one character, not three bytes', () => {
    const subject72 = `docs: ${'a'.repeat(60)} — ${'b'.repeat(3)}`
    expect(subject72).toHaveLength(72)
    expect(Buffer.byteLength(subject72)).toBe(74)

    expect(check(`${subject72}\n`).status).toBe(0)
    expect(check(`${subject72}b\n`).stderr).toContain('subject is 73 characters')
  })

  it('refuses a subject that runs onto a second line', () => {
    const refused = check('fix: thing\nand more of the subject\n\nBody.\n')
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('runs onto a second line')
  })
})

describe('check-commit-msg.sh cleanup', () => {
  it('judges the subject from the first line after leading blank lines', () => {
    expect(check('\n\nfix: thing\n\nBody.\n').status).toBe(0)
    expect(check(`\n\nfix: ${'x'.repeat(68)}\n`).stderr).toContain('subject is 73 characters')
  })

  it('drops comment lines above and below the subject', () => {
    expect(check('# A comment.\nfix: thing\n').status).toBe(0)
    expect(check('fix: thing\n# A comment.\n\nBody.\n').status).toBe(0)
  })

  it('treats a whitespace-only second line as blank', () => {
    expect(check('fix: thing\n   \nBody.\n').status).toBe(0)
  })
})

describe('check-commit-msg.sh verbose template', () => {
  it('ignores the diff below the scissors line', () => {
    expect(check(`fix: thing\n${VERBOSE_TAIL}`).status).toBe(0)
    expect(check(`fix: thing\n\nOne body line.\n${VERBOSE_TAIL}`).status).toBe(0)
  })

  it('still judges the message above the scissors line', () => {
    const refused = check(`fix: thing\n\n1\n2\n3\n# A comment.\n4\n5\n6\n7\n${VERBOSE_TAIL}`)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('body is 7 lines')
  })
})

describe('check-commit-msg.sh skipped subjects', () => {
  const overCap = `fix: ${'x'.repeat(68)}`

  it.each(['fixup! ', 'squash! ', 'amend! ', 'Merge ', 'Revert '])(
    'skips a subject opening "%s"',
    (prefix) => {
      expect(check(`${prefix}${overCap}\n\n${overCap}\n\n1\n2\n3\n4\n5\n6\n7\n`).status).toBe(0)
    },
  )
})

describe('check-commit-msg.sh body', () => {
  it('passes six body lines and refuses seven', () => {
    const six = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.\nCo-Authored-By: A <a@b.c>'
    expect(six.split('\n')).toHaveLength(6)
    expect(check(`fix: thing\n\n${six}\n`).status).toBe(0)

    const refused = check(`fix: thing\n\n${six}\nLine seven.\n`)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('body is 7 lines')
  })

  it('does not count blank lines between the body and the comments', () => {
    expect(check('fix: thing\n\n1\n2\n3\n4\n5\n6\n\n\n# A comment.\n\n').status).toBe(0)
  })
})
