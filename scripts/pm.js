/**
 * Usage: node scripts/pm.js <args...> — same arg syntax as npm or aube directly, e.g.
 * `run dev` or `run lint -- --fix`.
 */

import { spawnSync } from 'child_process'
import { detectPackageManager, commandFor } from './package-manager.js'

const [cmd, cmdArgs] = commandFor(detectPackageManager(), process.argv.slice(2))
const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' })

if (result.error) throw result.error
process.exit(result.signal ? 1 : result.status)
