import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { claimSlot } from './registry'
import {
  parseSlotSetting,
  slotAndroid,
  slotDataDir,
  slotPorts,
  type AndroidSlot,
  type DataDirEnv,
  type DataDirOptions,
  type SlotPorts,
} from './slot'

/** Per-worktree env for tools that read ports from the environment (MCP config, adb). */
export const ENV_FILE = '.env.dev-slot.local'

export type DevSlot = {
  slot: number
  ports: SlotPorts
  /** Electron userData; also where `pnpm db:seed` writes. */
  dataDir: string
  android: AndroidSlot | null
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function liveWorktrees(cwd: string): Set<string> {
  const live = new Set<string>()
  for (const block of git(cwd, 'worktree', 'list', '--porcelain').split('\n\n')) {
    const lines = block.split('\n')
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (path && !lines.some((line) => line.startsWith('prunable')) && existsSync(path)) {
      live.add(realpathSync(path))
    }
  }
  return live
}

function describe(slot: number, paths: DataDirOptions): DevSlot {
  return {
    slot,
    ports: slotPorts(slot),
    dataDir: slotDataDir(slot, paths),
    android: slotAndroid(slot),
  }
}

/** The checkout's root, or undefined outside a git work tree. */
function worktreeRoot(cwd: string): string | undefined {
  try {
    return realpathSync(git(cwd, 'rev-parse', '--show-toplevel'))
  } catch {
    return undefined
  }
}

function writeEnvFile(worktree: string, { ports, android }: DevSlot): void {
  const lines = [
    '# Written by scripts/dev-slot for this worktree; worker shells source it.',
    `export AVENTURAS_DEVTOOLS_PORT=${ports.devtools}`,
    `export AVENTURAS_STORYBOOK_PORT=${ports.storybook}`,
    ...(android ? [`export ANDROID_SERIAL=${android.serial}`] : []),
  ]
  const content = lines.join('\n') + '\n'
  const file = join(worktree, ENV_FILE)
  if (!existsSync(file) || readFileSync(file, 'utf8') !== content) writeFileSync(file, content)
}

function claimForWorktree(cwd: string, paths: DataDirOptions): number {
  const worktree = realpathSync(git(cwd, 'rev-parse', '--show-toplevel'))
  const commonDir = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const live = liveWorktrees(cwd)
  const slot = claimSlot({
    dir: join(commonDir, 'aventuras-dev-slots'),
    worktree,
    isLive: (path) => live.has(path),
    // A slot changing hands keeps nothing from the last branch: its DB may carry migrations
    // this one has never heard of.
    onFreshClaim: (fresh) => rmSync(slotDataDir(fresh, paths), { recursive: true, force: true }),
  })
  writeEnvFile(worktree, describe(slot, paths))
  return slot
}

/**
 * This checkout's dev slot, from `AVENTURAS_DEV_SLOT`. Off (the default) is slot 0, the ports and
 * userData the tooling always used; `auto` claims a sticky slot per worktree. See
 * docs/dev-environment.md.
 */
export function resolveDevSlot(
  opts: { env?: { AVENTURAS_DEV_SLOT?: string } & DataDirEnv; cwd?: string; home?: string } = {},
): DevSlot {
  const { env = process.env, cwd = process.cwd(), home = homedir() } = opts
  const paths = { home, env }
  const setting = parseSlotSetting(env.AVENTURAS_DEV_SLOT)
  if (setting.kind === 'off') return describe(0, paths)
  if (setting.kind === 'fixed') {
    const fixed = describe(setting.slot, paths)
    // Replaces what an earlier `auto` claim wrote, so env-reading tools follow the pinned slot.
    const worktree = worktreeRoot(cwd)
    if (worktree) writeEnvFile(worktree, fixed)
    return fixed
  }
  return describe(claimForWorktree(cwd, paths), paths)
}
