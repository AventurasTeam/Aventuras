import { spawn, execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwright launcher that keeps Electron off the developer's screen. Electron
// has no working headless mode on Linux (`--ozone-platform=headless` segfaults
// in the GLX stack), so a real X server is the only option; Xvfb makes it a
// virtual one, started per launch by e2e/harness/display.ts. Same wrapper in CI
// and locally so the two run the same command.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url).href)
const PLAYWRIGHT_CLI = join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js')

// Both projects launch Electron against build output, never the sources: `dev`
// serves the static `dist/` bundle, `packaged` the electron-builder binary. A
// stale build therefore exercises old code and the suite still passes — the
// dangerous direction is a green run that "verifies" a fix which was never in
// the bundle. Compare mtimes and refuse to run rather than report a false pass.
// Inputs are per-output: the Expo bundle is built from the app sources, the
// Electron main from `electron/` alone, so a lib/ edit must not be read as
// staleness in electron/dist.
// Root config and the lockfile count as inputs too: a babel/metro/tailwind edit
// or a dependency bump changes the bundle without touching a single source file,
// and that is exactly the kind of staleness a source-only check would mask.
const ROOT_BUILD_INPUTS = [
  'package.json',
  'pnpm-lock.yaml',
  'app.json',
  'babel.config.js',
  'metro.config.js',
  'postcss.config.js',
  'tailwind.config.js',
  'tsconfig.json',
  'global.css',
  'patches',
]

const BUILD_OUTPUTS = [
  {
    out: join(REPO_ROOT, 'dist'),
    inputs: [
      'app',
      'components',
      'hooks',
      'lib',
      'constants',
      'types',
      'assets',
      // Bundled, not read at runtime: lib/i18n imports the JSON directly, so a
      // copy-only edit changes the bundle while touching no source directory
      // above — the one input class that could go stale reading as fresh.
      'locales',
      ...ROOT_BUILD_INPUTS,
    ],
    rebuild: 'pnpm build:web',
  },
  {
    out: join(REPO_ROOT, 'electron', 'dist'),
    inputs: ['electron', 'package.json', 'pnpm-lock.yaml'],
    rebuild: 'pnpm electron:compile',
  },
]

// git ls-files keeps this to tracked sources — no node_modules walk, and no
// generated file dragging the timestamp forward on every run.
function newestTrackedMtime(inputs: string[]): number {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', ...inputs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
  let newest = 0
  for (const rel of tracked) {
    try {
      const { mtimeMs } = statSync(join(REPO_ROOT, rel))
      if (mtimeMs > newest) newest = mtimeMs
    } catch {
      // Deleted since `git ls-files` listed it — irrelevant to build freshness.
    }
  }
  return newest
}

// The newest file in the tree, not the directory's own mtime: tsc rewrites only
// what changed and never touches the directory, so a dir mtime reads as stale
// after any no-op compile.
function newestOutputMtime(dir: string): number {
  let newest = 0
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        try {
          const { mtimeMs } = statSync(full)
          if (mtimeMs > newest) newest = mtimeMs
        } catch {
          /* raced with a rebuild; ignore */
        }
      }
    }
  }
  walk(dir)
  return newest
}

function assertFreshBuild(): void {
  const stale: typeof BUILD_OUTPUTS = []
  for (const target of BUILD_OUTPUTS) {
    if (!existsSync(target.out)) {
      stale.push(target)
      continue
    }
    try {
      if (newestOutputMtime(target.out) < newestTrackedMtime(target.inputs)) stale.push(target)
    } catch {
      // No git, or an unreadable tree: never block the suite on the guard itself.
      return
    }
  }
  if (stale.length === 0) return
  console.error(
    `[e2e] Build output is older than the sources — the suite would test stale code.\n` +
      stale.map((target) => `[e2e]   ${target.out} → ${target.rebuild}`).join('\n') +
      `\n[e2e] Run the command(s) above, or set E2E_SKIP_BUILD_CHECK=1 to override.`,
  )
  process.exit(1)
}

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
const virtualDisplay = process.platform === 'linux' && !headed && onPath('Xvfb')

if (!existsSync(PLAYWRIGHT_CLI)) {
  console.error(`[e2e] Playwright CLI not found at ${PLAYWRIGHT_CLI}. Run pnpm install.`)
  process.exit(1)
}

if (process.env.E2E_SKIP_BUILD_CHECK !== '1') assertFreshBuild()

if (process.platform === 'linux' && !headed && !virtualDisplay) {
  console.warn(
    '[e2e] Xvfb not found — Electron will open real windows and take focus.\n' +
      '[e2e] Install it (Arch: sudo pacman -S xorg-server-xvfb, Debian/Ubuntu: apt install xvfb),\n' +
      '[e2e] or set E2E_HEADED=1 to opt out of the virtual display deliberately.',
  )
}

// The flag makes the harness start an Xvfb per launch and pass --ozone-platform=x11: on Wayland,
// Electron ignores DISPLAY and opens on the real screen. ELECTRON_OZONE_PLATFORM_HINT has no
// effect, and clearing WAYLAND_DISPLAY falls back to the default wayland-0 socket.
const childEnv = { ...process.env }
if (virtualDisplay) childEnv.E2E_VIRTUAL_DISPLAY = '1'

const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', ...forwarded], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: childEnv,
})

child.on('error', (err) => {
  console.error(`[e2e] failed to start Playwright: ${err.message}`)
  process.exit(1)
})

// Signal-terminated runs report no exit code; surface them as a failure rather
// than the `?? 0` that would read a Ctrl-C as a green suite.
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1))
})
