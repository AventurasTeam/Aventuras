import { describe, expect, it } from 'vitest'
import type { Character } from '$lib/types'
import {
  PendingPortraits,
  referencePortraitSources,
  refreshCharacter,
  resolveReferenceUrls,
} from './portraitReferences'

function character(overrides: Partial<Character> & Pick<Character, 'id'>): Character {
  return { name: 'Mira', portrait: null, ...overrides } as Character
}

const scope = { storyId: 's1', branchId: null }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('refreshCharacter', () => {
  it('returns the live entry with the same id', () => {
    const stale = character({ id: 'a' })
    const live = character({ id: 'a', portrait: 'img' })
    expect(refreshCharacter(stale, [live])).toBe(live)
  })

  it('follows a copy-on-write swap to the override', () => {
    const stale = character({ id: 'a' })
    const override = character({ id: 'b', overridesId: 'a', portrait: 'img' })
    expect(refreshCharacter(stale, [override])).toBe(override)
  })

  it('matches an override against its original', () => {
    const stale = character({ id: 'b', overridesId: 'a' })
    const live = character({ id: 'a', portrait: 'img' })
    expect(refreshCharacter(stale, [live])).toBe(live)
  })

  it('does not match a different character with the same name', () => {
    const stale = character({ id: 'a' })
    const other = character({ id: 'z', portrait: 'img' })
    expect(refreshCharacter(stale, [other])).toBe(stale)
  })

  it('keeps the given character when it is no longer live', () => {
    const stale = character({ id: 'a' })
    expect(refreshCharacter(stale, [])).toBe(stale)
  })
})

describe('PendingPortraits', () => {
  it('returns a tracked portrait until it settles', async () => {
    const pending = new PendingPortraits()
    const mira = character({ id: 'a' })
    const { promise, resolve } = deferred<string | null>()

    pending.track(scope, mira, promise)
    expect(pending.get(scope, mira)).toBe(promise)

    resolve('img')
    await promise
    expect(pending.get(scope, mira)).toBeUndefined()
  })

  it('finds a portrait through a copy-on-write swap', () => {
    const pending = new PendingPortraits()
    const promise = deferred<string | null>().promise
    pending.track(scope, character({ id: 'a' }), promise)

    expect(pending.get(scope, character({ id: 'b', overridesId: 'a' }))).toBe(promise)
  })

  it('keeps branches apart', () => {
    const pending = new PendingPortraits()
    const mira = character({ id: 'a' })
    pending.track(scope, mira, deferred<string | null>().promise)

    expect(pending.get({ storyId: 's1', branchId: 'b1' }, mira)).toBeUndefined()
    expect(pending.get({ storyId: 's2', branchId: null }, mira)).toBeUndefined()
  })

  it('clears a failed portrait so a retry is not blocked', async () => {
    const pending = new PendingPortraits()
    const mira = character({ id: 'a' })
    const { promise, resolve } = deferred<string | null>()

    pending.track(scope, mira, promise)
    resolve(null)
    await promise
    expect(pending.get(scope, mira)).toBeUndefined()
  })

  it('does not clear a newer portrait when an older one settles', async () => {
    const pending = new PendingPortraits()
    const mira = character({ id: 'a' })
    const older = deferred<string | null>()
    const newer = deferred<string | null>()

    pending.track(scope, mira, older.promise)
    pending.track(scope, mira, newer.promise)
    older.resolve('img')
    await older.promise

    expect(pending.get(scope, mira)).toBe(newer.promise)
  })
})

describe('referencePortraitSources', () => {
  const none = () => undefined

  it('keeps the order of the named characters', () => {
    const characters = [
      character({ id: 'a', name: 'Mira', portrait: 'mira' }),
      character({ id: 'b', name: 'Tomas', portrait: 'tomas' }),
    ]
    expect(referencePortraitSources(['Tomas', 'Mira'], characters, none)).toEqual(['tomas', 'mira'])
  })

  it('matches names ignoring case', () => {
    const characters = [character({ id: 'a', name: 'Mira', portrait: 'mira' })]
    expect(referencePortraitSources(['mIRA'], characters, none)).toEqual(['mira'])
  })

  it('prefers a saved portrait over a pending one', () => {
    const characters = [character({ id: 'a', portrait: 'saved' })]
    const pendingFor = () => Promise.resolve('new')
    expect(referencePortraitSources(['Mira'], characters, pendingFor)).toEqual(['saved'])
  })

  it('uses a pending portrait when there is no saved one', () => {
    const characters = [character({ id: 'a' })]
    const promise = Promise.resolve('new')
    expect(referencePortraitSources(['Mira'], characters, () => promise)).toEqual([promise])
  })

  it('skips characters with neither, and names that match no character', () => {
    const characters = [
      character({ id: 'a', name: 'Mira' }),
      character({ id: 'b', name: 'Tomas', portrait: 'tomas' }),
    ]
    expect(referencePortraitSources(['Mira', 'Nobody', 'Tomas'], characters, none)).toEqual([
      'tomas',
    ])
  })

  it('looks at the first three names only', () => {
    const characters = ['A', 'B', 'C', 'D'].map((name) =>
      character({ id: name, name, portrait: name }),
    )
    expect(referencePortraitSources(['A', 'B', 'C', 'D'], characters, none)).toEqual([
      'A',
      'B',
      'C',
    ])
  })
})

describe('resolveReferenceUrls', () => {
  it('waits for pending portraits and normalizes raw base64', async () => {
    const urls = await resolveReferenceUrls(['data:image/png;base64,abc', Promise.resolve('raw')])
    expect(urls).toEqual(['data:image/png;base64,abc', 'data:image/png;base64,raw'])
  })

  it('drops portraits that failed', async () => {
    const urls = await resolveReferenceUrls([Promise.resolve(null), 'raw'])
    expect(urls).toEqual(['data:image/png;base64,raw'])
  })

  it('returns nothing when every portrait failed', async () => {
    expect(await resolveReferenceUrls([Promise.resolve(null)])).toEqual([])
  })
})
