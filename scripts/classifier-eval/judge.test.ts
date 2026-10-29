import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  const saveRun = (name: string, replies: Record<string, string>) => {
    const runDir = join(dir, name)
    mkdirSync(runDir)
    for (const [file, title] of Object.entries(replies))
      writeFileSync(
        join(runDir, file),
        JSON.stringify(reply({ happenings: [{ ...happening, title, description: title }] })),
      )
    return runDir
  }

  it('writes the turns, each run under a label, and the key naming each label’s run', () => {
    const [ambush, recounted] = EVAL_WINDOWS
    const first = saveRun('first', {
      'ambush.10.json': 'tenth',
      'ambush.2.json': 'second',
      'ambush.2.raw.txt': 'not a reply',
      'ambush.prompt.txt': 'not a reply',
    })
    const second = saveRun('second', { 'recounted.1.json': 'the wreck' })
    const out = join(dir, 'out')

    writeJudgeDump([ambush!, recounted!], [first, second], out)

    expect(readFileSync(join(out, 'turns', 'ambush.txt'), 'utf8')).toContain('[t1]')
    expect(readFileSync(join(out, 'turns', 'recounted.txt'), 'utf8')).toContain('[t1]')
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
})
