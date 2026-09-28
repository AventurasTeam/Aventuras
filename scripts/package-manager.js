/**
 * `aube` when it did the install, `npm` otherwise. The install is the tell, not just aube
 * being on PATH — a teammate who has aube for other projects but ran `npm ci` here must stay
 * on npm, since aube would otherwise reinstall their `node_modules` out from under them.
 */

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

/** `aube` iff it did the install (marker present) and it is still on PATH. Otherwise `npm`. */
export function pickPackageManager({ aubeOnPath, aubeInstalled }) {
  return aubeOnPath && aubeInstalled ? 'aube' : 'npm'
}

/**
 * `aubeInstalled` is read from disk; `aubeOnPath` is only probed when that marker is present,
 * since there is nothing to fall back from otherwise.
 */
export function detectPackageManager(rootDir = process.cwd()) {
  const aubeInstalled = fs.existsSync(path.join(rootDir, 'node_modules', '.aube-state'))
  const probe = aubeInstalled && spawnSync('aube', ['--version'], { stdio: 'ignore' })
  const aubeOnPath = Boolean(probe && !probe.error && probe.status === 0)

  return pickPackageManager({ aubeOnPath, aubeInstalled })
}

/**
 * `[cmd, cmdArgs]` for `spawnSync`/`execFileSync`. npm's Windows binary is `npm.cmd`, which
 * `execFile`/`spawn` cannot launch directly, so it goes through `cmd.exe` rather than
 * `shell: true` (Node deprecated that combination, DEP0190). aube is a real executable on
 * every platform, including mise's shims on Windows, so it needs none of that.
 */
export function commandFor(pm, args, platform = process.platform) {
  if (pm === 'npm' && platform === 'win32') return ['cmd.exe', ['/c', 'npm', ...args]]
  return [pm, args]
}
