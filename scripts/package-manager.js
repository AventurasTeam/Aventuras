/**
 * `aube` when it did the install and is still on PATH, `npm` otherwise. The install is the
 * tell, not just aube being on PATH — a teammate who has aube for other projects but ran
 * `npm ci` here must stay on npm, since aube would otherwise reinstall their `node_modules`
 * out from under them.
 */

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

export function detectPackageManager(rootDir = process.cwd()) {
  if (!fs.existsSync(path.join(rootDir, 'node_modules', '.aube-state'))) return 'npm'
  const probe = spawnSync(...commandFor('aube', ['--version']), { stdio: 'ignore' })
  return !probe.error && probe.status === 0 ? 'aube' : 'npm'
}

/**
 * `[cmd, cmdArgs]` for `spawnSync`/`execFileSync`. On Windows both npm and aube can be
 * `.cmd`/`.ps1` shims rather than a real executable — npm always is; aube is too when npm
 * installed it globally, as opposed to mise's `.exe` shims. `execFile`/`spawn` cannot launch
 * a `.cmd` directly, so both go through `cmd.exe` rather than `shell: true` (Node deprecated
 * that combination, DEP0190).
 */
export function commandFor(pm, args, platform = process.platform) {
  if (platform === 'win32') return ['cmd.exe', ['/c', pm, ...args]]
  return [pm, args]
}
