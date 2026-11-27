import { describe, it, expect } from 'vitest'
import { isFolderUrl, localDate, withTimeOfDay } from './exportTarget'

const at = new Date(2026, 10, 27, 14, 3, 7)

describe('withTimeOfDay', () => {
  it('puts the time before the extension', () => {
    expect(withTimeOfDay('aventura-backup-2026-11-27.zip', at)).toBe(
      'aventura-backup-2026-11-27-140307.zip',
    )
  })

  it('keeps only the last extension intact', () => {
    expect(withTimeOfDay('My.Story.avt', at)).toBe('My.Story-140307.avt')
  })

  it('appends to a name without an extension', () => {
    expect(withTimeOfDay('notes', at)).toBe('notes-140307')
  })

  it('keeps a filter extension with parts of its own together', () => {
    expect(withTimeOfDay('noir.prompt.json', at, ['prompt.json'])).toBe('noir-140307.prompt.json')
  })

  it('does not treat a leading dot as an extension', () => {
    expect(withTimeOfDay('.hidden', at)).toBe('.hidden-140307')
  })
})

describe('isFolderUrl', () => {
  it('recognises the folder iOS returns after Keep Both', () => {
    expect(isFolderUrl('file:///private/var/File%20Provider%20Storage/')).toBe(true)
    expect(isFolderUrl('file:///private/var/File%20Provider%20Storage/backup.zip')).toBe(false)
  })
})

describe('localDate', () => {
  it('uses the local calendar date', () => {
    expect(localDate(at)).toBe('2026-11-27')
  })
})
