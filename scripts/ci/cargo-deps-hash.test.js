import { describe, it, expect } from 'vitest'
import { cargoDepsHash } from './cargo-deps-hash.js'

const lock = `version = 4

[[package]]
name = "aventura"
version = "0.7.12"
dependencies = [
 "serde",
]

[[package]]
name = "serde"
version = "1.0.200"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"
`

const manifest = `[package]
name = "aventura"
version = "0.7.12"
edition = "2024"

[dependencies]
serde = { version = "1", features = ["derive"] }
`

describe('cargoDepsHash', () => {
  it('is unchanged when only the app version is bumped', () => {
    expect(
      cargoDepsHash(lock.replace('0.7.12', '0.7.13'), manifest.replace('0.7.12', '0.7.13')),
    ).toBe(cargoDepsHash(lock, manifest))
  })

  it('changes when a registry package version changes', () => {
    expect(cargoDepsHash(lock.replace('1.0.200', '1.0.201'), manifest)).not.toBe(
      cargoDepsHash(lock, manifest),
    )
  })

  it('changes when a dependency feature changes in the manifest', () => {
    expect(cargoDepsHash(lock, manifest.replace('["derive"]', '["derive", "rc"]'))).not.toBe(
      cargoDepsHash(lock, manifest),
    )
  })

  it('ignores line endings', () => {
    expect(cargoDepsHash(lock.replaceAll('\n', '\r\n'), manifest.replaceAll('\n', '\r\n'))).toBe(
      cargoDepsHash(lock, manifest),
    )
  })
})
