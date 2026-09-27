import { resolveDevSlot } from './resolve'

// `pnpm dev:slot` — claims this worktree's slot when AVENTURAS_DEV_SLOT=auto, then reports it.
// Worker setup hooks run it so the env file exists before an agent's shell starts.
const devSlot = resolveDevSlot()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(devSlot, null, 2))
} else {
  const { slot, ports, dataDir, android } = devSlot
  console.log(`dev slot ${slot}${slot === 0 ? ' (default)' : ''}`)
  console.log(`  metro      http://localhost:${ports.metro}`)
  console.log(`  devtools   http://localhost:${ports.devtools}`)
  console.log(`  storybook  http://localhost:${ports.storybook}`)
  console.log(`  mock LLM   http://localhost:${ports.mock}/v1`)
  console.log(`  userData   ${dataDir}`)
  if (android) console.log(`  android    AVD ${android.avd}, serial ${android.serial}`)
}
