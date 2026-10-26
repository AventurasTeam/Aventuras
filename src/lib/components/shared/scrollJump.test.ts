import { describe, expect, it } from 'vitest'
import { JUMP_SCREENS, readJumpState } from './scrollJump'

describe('readJumpState', () => {
  it('offers no jumps for a body under the threshold', () => {
    const height = 500
    expect(
      readJumpState({ scrollTop: 0, scrollHeight: height * JUMP_SCREENS, clientHeight: height })
        .long,
    ).toBe(false)
  })

  it('offers jumps for a long body', () => {
    expect(readJumpState({ scrollTop: 0, scrollHeight: 3000, clientHeight: 500 }).long).toBe(true)
  })

  it('knows the top and the bottom', () => {
    expect(readJumpState({ scrollTop: 0, scrollHeight: 3000, clientHeight: 500 })).toMatchObject({
      atTop: true,
      atBottom: false,
    })
    expect(readJumpState({ scrollTop: 2500, scrollHeight: 3000, clientHeight: 500 })).toMatchObject(
      { atTop: false, atBottom: true },
    )
  })

  it('counts a scroll a fraction short of the end as at the bottom', () => {
    expect(
      readJumpState({ scrollTop: 2499.4, scrollHeight: 3000, clientHeight: 500 }).atBottom,
    ).toBe(true)
  })

  it('offers nothing before the body has a height', () => {
    expect(readJumpState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 }).long).toBe(false)
  })
})
