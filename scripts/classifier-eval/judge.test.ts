import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { reply } from './fixture'
import { EVAL_WINDOWS } from './index'
import { describeReply, writeJudgeDump } from './judge'

const happening = { involvements: [], awareness: [] }

describe('describeReply', () => {
  it('gives each happening its turn and time, and each new character its description', () => {
    expect(
      describeReply(
        reply({
          happenings: [
            {
              ...happening,
              title: 'The wreck',
              description: 'She struck the Teeth.',
              sourceTurn: 't2',
              temporal: 'thirty winters back',
            },
            { ...happening, title: 'The fight', sourceTurn: 't4' },
            { ...happening, title: 'The pact', description: 'Sworn.' },
          ],
          newCharacters: [
            { handle: 'new:a', name: '', description: 'A rider who flees.', keywords: [] },
            { handle: 'new:b', name: 'Dov Hask', description: 'A scarred man.', keywords: [] },
          ],
        }),
      ),
    ).toEqual([
      '- happening [t2, thirty winters back] The wreck: She struck the Teeth.',
      '- happening [t4] The fight: (no description)',
      '- happening [] The pact: Sworn.',
      '- new character (blank): A rider who flees.',
      '- new character Dov Hask: A scarred man.',
    ])
  })
})

describe('writeJudgeDump', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'classifier-judge-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // Each window a run replied to gets the user half its prompt showed, as the probe saves it.
  const saveRun = (name: string, replies: Record<string, string>, shown = 'turns') => {
    const runDir = join(dir, name)
    mkdirSync(runDir)
    for (const [file, title] of Object.entries(replies)) {
      writeFileSync(
        join(runDir, file),
        JSON.stringify(reply({ happenings: [{ ...happening, title, description: title }] })),
      )
      const window = /^(\w+)\.\d+\.json$/.exec(file)?.[1]
      if (window != null) writeFileSync(join(runDir, `${window}.user.txt`), `${window} ${shown}`)
    }
    return runDir
  }
  const [ambush, recounted] = EVAL_WINDOWS

  it('writes the turns, each run under a label, and the key naming each label’s run', () => {
    const first = saveRun('first', {
      'ambush.10.json': 'tenth',
      'ambush.02.json': 'second',
      'ambush.2.raw.txt': 'not a reply',
      'ambush.system.txt': 'not a reply',
    })
    const second = saveRun('second', { 'recounted.1.json': 'the wreck' })
    const out = join(dir, 'out')

    writeJudgeDump([ambush!, recounted!], [first, second], out)

    expect(readFileSync(join(out, 'turns', 'ambush.txt'), 'utf8')).toBe('ambush turns')
    expect(readFileSync(join(out, 'turns', 'recounted.txt'), 'utf8')).toBe('recounted turns')
    const key = new Map(
      readFileSync(join(out, 'key.txt'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => [line.split(' ')[1], line.split(' ')[0]] as const),
    )
    expect([...key.values()].sort()).toEqual(['A', 'B'])
    expect(readFileSync(join(out, `run-${key.get(first)}.md`), 'utf8')).toBe(
      [
        `# Run ${key.get(first)}`,
        '',
        '## Window ambush',
        '',
        '### Reply 2',
        '- happening [] second: second',
        '',
        '### Reply 10',
        '- happening [] tenth: tenth',
        '',
      ].join('\n'),
    )
    expect(readFileSync(join(out, `run-${key.get(second)}.md`), 'utf8')).not.toContain('ambush')
  })

  it('refuses an output directory holding anything, so no earlier run file is judged', () => {
    const run = saveRun('run', { 'ambush.1.json': 'first' })
    const out = join(dir, 'out')
    mkdirSync(out)
    writeFileSync(join(out, 'run-C.md'), 'stale')
    expect(() => writeJudgeDump([ambush!], [run], out)).toThrow(/isn't empty/)
  })

  it('refuses runs whose prompts showed a window differently, or a run with no prompt saved', () => {
    const first = saveRun('first', { 'ambush.1.json': 'first' })
    const other = saveRun('other', { 'ambush.1.json': 'first' }, 'other turns')
    expect(() => writeJudgeDump([ambush!], [first, other], join(dir, 'a'))).toThrow(
      /show ambush differently/,
    )
    rmSync(join(other, 'ambush.user.txt'))
    expect(() => writeJudgeDump([ambush!], [other], join(dir, 'b'))).toThrow(/no ambush\.user/)
    expect(existsSync(join(dir, 'b'))).toBe(false)
  })

  it('reads every reply before writing, so a bad one leaves no partial dump', () => {
    const run = saveRun('run', { 'ambush.1.json': 'first', 'recounted.1.json': 'second' })
    writeFileSync(join(run, 'recounted.1.json'), '{ not json')
    const out = join(dir, 'out')
    expect(() => writeJudgeDump([ambush!, recounted!], [run], out)).toThrow(SyntaxError)
    expect(existsSync(out)).toBe(false)
  })
})
