/**
 * Cut a release: bump every file that carries the version, tag it, push it, and bring the
 * bump back onto the branch the release was cut from.
 *
 * Usage:
 *   npm run release -- <major|minor|patch|prerelease|X.Y.Z> [--dry-run] [--no-merge-back]
 *
 * Note the `--`: without it npm eats the flags before the script sees them.
 *
 * Every precondition, including the ones that need the network, is checked before anything
 * is written; a failure after that point deletes the branch and tag it created and returns
 * to the branch it started on.
 */

import fs from 'fs'
import { execFileSync } from 'child_process'
import path from 'path'
import { bumpVersion, isValidVersion, compareVersions } from './version.js'
import { pickReleaseRemote } from './remote.js'

const rootDir = process.cwd()

const KNOWN_FLAGS = ['--dry-run', '--no-merge-back']

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('-')))
const positionals = args.filter((a) => !a.startsWith('-'))
const unknownArgs = [
  ...[...flags].filter((f) => !KNOWN_FLAGS.includes(f)),
  // A second bump type is a typo, not a request. Ignoring it releases the wrong version.
  ...positionals.slice(1),
]
const inputArg = positionals[0]
const dryRun = flags.has('--dry-run')
const mergeBack = !flags.has('--no-merge-back')

/** Run a command without a shell, so no argument can be interpolated into one. */
function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', ...opts })
}

function git(...gitArgs) {
  return run('git', gitArgs).trim()
}

/**
 * Run npm. On Windows it is `npm.cmd`, which `execFile` cannot launch, so it goes through
 * `cmd.exe`. Not `shell: true`: Node deprecated that for this case (DEP0190).
 */
function npm(npmArgs, opts = {}) {
  return process.platform === 'win32'
    ? run('cmd.exe', ['/c', 'npm', ...npmArgs], opts)
    : run('npm', npmArgs, opts)
}

/**
 * A git command whose failure is an answer, not an error. stderr is piped because most of
 * these ask "does this ref exist?", which git answers with `fatal: ...` on the way to no.
 */
