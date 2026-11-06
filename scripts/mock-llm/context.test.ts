import { describe, expect, it } from 'vitest'

import { createContext, laneCatalog } from './context'

describe('laneCatalog', () => {
  it('files a tool lane under Tools by its key, and keeps a blockless shape Unregistered', () => {
    const ctx = createContext({ persist: false })
    ctx.discovered.set('tools:lookup', { key: 'tools:lookup', block: null, firstSeenAt: 1 })
    ctx.discovered.set('unknown:no-schema', {
      key: 'unknown:no-schema',
      block: null,
      firstSeenAt: 2,
    })

    const catalog = laneCatalog(ctx)

    expect(catalog.find((meta) => meta.key === 'tools:lookup')).toEqual({
      key: 'tools:lookup',
      title: 'tools:lookup',
      kind: 'tool',
      group: 'tools',
    })
    expect(catalog.find((meta) => meta.key === 'unknown:no-schema')).toEqual({
      key: 'unknown:no-schema',
      title: 'unknown:no-schema',
      kind: 'unknown',
      group: 'unknown',
    })
  })
})
