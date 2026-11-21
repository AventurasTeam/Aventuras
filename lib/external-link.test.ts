import { describe, expect, it } from 'vitest'

import { externalLinkPath } from './external-link'

describe('externalLinkPath', () => {
  it('opens a release build at the story list, whatever the launch link names', () => {
    expect(externalLinkPath('/reader-composer/br_1', { initial: true, dev: false })).toBe('/')
    expect(externalLinkPath('/', { initial: true, dev: false })).toBe('/')
  })

  it('drops a link that reaches a running release build', () => {
    expect(externalLinkPath('/settings', { initial: false, dev: false })).toBeNull()
    expect(externalLinkPath('/reader-composer/br_2', { initial: false, dev: false })).toBeNull()
  })

  it('passes every link through in a dev build', () => {
    expect(externalLinkPath('/reader-composer/br_1', { initial: true, dev: true })).toBe(
      '/reader-composer/br_1',
    )
    expect(externalLinkPath('/settings', { initial: false, dev: true })).toBe('/settings')
  })
})
