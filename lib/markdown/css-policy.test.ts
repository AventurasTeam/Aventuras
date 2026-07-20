import { describe, expect, it } from 'vitest'

import { declarationHasBannedValue } from './css-policy'

describe('declarationHasBannedValue', () => {
  it('flags a literal url() reference', () => {
    expect(declarationHasBannedValue('background', 'url(https://evil.example/x)')).toBe(true)
  })

  it('flags CSS-escaped url() forms the browser decodes at parse time', () => {
    expect(declarationHasBannedValue('background', '\\75rl(https://evil.example/x)')).toBe(true)
    expect(declarationHasBannedValue('background', '\\000075rl(https://evil.example/x)')).toBe(true)
    expect(declarationHasBannedValue('background', 'u\\72 l(https://evil.example/x)')).toBe(true)
  })

  it('consumes a CRLF as the single trailing whitespace of a hex escape', () => {
    // The browser preprocesses \r\n to \n before tokenizing, so the hex
    // escape's optional trailing whitespace swallows the whole CRLF and the
    // name resolves to url(. Matching only \r would leave a stray \n and let
    // the reference through.
    expect(declarationHasBannedValue('background', '\\75\r\nrl(https://evil.example/x)')).toBe(true)
  })

  it('flags resource functions that carry no url() token', () => {
    expect(
      declarationHasBannedValue('background-image', 'image-set("https://evil.example/x" 1x)'),
    ).toBe(true)
    expect(
      declarationHasBannedValue('background', '-webkit-image-set("https://evil.example/x" 1x)'),
    ).toBe(true)
    expect(declarationHasBannedValue('background', 'cross-fade(url(a), url(b), 50%)')).toBe(true)
    expect(declarationHasBannedValue('background', 'element(#src)')).toBe(true)
  })

  it('flags legacy executable CSS', () => {
    expect(declarationHasBannedValue('width', 'expression(alert(1))')).toBe(true)
    expect(declarationHasBannedValue('behavior', 'url(x.htc)')).toBe(true)
    expect(declarationHasBannedValue('-moz-binding', 'url(x.xml#e)')).toBe(true)
  })

  it('passes safe declarations, including url( inside a string literal', () => {
    expect(declarationHasBannedValue('color', 'red')).toBe(false)
    expect(declarationHasBannedValue('width', 'calc(100% - 10px)')).toBe(false)
    expect(declarationHasBannedValue('background', 'rgb(255, 0, 0)')).toBe(false)
    expect(declarationHasBannedValue('content', '"a string with url( inside"')).toBe(false)
  })
})
