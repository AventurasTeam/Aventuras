import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  it.each([
    ['npm', 'win32', ['cmd.exe', ['/c', 'npm', 'run', 'lint']]],
    ['npm', 'linux', ['npm', ['run', 'lint']]],
    ['aube', 'win32', ['cmd.exe', ['/c', 'aube', 'run', 'lint']]],
    ['aube', 'linux', ['aube', ['run', 'lint']]],
  ])('builds the command for %s on %s', (pm, platform, expected) => {
    expect(commandFor(pm, ['run', 'lint'], platform)).toEqual(expected)
  })

  it.each([
    ['win32', ['cmd.exe', ['/c', 'npm', 'run', 'lint']]],
    ['linux', ['npm', ['run', 'lint']]],
  ])('defaults the platform to process.platform (%s)', (platform, expected) => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    try {
      expect(commandFor('npm', ['run', 'lint'])).toEqual(expected)
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })
})

describe('detectPackageManager', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset()
  })

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

  it.each([
    ['aube', { status: 0 }],
    ['npm', { error: new Error('ENOENT') }],
    ['npm', { status: 1 }],
  ])('picks %s when the marker is present and the probe returns %o', (expected, probeResult) => {
    vi.mocked(spawnSync).mockReturnValue(probeResult)
    withRootDir(true, (rootDir) => {
      expect(detectPackageManager(rootDir)).toBe(expected)
    })
  })

  it('probes aube through commandFor', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 })
    withRootDir(true, (rootDir) => {
      detectPackageManager(rootDir)
      expect(spawnSync).toHaveBeenCalledWith(
        ...commandFor('aube', ['--version']),
        expect.anything(),
      )
    })
  })
})
