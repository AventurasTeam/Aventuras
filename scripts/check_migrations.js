import { readdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(__dirname, '../src-tauri/migrations')

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => resolve(migrationsDir, f))

let failed = false

for (const file of files) {
  const content = readFileSync(file, 'utf8')
  if (content.includes('\r')) {
    console.error(`CRLF line endings detected: ${file}`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
}
