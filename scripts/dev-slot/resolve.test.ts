import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ENV_FILE, resolveDevSlot } from './resolve'

let root: string
let home: string
let main: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'pipe',
  })

const addWorktree = (name: string) => {
  git(main, 'worktree', 'add', '-q', '--detach', join(root, name))
  return join(root, name)
}

const auto = (cwd: string) => resolveDevSlot({ env: { AVENTURAS_DEV_SLOT: 'auto' }, cwd, home })

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dev-slot-resolve-')))
  home = join(root, 'home')
  main = join(root, 'main')
  mkdirSync(main)
  git(main, 'init', '-q')
  // As in the repo's .gitignore; an untracked env file would make `git worktree remove` refuse.
  writeFileSync(join(main, '.gitignore'), '.env*.local\n')
  git(main, 'add', '.gitignore')
  git(main, 'commit', '-q', '-m', 'init')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveDevSlot', () => {
  it('stays on slot 0 without touching the repo when slots are off', () => {
    const slot = resolveDevSlot({ env: {}, cwd: main, home })
    expect(slot.slot).toBe(0)
    expect(slot.dataDir).toBe(join(home, '.config', 'aventuras-dev'))
    expect(existsSync(join(main, '.git', 'aventuras-dev-slots'))).toBe(false)
    expect(existsSync(join(main, ENV_FILE))).toBe(false)
  })

  it('pins a fixed slot without claiming', () => {
    expect(resolveDevSlot({ env: { AVENTURAS_DEV_SLOT: '3' }, cwd: main, home }).slot).toBe(3)
    expect(existsSync(join(main, '.git', 'aventuras-dev-slots'))).toBe(false)
  })

  it('writes a pinned slot’s env file over one an earlier claim left', () => {
    const wt = addWorktree('wt1')
    auto(wt)
    resolveDevSlot({ env: { AVENTURAS_DEV_SLOT: '3' }, cwd: wt, home })
    const env = readFileSync(join(wt, ENV_FILE), 'utf8')
    expect(env).toContain('export AVENTURAS_DEVTOOLS_PORT=9233\n')
    expect(env).toContain('export ANDROID_SERIAL=emulator-5558\n')
  })

  it('pins a slot outside any checkout, with no env file to write', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    expect(resolveDevSlot({ env: { AVENTURAS_DEV_SLOT: '3' }, cwd: outside, home }).slot).toBe(3)
    expect(existsSync(join(outside, ENV_FILE))).toBe(false)
  })

  it('keeps and wipes slot data where Electron keeps it', () => {
    const xdg = join(root, 'xdg')
    const env = { AVENTURAS_DEV_SLOT: 'auto', XDG_CONFIG_HOME: xdg }
    const gone = addWorktree('gone')
    expect(resolveDevSlot({ env, cwd: gone, home }).dataDir).toBe(join(xdg, 'aventuras-dev-slot1'))
    mkdirSync(join(xdg, 'aventuras-dev-slot1'), { recursive: true })
    rmSync(gone, { recursive: true, force: true })

    resolveDevSlot({ env, cwd: addWorktree('next'), home })
    expect(existsSync(join(xdg, 'aventuras-dev-slot1'))).toBe(false)
  })

  it('gives each worktree its own sticky slot, from any directory inside it', () => {
    const wt1 = addWorktree('wt1')
    const wt2 = addWorktree('wt2')
    mkdirSync(join(wt2, 'sub'))
    expect(auto(wt1).slot).toBe(1)
    expect(auto(join(wt2, 'sub')).slot).toBe(2)
    expect(auto(wt1).slot).toBe(1)
    expect(auto(wt2).slot).toBe(2)
  })

  it('keeps the main checkout on slot 0 without claiming', () => {
    expect(auto(main).slot).toBe(0)
    expect(auto(addWorktree('wt1')).slot).toBe(1)
    const env = readFileSync(join(main, ENV_FILE), 'utf8')
    expect(env).toContain('export AVENTURAS_DEVTOOLS_PORT=9222\n')
    expect(env).not.toContain('ANDROID_SERIAL')
  })

  it('frees a slot the main checkout claimed before it kept to slot 0', () => {
    const registry = join(main, '.git', 'aventuras-dev-slots')
    mkdirSync(registry)
    writeFileSync(join(registry, '1'), main)
    const stale = join(home, '.config', 'aventuras-dev-slot1')
    mkdirSync(stale, { recursive: true })

    expect(auto(addWorktree('wt1')).slot).toBe(1)
    expect(existsSync(stale)).toBe(false)
  })

  it('writes the env file tools that cannot resolve a slot read', () => {
    auto(addWorktree('wt1'))
    const wt = addWorktree('wt2')
    auto(wt)
    const env = readFileSync(join(wt, ENV_FILE), 'utf8')
    expect(env).toContain('export AVENTURAS_DEVTOOLS_PORT=9232\n')
    expect(env).toContain('export AVENTURAS_STORYBOOK_PORT=6008\n')
    expect(env).toContain('export ANDROID_SERIAL=emulator-5556\n')
    expect(env).not.toContain('AVENTURAS_DEV_SLOT')
  })

  it('hands a removed worktree’s slot on with its data wiped', () => {
    const gone = addWorktree('gone')
    expect(auto(gone).slot).toBe(1)
    const stale = join(home, '.config', 'aventuras-dev-slot1')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'aventuras.db'), 'from the old branch')
    git(main, 'worktree', 'remove', gone)

    const next = addWorktree('next')
    expect(auto(next).slot).toBe(1)
    expect(existsSync(stale)).toBe(false)
  })

  it('treats a worktree deleted without git as gone', () => {
    const gone = addWorktree('gone')
    auto(gone)
    rmSync(gone, { recursive: true, force: true })
    expect(auto(addWorktree('next')).slot).toBe(1)
  })
})
