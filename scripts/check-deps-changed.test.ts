import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = fileURLToPath(new URL('./check-deps-changed.sh', import.meta.url).href)
const NULL_ID = '0'.repeat(40)
const WARNING = 'run `pnpm install`'

let dir: string

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()

function commit(path: string, content: string): string {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), content)
  git('add', path)
  git('commit', '-q', '--no-verify', '-m', `change ${path}`)
  return git('rev-parse', 'HEAD')
}

function run(...args: string[]) {
  const result = spawnSync('sh', [HOOK, ...args], { cwd: dir, encoding: 'utf8' })
  return { status: result.status, output: result.stdout + result.stderr }
}

const WARNS = { status: 0, output: expect.stringContaining(WARNING) }
const QUIET = { status: 0, output: '' }

let base: string
let lockfile: string
let unrelated: string
let patch: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-deps-changed-'))
  git('init', '-q')
  git('config', 'user.email', 'test@example.test')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  base = commit('pnpm-lock.yaml', 'lockfileVersion: 9.0\n')
  lockfile = commit('pnpm-lock.yaml', 'lockfileVersion: 9.0\nchanged: true\n')
  unrelated = commit('src/app.ts', 'export {}\n')
  patch = commit('patches/expo.patch', 'diff --git a/x b/x\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('check-deps-changed.sh', () => {
  it('warns on a branch checkout across a lockfile change, and never fails', () => {
    expect(run('post-checkout', base, lockfile, '1')).toEqual(WARNS)
  })

  it('warns on a branch checkout across a patch change', () => {
    expect(run('post-checkout', unrelated, patch, '1')).toEqual(WARNS)
  })

  it('stays quiet when neither the lockfile nor a patch changed', () => {
    expect(run('post-checkout', lockfile, unrelated, '1')).toEqual(QUIET)
  })

  it('stays quiet for a file checkout, or a new worktree from the null id', () => {
    expect(run('post-checkout', base, lockfile, '0')).toEqual(QUIET)
    expect(run('post-checkout', NULL_ID, lockfile, '1')).toEqual(QUIET)
  })

  it('compares a merge or a rebase against ORIG_HEAD', () => {
    git('update-ref', 'ORIG_HEAD', unrelated)
    expect(run('post-merge', '0')).toEqual(WARNS)
    expect(run('post-rewrite', 'rebase')).toEqual(WARNS)
    expect(run('post-rewrite', 'amend')).toEqual(QUIET)

    git('update-ref', 'ORIG_HEAD', patch)
    expect(run('post-merge', '0')).toEqual(QUIET)
  })
})
