import fs from 'fs'
import { execSync } from 'child_process'
import path from 'path'

const rootDir = process.cwd()

// Read current version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const currentVersion = pkg.version

function bumpVersion(version, type) {
  const [v, pre] = version.split('-')
  const parts = v.split('.').map(Number)

  if (type === 'major') {
    return `${parts[0] + 1}.0.0`
  }
  if (type === 'minor') {
    return `${parts[0]}.${parts[1] + 1}.0`
  }
  if (type === 'patch') {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  }
  if (type === 'prerelease') {
    if (!pre) return `${v}-pre.1`
    const preMatch = pre.match(/^pre\.(\d+)$/)
    if (!preMatch) return `${v}-pre.1`
    return `${v}-pre.${parseInt(preMatch[1], 10) + 1}`
  }
  return type // Direct version string
}

const inputArg = process.argv[2]
const newVersion = bumpVersion(currentVersion, inputArg)
const REMOTE = 'https://github.com/AventurasTeam/Aventuras.git'

// Files to update manually
const manualFiles = [
  {
    path: path.join(rootDir, 'src-tauri/tauri.conf.json'),
    type: 'json',
    key: 'version',
  },
  {
    path: path.join(rootDir, 'src-tauri/Cargo.toml'),
    type: 'toml',
    regex: /^version\s*=\s*"(.*)"/m,
    replace: `version = "${newVersion}"`,
  },
]

// Pre-check 1: Ensure version is specified
if (!newVersion) {
  console.error('Error: New version not specified.\nUsage: node scripts/release.js <version>')
  process.exit(1)
}

// Pre-check 2: Ensure no uncommitted changes
const gitStatus = execSync('git status --porcelain').toString()
if (gitStatus) {
  console.error(
    'Error: Uncommitted changes found. Please commit or stash them before running the release script.',
  )
  process.exit(1)
}

try {
  // 1. Create release branch
  console.log(`Creating release branch: release/v${newVersion}...`)
  execSync(`git checkout -b release/v${newVersion}`)

  // 2. Update package.json using npm version
  console.log('Updating package.json and package-lock.json via npm version...')
  execSync(`npm version ${newVersion} --no-git-tag-version`)

  // 3. Update other files manually
  for (const file of manualFiles) {
    console.log(`Updating ${path.basename(file.path)}...`)
    let content = fs.readFileSync(file.path, 'utf8')

    if (file.type === 'json') {
      const json = JSON.parse(content)
      json[file.key] = newVersion
      content = JSON.stringify(json, null, 2) + '\n'
    } else if (file.type === 'toml') {
      content = content.replace(file.regex, file.replace)
    }

    fs.writeFileSync(file.path, content)
  }

  // 4. Update Cargo.lock
  console.log('Updating Cargo.lock...')
  try {
    execSync('cargo update -p aventura --offline', { cwd: path.join(rootDir, 'src-tauri') })
  } catch {
    console.error('Offline update failed.')
    process.exit(1)
  }

  // 5. Commit changes
  console.log('Committing changes...')
  execSync('git add .')
  execSync(`git commit -m "chore: bump version to ${newVersion}"`)

  // 6. Create tag
  console.log(`Creating tag v${newVersion}...`)
  execSync(`git tag v${newVersion}`)

  // 7. Push
  console.log(`Pushing changes to remote '${REMOTE}'...`)
  execSync(`git push --atomic ${REMOTE} release/v${newVersion} v${newVersion}`)

  console.log(`\nSuccessfully managed release v${newVersion}!`)
  console.log(`Current branch: release/v${newVersion}`)
  console.log(`Created tag: v${newVersion}`)
} catch (error) {
  console.error('\nError managing release:', error.message)
  process.exit(1)
}
