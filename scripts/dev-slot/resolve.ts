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

function describe(slot: number, home: string): DevSlot {
  return {
    slot,
    ports: slotPorts(slot),
    dataDir: slotDataDir(slot, home),
    android: slotAndroid(slot),
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

function claimForWorktree(cwd: string, home: string): number {
  const worktree = realpathSync(git(cwd, 'rev-parse', '--show-toplevel'))
  const commonDir = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const live = liveWorktrees(cwd)
  const slot = claimSlot({
    dir: join(commonDir, 'aventuras-dev-slots'),
    worktree,
    isLive: (path) => live.has(path),
    // A slot changing hands keeps nothing from the last branch: its DB may carry migrations
    // this one has never heard of.
    onFreshClaim: (fresh) => rmSync(slotDataDir(fresh, home), { recursive: true, force: true }),
  })
  writeEnvFile(worktree, describe(slot, home))
  return slot
}

/**
 * This checkout's dev slot, from `AVENTURAS_DEV_SLOT`. Off (the default) is slot 0, the ports and
 * userData the tooling always used; `auto` claims a sticky slot per worktree. See
 * docs/dev-environment.md.
 */
export function resolveDevSlot(
  opts: { env?: { AVENTURAS_DEV_SLOT?: string }; cwd?: string; home?: string } = {},
): DevSlot {
  const { env = process.env, cwd = process.cwd(), home = homedir() } = opts
  const setting = parseSlotSetting(env.AVENTURAS_DEV_SLOT)
  if (setting.kind === 'off') return describe(0, home)
  if (setting.kind === 'fixed') return describe(setting.slot, home)
  return describe(claimForWorktree(cwd, home), home)
}
