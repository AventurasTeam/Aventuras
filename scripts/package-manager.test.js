import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { commandFor, detectPackageManager } from './package-manager.js'

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawnSync: vi.fn(),
}))

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
  function withRootDir(hasAubeState, fn) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'))
    try {
      if (hasAubeState)
        fs.mkdirSync(path.join(rootDir, 'node_modules', '.aube-state'), { recursive: true })
      fn(rootDir)
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  }

  it('picks npm when the install marker is absent, without probing aube', () => {
    withRootDir(false, (rootDir) => {
      expect(detectPackageManager(rootDir)).toBe('npm')
      expect(spawnSync).not.toHaveBeenCalled()
    })
  })

  it('picks aube when the marker is present and the probe succeeds', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 })
    withRootDir(true, (rootDir) => {
      expect(detectPackageManager(rootDir)).toBe('aube')
    })
  })

  it('picks npm when the marker is present but aube is not on PATH', () => {
    vi.mocked(spawnSync).mockReturnValue({ error: new Error('ENOENT') })
    withRootDir(true, (rootDir) => {
      expect(detectPackageManager(rootDir)).toBe('npm')
    })
  })

  it('picks npm when the marker is present but the probe exits non-zero', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1 })
    withRootDir(true, (rootDir) => {
      expect(detectPackageManager(rootDir)).toBe('npm')
    })
  })
})
