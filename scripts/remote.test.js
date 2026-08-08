import { describe, it, expect } from 'vitest'
import { githubRepoPath, pickReleaseRemote, RELEASE_REPO_URL } from './remote.js'

describe('githubRepoPath', () => {
  it.each([
    ['git@github.com:AventurasTeam/Aventuras.git', 'aventurasteam/aventuras'],
    ['https://github.com/AventurasTeam/Aventuras.git', 'aventurasteam/aventuras'],
    ['https://github.com/AventurasTeam/Aventuras', 'aventurasteam/aventuras'],
    ['https://github.com/AventurasTeam/Aventuras/', 'aventurasteam/aventuras'],
    ['ssh://git@github.com/AventurasTeam/Aventuras.git', 'aventurasteam/aventuras'],
  ])('reads %o', (url, expected) => {
    expect(githubRepoPath(url)).toBe(expected)
  })

  it('lowercases, so a differently-cased remote still matches', () => {
    expect(githubRepoPath('git@github.com:AVENTURASTEAM/AVENTURAS.git')).toBe(
      'aventurasteam/aventuras',
    )
  })

  it.each(['', 'not a url', 'git@gitlab.com:AventurasTeam/Aventuras.git'])(
    'returns null for %o',
    (url) => {
      expect(githubRepoPath(url)).toBeNull()
    },
  )
})

const line = (name, url, kind) => `${name}\t${url} (${kind})`

describe('pickReleaseRemote', () => {
  it('picks the remote pointing at the release repo, whatever it is called', () => {
    const out = [
      line('origin', 'git@github.com:Pento95/Aventuras.git', 'fetch'),
      line('origin', 'git@github.com:Pento95/Aventuras.git', 'push'),
      line('upstream', 'git@github.com:AventurasTeam/Aventuras.git', 'fetch'),
      line('upstream', 'git@github.com:AventurasTeam/Aventuras.git', 'push'),
    ].join('\n')

    expect(pickReleaseRemote(out).ref).toBe('upstream')
  })

  it('accepts the pre-rename path, which GitHub redirects here', () => {
    const out = line('upstream', 'git@github.com:unkarelian/Aventuras.git', 'push')
    expect(pickReleaseRemote(out).ref).toBe('upstream')
  })

  it('never picks a fork, which shares the repository name', () => {
    // The whole reason the match includes the owner.
    const out = [
      line('origin', 'git@github.com:Pento95/Aventuras.git', 'push'),
      line('other', 'git@github.com:SomeoneElse/Aventuras.git', 'push'),
    ].join('\n')

    expect(pickReleaseRemote(out).ref).toBe(RELEASE_REPO_URL)
  })

  it('ignores fetch-only entries, since pushing is what this is for', () => {
    const out = [
      line('mirror', 'git@github.com:AventurasTeam/Aventuras.git', 'fetch'),
      line('mirror', 'git@github.com:Pento95/Aventuras.git', 'push'),
    ].join('\n')

    expect(pickReleaseRemote(out).ref).toBe(RELEASE_REPO_URL)
  })

  it('falls back to the canonical URL when no remote matches', () => {
    const out = line('origin', 'git@github.com:Pento95/Aventuras.git', 'push')
    expect(pickReleaseRemote(out).ref).toBe(RELEASE_REPO_URL)
  })

  it.each([
    ['', 'empty'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('falls back for %o input (%s)', (input) => {
    expect(pickReleaseRemote(input).ref).toBe(RELEASE_REPO_URL)
  })

  it('labels a matched remote with its URL, so the target repo stays visible', () => {
    const out = line('upstream', 'git@github.com:AventurasTeam/Aventuras.git', 'push')
    expect(pickReleaseRemote(out).label).toBe(
      'upstream (git@github.com:AventurasTeam/Aventuras.git)',
    )
  })
})
