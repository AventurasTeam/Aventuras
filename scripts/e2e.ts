import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwright launcher that keeps Electron off the developer's screen. Electron
// has no working headless mode on Linux (`--ozone-platform=headless` segfaults
// in the GLX stack), so a real X server is the only option; Xvfb makes it a
// virtual one. Same wrapper in CI and locally so the two run the same command.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url).href)
const PLAYWRIGHT_CLI = join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js')

// Arch's xvfb-run defaults to `-screen 0 640x480x24`, which clips the 1280x800
// BrowserWindow and drops the renderer below the 1024px desktop breakpoint —
// the suite would silently exercise the narrow layout. Pin it explicitly rather
// than inherit whatever the distro's wrapper chose.
const XVFB_SERVER_ARGS = '-screen 0 1920x1080x24'

function onPath(bin: string): boolean {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => {
      try {
        accessSync(join(dir, bin), constants.X_OK)
        return true
      } catch {
        return false
      }
    })
}

// Flags whose whole purpose is a window a human looks at — routing them to a
// virtual display would hide the inspector they just asked for.
const INTERACTIVE_FLAGS = ['--ui', '--debug', '--headed']

const forwarded = process.argv.slice(2)
const headed =
  process.env.E2E_HEADED === '1' ||
  process.env.PWDEBUG === '1' ||
  forwarded.some((arg) =>
    INTERACTIVE_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
  )
const virtualDisplay = process.platform === 'linux' && !headed && onPath('xvfb-run')

if (!existsSync(PLAYWRIGHT_CLI)) {
  console.error(`[e2e] Playwright CLI not found at ${PLAYWRIGHT_CLI}. Run pnpm install.`)
  process.exit(1)
}

if (process.platform === 'linux' && !headed && !virtualDisplay) {
  console.warn(
    '[e2e] xvfb-run not found — Electron will open real windows and take focus.\n' +
      '[e2e] Install it (Arch: sudo pacman -S xorg-server-xvfb, Debian/Ubuntu: apt install xvfb),\n' +
      '[e2e] or set E2E_HEADED=1 to opt out of the virtual display deliberately.',
  )
}

const playwright = [process.execPath, PLAYWRIGHT_CLI, 'test', ...forwarded]
const [command, ...args] = virtualDisplay
  ? ['xvfb-run', '-a', '-s', XVFB_SERVER_ARGS, ...playwright]
  : playwright

// Xvfb only sets DISPLAY, which Electron ignores on a Wayland session: it
// connects to the compositor instead, so the window opens on the real screen
// while the virtual server sits empty. Pinning the X11 ozone backend is what
// actually lands the window on Xvfb, and only the command-line switch does it
// (ELECTRON_OZONE_PLATFORM_HINT has no effect, and clearing WAYLAND_DISPLAY
// does not help — Wayland clients fall back to the default wayland-0 socket).
// e2e/harness/launch.ts owns electron.launch, so it reads this and adds the
// switch; the wrapper is inert without that half.
const childEnv = { ...process.env }
if (virtualDisplay) childEnv.E2E_VIRTUAL_DISPLAY = '1'

const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env: childEnv })

child.on('error', (err) => {
  console.error(`[e2e] failed to start ${command}: ${err.message}`)
  process.exit(1)
})

// Signal-terminated runs report no exit code; surface them as a failure rather
// than the `?? 0` that would read a Ctrl-C as a green suite.
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1))
})
