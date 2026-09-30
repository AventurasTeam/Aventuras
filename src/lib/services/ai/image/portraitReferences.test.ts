import { describe, expect, it } from 'vitest'
import type { Character } from '$lib/types'
import {
  PendingPortraits,
  referencePortraitSources,
  refreshCharacter,
  resolveReferenceUrls,
  resolveScenes,
} from './portraitReferences'
import type { ImageableScene } from '../sdk/schemas/imageanalysis'

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

  it('keeps the order of the depicted characters', () => {
    const depicted = [
      character({ id: 'b', name: 'Tomas', portrait: 'tomas' }),
      character({ id: 'a', name: 'Mira', portrait: 'mira' }),
    ]
    expect(referencePortraitSources(depicted, none)).toEqual(['tomas', 'mira'])
  })

  it('prefers a saved portrait over a pending one', () => {
    const depicted = [character({ id: 'a', portrait: 'saved' })]
    const pendingFor = () => Promise.resolve('new')
    expect(referencePortraitSources(depicted, pendingFor)).toEqual(['saved'])
  })

  it('uses a pending portrait when there is no saved one', () => {
    const promise = Promise.resolve('new')
    expect(referencePortraitSources([character({ id: 'a' })], () => promise)).toEqual([promise])
  })

  it('skips characters with neither', () => {
    const depicted = [
      character({ id: 'a', name: 'Mira' }),
      character({ id: 'b', name: 'Tomas', portrait: 'tomas' }),
    ]
    expect(referencePortraitSources(depicted, none)).toEqual(['tomas'])
  })

  it('looks at the first three characters only', () => {
    const depicted = ['A', 'B', 'C', 'D'].map((name) =>
      character({ id: name, name, portrait: name }),
    )
    expect(referencePortraitSources(depicted, none)).toEqual(['A', 'B', 'C'])
  })

  it('counts a character without a portrait toward the limit of three', () => {
    const depicted = [
      character({ id: 'A', name: 'A', portrait: 'A' }),
      character({ id: 'B', name: 'B' }),
      character({ id: 'C', name: 'C', portrait: 'C' }),
      character({ id: 'D', name: 'D', portrait: 'D' }),
    ]
    expect(referencePortraitSources(depicted, none)).toEqual(['A', 'C'])
  })
})

describe('resolveScenes', () => {
  const mira = character({ id: 'a', name: 'Mira' })
  const tomas = character({ id: 'b', name: 'Tomas' })
  const present = [mira, tomas]

  function scene(
    overrides: Partial<ImageableScene> & Pick<ImageableScene, 'prompt'>,
  ): ImageableScene {
    return {
      sourceText: 'quote',
      sceneType: 'character',
      priority: 5,
      characters: [],
      generatePortrait: false,
      ...overrides,
    }
  }

  const prompts = (scenes: { prompt: string }[]) => scenes.map((s) => s.prompt)

  it('matches names ignoring case and surrounding whitespace', () => {
    const [resolved] = resolveScenes([scene({ prompt: 'a', characters: [' mIRA '] })], present)
    expect(resolved.depicted).toEqual([mira])
  })

  it('drops names that match nobody and repeats of one character', () => {
    const [resolved] = resolveScenes(
      [scene({ prompt: 'a', characters: ['Nobody', 'Mira', 'mira ', 'Tomas'] })],
      present,
    )
    expect(resolved.depicted).toEqual([mira, tomas])
  })

  it('keeps only the first portrait for a character, ignoring case', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['mira '], generatePortrait: true }),
    ]
    expect(prompts(resolveScenes(scenes, present))).toEqual(['a'])
  })

  it('treats a copy-on-write override as its original', () => {
    const override = character({ id: 'z', name: 'Mira', overridesId: 'a' })
    const scenes = [
      scene({ prompt: 'a', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['Mira'], generatePortrait: true }),
    ]
    expect(prompts(resolveScenes(scenes, [override]))).toEqual(['a'])
  })

  it('keeps portraits for different characters', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['Tomas'], generatePortrait: true }),
    ]
    const resolved = resolveScenes(scenes, present)
    expect(resolved.map((s) => s.portraitOf)).toEqual([mira, tomas])
  })

  it('never drops non-portrait scenes, even for a character that has a portrait', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['Mira'] }),
      scene({ prompt: 'c', characters: ['Mira'] }),
    ]
    expect(resolveScenes(scenes, present)).toHaveLength(3)
  })

  it('drops a portrait whose first name is unknown rather than giving it to the second', () => {
    const scenes = [scene({ prompt: 'a', characters: ['Nobody', 'Mira'], generatePortrait: true })]
    expect(resolveScenes(scenes, present)).toEqual([])
  })

  it('drops portrait scenes for a name that matches nobody', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Nobody'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['Mira'] }),
    ]
    expect(prompts(resolveScenes(scenes, present))).toEqual(['b'])
  })

  it('drops portrait scenes that name no one', () => {
    const scenes = [scene({ prompt: 'a', generatePortrait: true }), scene({ prompt: 'b' })]
    expect(prompts(resolveScenes(scenes, present))).toEqual(['b'])
  })

  it('preserves order', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Tomas'], generatePortrait: true }),
      scene({ prompt: 'b' }),
      scene({ prompt: 'c', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'd', characters: ['tomas'], generatePortrait: true }),
    ]
    expect(prompts(resolveScenes(scenes, present))).toEqual(['a', 'b', 'c'])
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
