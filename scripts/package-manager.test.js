import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pickPackageManager, commandFor, detectPackageManager } from './package-manager.js'

describe('pickPackageManager', () => {
  it.each([
    [{ aubeOnPath: true, aubeInstalled: true }, 'aube'],
    [{ aubeOnPath: true, aubeInstalled: false }, 'npm'],
    [{ aubeOnPath: false, aubeInstalled: true }, 'npm'],
    [{ aubeOnPath: false, aubeInstalled: false }, 'npm'],
  ])('picks %o -> %s', (input, expected) => {
    expect(pickPackageManager(input)).toBe(expected)
  })
})

describe('commandFor', () => {
  it('runs npm through cmd.exe on win32, DEP0190-safe', () => {
    expect(commandFor('npm', ['run', 'lint'], 'win32')).toEqual([
      'cmd.exe',
      ['/c', 'npm', 'run', 'lint'],
    ])
  })

  it('runs npm directly on non-win32 platforms', () => {
    expect(commandFor('npm', ['run', 'lint'], 'linux')).toEqual(['npm', ['run', 'lint']])
  })

  it('runs aube directly on win32, since it is a real executable there', () => {
    expect(commandFor('aube', ['run', 'lint'], 'win32')).toEqual(['aube', ['run', 'lint']])
  })

  it('runs aube directly on non-win32 platforms', () => {
    expect(commandFor('aube', ['run', 'lint'], 'linux')).toEqual(['aube', ['run', 'lint']])
  })

  it('defaults the platform to process.platform', () => {
    // aube's result is the same on every platform, so this uses npm, whose result differs on
    // win32 -- a wrong default would show up here even though it wouldn't with aube.
    expect(commandFor('npm', ['run', 'lint'])).toEqual(
      commandFor('npm', ['run', 'lint'], process.platform),
    )
  })
})

describe('detectPackageManager', () => {
  it('picks npm when the install marker is absent, without probing aube', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'))
    try {
      expect(detectPackageManager(rootDir)).toBe('npm')
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
