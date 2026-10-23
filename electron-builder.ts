import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join } from 'node:path'

// electron-builder packs every production dependency, but only Electron main
// loads packages at runtime (the renderer is the Metro bundle in dist/), so
// everything outside main's dependency closure is excluded, as are the android/
// and ios/ trees a local Android build fills with gigabytes of Gradle output.
// Exclusion has to be `files` negations, matched against the packaged
// node_modules/<pkg>/ layout: in 26.8 `onNodeModuleFile` can only force-include.

const ROOT = __dirname
const ELECTRON_DIST = join(ROOT, 'electron', 'dist')

// electron-builder's macro for a directory and everything under it. A plain
// `dir/**` skips the directory itself, so the walker still descends into it.
const SUBTREE = '${/*}'

// Packages compiled main code loads. tsc's node16 output keeps both forms
// greppable: require("x") for static imports, import('x') for ESM-only ones.
function mainRuntimePackages(): string[] {
  if (!existsSync(ELECTRON_DIST)) {
    throw new Error('electron-builder: electron/dist is missing; run `pnpm electron:compile` first')
  }
  const builtins = new Set(builtinModules)
  const names = new Set<string>()
  for (const file of readdirSync(ELECTRON_DIST, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    const source = readFileSync(join(ELECTRON_DIST, file), 'utf8')
    for (const [, , specifier] of source.matchAll(
      /\b(?:require|import)\((['"])([^'".][^'"]*)\1\)/g,
    )) {
      if (specifier === 'electron' || specifier.startsWith('node:') || builtins.has(specifier)) {
        continue
      }
      const parts = specifier.split('/')
      names.add(specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0])
    }
  }
  // An empty scan means the emit format changed, not that main has no deps;
  // packing with an empty allowlist would ship an app that can't boot.
  if (names.size === 0) {
    throw new Error('electron-builder: found no package requires in electron/dist')
  }
  return [...names]
}

// Node's resolution walk: the nearest node_modules/<name> from `fromDir` up.
function findPackageDir(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(dir) === dir) return null
  }
}

// Package names reachable from `roots` through dependencies and installed
// optionalDependencies (platform binaries like @img/sharp-linux-x64).
// Peer dependencies are left out: drizzle-orm alone lists expo-sqlite and
// every other driver as optional peers.
function dependencyClosure(roots: string[]): Set<string> {
  const keep = new Set<string>()
  const visited = new Set<string>()
  const queue = roots.map((name) => ({ name, from: ROOT, optional: false }))
  for (let next = queue.pop(); next != null; next = queue.pop()) {
    const dir = findPackageDir(next.name, next.from)
    if (dir == null) {
      if (next.optional) continue
      throw new Error(`electron-builder: cannot resolve ${next.name} from ${next.from}`)
    }
    keep.add(next.name)
    if (visited.has(dir)) continue
    visited.add(dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name, from: dir, optional: false })
    }
    for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
      queue.push({ name, from: dir, optional: true })
    }
  }
  return keep
}

function excludeAllPackagesBut(keep: Set<string>): string[] {
  const topLevel = new Set<string>()
  const scoped = new Map<string, string[]>()
  for (const name of [...keep].sort()) {
    const [first, second] = name.split('/')
    topLevel.add(first)
    if (second != null) scoped.set(first, [...(scoped.get(first) ?? []), second])
  }
  return [
    `!**/node_modules/!(${[...topLevel].join('|')})${SUBTREE}`,
    ...[...scoped].map(
      ([scope, names]) => `!**/node_modules/${scope}/!(${names.join('|')})${SUBTREE}`,
    ),
  ]
}

// onnxruntime-node ships binaries for every platform and arch. The platform is
// literal per target because the `${platform}` macro expands to the build
// host's process.platform; `${arch}` does follow the target.
function onnxruntimeNodeBinariesFor(platform: 'linux' | 'darwin' | 'win32'): string[] {
  const bin = '**/node_modules/onnxruntime-node/bin/napi-v3'
  return [`!${bin}/!(${platform})${SUBTREE}`, `!${bin}/${platform}/!(\${arch})${SUBTREE}`]
}

const sharedFiles = [
  'electron/dist/**/*',
  'dist/**/*',
  'package.json',
  `!**/node_modules/*/{android,ios}${SUBTREE}`,
  `!**/node_modules/@*/*/{android,ios}${SUBTREE}`,
  ...excludeAllPackagesBut(dependencyClosure(mainRuntimePackages())),
]

// The whole list is repeated per platform rather than split into a root
// `files` plus platform additions: electron-builder turns a root `files` into a
// separate matcher, and a platform list of only exclusions then gets `**/*`
// prepended, which packs the entire repo.
function filesFor(platform: 'linux' | 'darwin' | 'win32'): string[] {
  return [...sharedFiles, ...onnxruntimeNodeBinariesFor(platform)]
}

// Untyped on purpose: importing electron-builder's Configuration drags its type
// graph into the app's tsconfig program and flips global overloads (setTimeout
// starts returning Timeout). electron-builder schema-validates this at load.
const config = {
  appId: 'com.aventuras.app',
  productName: 'Aventuras',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  asarUnpack: [
    '**/node_modules/sqlite-vec-*/**',
    '**/node_modules/onnxruntime-node/**',
    '**/node_modules/sharp/**',
    '**/node_modules/@img/**',
  ],
  extraResources: [
    {
      from: 'lib/db/migrations',
      to: 'migrations',
    },
  ],
  extraMetadata: {
    main: 'electron/dist/main.js',
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Utility',
    files: filesFor('linux'),
  },
  mac: {
    target: 'dmg',
    category: 'public.app-category.utilities',
    files: filesFor('darwin'),
  },
  win: {
    target: 'nsis',
    files: filesFor('win32'),
  },
}

export default config
