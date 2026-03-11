import { describe, it, expect } from 'vitest'
import { templateEngine } from './engine'

describe('templateEngine (infrastructure smoke test)', () => {
  it('renders a simple template string', () => {
    const result = templateEngine.render('Hello {{ name }}', { name: 'world' })
    expect(result).not.toBeNull()
    expect(result).toBe('Hello world')
  })
})