function tryGit(...gitArgs) {
  try {
    return { ok: true, out: run('git', gitArgs, { stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (error) {
    return { ok: false, error }
  }
}

function fail(message, hint) {
  console.error(`\n✗ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

/**
 * Where the release is pushed. A configured remote pointing at the release repository when
 * there is one, so the push uses the transport and credentials that remote already has --
 * otherwise the canonical HTTPS URL. See `remote.js` for why this is not simply `origin`,
 * and not a hardcoded URL either.
 */
const { ref: REMOTE, label: REMOTE_LABEL } = pickReleaseRemote(tryGit('remote', '-v').out)

// ---------------------------------------------------------------------------
// Pre-flight. Nothing below this block writes anything.
// ---------------------------------------------------------------------------

// Rejected rather than ignored: both flags are safety flags, so a typo in `--dry-run`
// runs a real release against a repository the author believed was untouched.
if (unknownArgs.length > 0) {
  fail(
    `Unrecognised argument${unknownArgs.length > 1 ? 's' : ''}: ${unknownArgs.join(', ')}`,
    `Usage: npm run release -- <major|minor|patch|prerelease|X.Y.Z> [${KNOWN_FLAGS.join('] [')}]`,
  )
}

const pkgPath = path.join(rootDir, 'package.json')
const currentVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version

if (!inputArg) {
  fail(
    'No version or bump type given.',
    'Usage: npm run release -- <major|minor|patch|prerelease|X.Y.Z> [--dry-run]',
  )
}

if (!isValidVersion(currentVersion)) {
  fail(
    `package.json holds "${currentVersion}", which is not a version this project releases.`,
    'Expected X.Y.Z or X.Y.Z-pre.N.',
  )
}

const newVersion = bumpVersion(currentVersion, inputArg)

if (!isValidVersion(newVersion)) {
  fail(
    `"${inputArg}" is not a bump type or a releasable version.`,
    'Use major, minor, patch, prerelease, or a literal X.Y.Z / X.Y.Z-pre.N. Other pre-release ' +
      'shapes are rejected because no workflow builds them: release.yml triggers on ' +
      'v[0-9]+.[0-9]+.[0-9]+ and ci.yml on v*-pre*.',
  )
}

if (compareVersions(newVersion, currentVersion) <= 0) {
  fail(
    `${newVersion} does not follow the current version ${currentVersion}.`,
    'A release must move the version forward.',
  )
}

const tag = `v${newVersion}`
const releaseBranch = `release/${tag}`

const status = git('status', '--porcelain')
if (status) {
  fail(
    'The working tree is not clean.',
    'Commit or stash your changes first — this script commits with `git add .`.',
  )
}

const startBranch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (startBranch === 'HEAD') {
  fail('HEAD is detached.', 'Check out the branch you want to release from.')
}

if (tryGit('rev-parse', '--verify', `refs/tags/${tag}`).ok) {
  fail(
    `Tag ${tag} already exists locally.`,
    `package.json is at ${currentVersion}, so this branch is behind the tags. Align it, or ` +
      'pass an explicit version.',
  )
}

if (tryGit('rev-parse', '--verify', `refs/heads/${releaseBranch}`).ok) {
  fail(
    `Branch ${releaseBranch} already exists locally.`,
    `Delete it: git branch -D ${releaseBranch}`,
  )
}

// The network checks are here, with the cheap ones, because the whole point is that
// nothing is written until every answer is in.
console.log(`Checking ${REMOTE_LABEL} for ${tag}...`)
const remoteRefs = tryGit('ls-remote', REMOTE, `refs/tags/${tag}`, `refs/heads/${releaseBranch}`)
if (!remoteRefs.ok) {
  fail(
    'Could not reach the release remote.',
    `${REMOTE_LABEL} — check the network and your credentials. If no configured remote ` +
      'points at the release repository, this falls back to an HTTPS URL, which GitHub no ' +
      'longer accepts a password for.',
  )
}
if (remoteRefs.out.includes(`refs/tags/${tag}`)) {
  fail(`Tag ${tag} already exists on the remote.`, 'That version has already been released.')
}
if (remoteRefs.out.includes(`refs/heads/${releaseBranch}`)) {
  fail(`Branch ${releaseBranch} already exists on the remote.`)
}

console.log(`\n${currentVersion} → ${newVersion}`)
console.log(`  branch:      ${releaseBranch}`)
console.log(`  tag:         ${tag}`)
console.log(`  remote:      ${REMOTE_LABEL}`)
console.log(`  merge back:  ${mergeBack ? startBranch : 'no (--no-merge-back)'}`)

if (dryRun) {
  console.log('\n--dry-run: every check passed, nothing was written.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// From here on the repository is being modified, and failure has to undo it.
// ---------------------------------------------------------------------------

const versionFiles = [
  { path: path.join(rootDir, 'src-tauri/tauri.conf.json'), type: 'json', key: 'version' },
  {
    path: path.join(rootDir, 'src-tauri/Cargo.toml'),
    type: 'toml',
    regex: /^version\s*=\s*"(.*)"/m,
    replace: `version = "${newVersion}"`,
  },
]

let branchCreated = false
let tagCreated = false

function rollback() {
  console.error('\nRolling back...')
  // `--force` discards whatever the failed run had written into the tree.
  const checkedOut = tryGit('checkout', '--force', startBranch).ok
  if (tagCreated) tryGit('tag', '-d', tag)
  if (branchCreated) tryGit('branch', '-D', releaseBranch)
  if (!checkedOut) console.error(`  could not check out ${startBranch}; left the tree as it is.`)
}

try {
  console.log(`\nCreating ${releaseBranch}...`)
  git('checkout', '-b', releaseBranch)
  branchCreated = true

  console.log('Updating package.json and package-lock.json...')
  npm(['version', newVersion, '--no-git-tag-version'], { stdio: 'inherit' })

  for (const file of versionFiles) {
    console.log(`Updating ${path.basename(file.path)}...`)
    let content = fs.readFileSync(file.path, 'utf8')

    if (file.type === 'json') {
      const json = JSON.parse(content)
      json[file.key] = newVersion
      content = JSON.stringify(json, null, 2) + '\n'
    } else {
      if (!file.regex.test(content)) {
        throw new Error(`No version line found in ${file.path} — the file's format has changed.`)
      }
      content = content.replace(file.regex, file.replace)
    }

    fs.writeFileSync(file.path, content)
  }

  console.log('Updating Cargo.lock...')
  run('cargo', ['update', '-p', 'aventura'], {
    cwd: path.join(rootDir, 'src-tauri'),
    stdio: 'inherit',
  })

  // Formatting runs over the whole repo, so it can sweep in files this release did not
  // touch. Deliberate, but never silent: anything beyond the version files is named below.
  console.log('Formatting and linting...')
  npm(['run', 'format'], { stdio: 'inherit' })
  npm(['run', 'lint:fix'], { stdio: 'inherit' })

  const expected = new Set([
    'package.json',
    'package-lock.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
  ])
  // `XY <path>`, or `XY <old> -> <new>` for a rename; a path with spaces comes back quoted.
  const touched = git('status', '--porcelain')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const path = line.slice(3).trim()
      const renamed = path.split(' -> ')
      return renamed[renamed.length - 1].replace(/^"|"$/g, '')
    })
  const collateral = touched.filter((f) => !expected.has(f))
  if (collateral.length > 0) {
    console.log(`\n  note: formatting also changed ${collateral.length} unrelated file(s):`)
    for (const f of collateral.slice(0, 10)) console.log(`    ${f}`)
    if (collateral.length > 10) console.log(`    ... and ${collateral.length - 10} more`)
    console.log('  They are included in the release commit.\n')
  }

  console.log('Committing...')
  git('add', '.')
  git('commit', '-m', `chore: bump version to ${newVersion}`)

  console.log(`Tagging ${tag}...`)
  git('tag', tag)
  tagCreated = true

  console.log(`Pushing ${releaseBranch} and ${tag}...`)
  git('push', '--atomic', REMOTE, releaseBranch, tag)
} catch (error) {
  console.error(`\n✗ Release failed: ${error.message}`)
  rollback()
  process.exit(1)
}

// ---------------------------------------------------------------------------
// The release is out. Everything past this point is best-effort.
// ---------------------------------------------------------------------------

console.log(`\n✓ Released ${tag}`)

if (!mergeBack) {
  console.log(
    `\n  ${startBranch} still holds ${currentVersion}; the bump is only on ${releaseBranch}.`,
  )
  process.exit(0)
}

// Not rolled back on failure: the tag is pushed and the release is building, so a
// protected branch or a race here is a reason to print two commands, not to unpick it.
try {
  console.log(`\nBringing the bump back onto ${startBranch}...`)
  git('checkout', startBranch)
  // `--ff-only`: anything else means someone moved `startBranch` meanwhile, and resolving
  // that is not this script's decision.
  git('merge', '--ff-only', releaseBranch)
  git('push', REMOTE, startBranch)
  console.log(`✓ ${startBranch} is at ${newVersion}`)
} catch (error) {
  console.error(`\n! ${tag} is released, but ${startBranch} was not updated: ${error.message}`)
  console.error('  Finish by hand when convenient:')
  console.error(`    git checkout ${startBranch} && git merge --ff-only ${releaseBranch}`)
  console.error(`    git push ${REMOTE} ${startBranch}`)
  process.exit(1)
}
