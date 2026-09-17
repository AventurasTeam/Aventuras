import { describe, it, expect } from 'vitest'
import { lockfileHash } from './lockfile-hash.js'

const baseLock = {
  name: 'aventura',
  version: '0.7.6',
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'aventura',
      version: '0.7.6',
      dependencies: { svelte: '^5.0.0' },
    },
    'node_modules/svelte': {
      version: '5.0.0',
      resolved: 'https://registry.npmjs.org/svelte/-/svelte-5.0.0.tgz',
    },
  },
}

describe('lockfileHash', () => {
  it('is unchanged when only the root and package versions are bumped', () => {
    const bumped = structuredClone(baseLock)
    bumped.version = '0.7.7'
    bumped.packages[''].version = '0.7.7'

    expect(lockfileHash(bumped)).toBe(lockfileHash(baseLock))
  })

  it('changes when a dependency entry changes', () => {
    const changed = structuredClone(baseLock)
    changed.packages['node_modules/svelte'].version = '5.1.0'

    expect(lockfileHash(changed)).not.toBe(lockfileHash(baseLock))
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(baseLock)
    lockfileHash(baseLock)
    expect(JSON.stringify(baseLock)).toBe(before)
  })
})
