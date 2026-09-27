import { spawn } from 'node:child_process'

import { resolveDevSlot } from './resolve'

// `tsx scripts/dev-slot/exec.ts <command> [args]` runs the command with {metro}, {storybook},
// {mock} and {devtools} replaced by this checkout's slot ports.
const [command, ...args] = process.argv.slice(2)
if (!command) {
  throw new Error('usage: exec.ts <command> [args with {metro|storybook|mock|devtools}]')
}

const { ports } = resolveDevSlot()
const fill = (arg: string) =>
  arg.replace(/\{(metro|storybook|mock|devtools)\}/g, (_, key: keyof typeof ports) =>
    String(ports[key]),
  )

const child = spawn(command, args.map(fill), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
// Ctrl+C reaches the child through the terminal; stay alive until it has exited.
process.on('SIGINT', () => {})
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
