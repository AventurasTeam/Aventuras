import { describe, expect, it } from 'vitest'
import {
  decodeConnectionCode,
  encodeConnectionCode,
  isValidPort,
  parseConnectionData,
} from './connectionCode'

const connection = {
  ip: '192.0.2.1',
  port: 51234,
  token: '3f2c1b7e-0000-4000-8000-000000000000',
  version: '0.7.12',
  protocol: 2,
}

describe('connection codes', () => {
  it('round-trips everything the QR code holds', () => {
    expect(decodeConnectionCode(encodeConnectionCode(connection))).toEqual(connection)
  })

  it('stays one URL-safe line', () => {
    expect(encodeConnectionCode(connection)).toMatch(/^av1-[A-Za-z0-9_-]+$/)
  })

  it('tolerates whitespace from a paste', () => {
    const code = `  ${encodeConnectionCode(connection)}\n`
    expect(decodeConnectionCode(code)).toEqual(connection)
  })

  it.each(['', 'hello', 'av1-', 'av1-!!!', 'av1-e30'])('rejects %j', (code) => {
    expect(decodeConnectionCode(code)).toBeNull()
  })
})

describe('parseConnectionData', () => {
  it('needs an address, a port and a token', () => {
    expect(parseConnectionData('{"ip":"192.0.2.1","port":1}')).toBeNull()
    expect(parseConnectionData('null')).toBeNull()
    expect(parseConnectionData('not json')).toBeNull()
  })

  it.each([
    '{"ip":1,"port":1,"token":"t"}',
    '{"ip":"a","port":"1","token":"t"}',
    '{"ip":"a","port":70000,"token":"t"}',
    '{"ip":"a","port":1,"token":true}',
  ])('rejects wrong field types in %s', (json) => {
    expect(parseConnectionData(json)).toBeNull()
  })

  it('accepts data from before the version fields', () => {
    expect(parseConnectionData('{"ip":"a","port":1,"token":"t"}')).toEqual({
      ip: 'a',
      port: 1,
      token: 't',
      version: undefined,
      protocol: undefined,
    })
  })
})

describe('isValidPort', () => {
  it('takes a real port number only', () => {
    expect(isValidPort(51234)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(70000)).toBe(false)
    expect(isValidPort(1.5)).toBe(false)
  })
})
