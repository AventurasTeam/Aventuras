import { describe, it, expect } from 'vitest'
import { isPublicHttpUrl, normalizeBaseUrl } from './url'

describe('normalizeBaseUrl', () => {
  it.each([
    ['https://api.example.com/v1/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1///', 'https://api.example.com/v1'],
    ['  https://api.example.com/v1  ', 'https://api.example.com/v1'],
    [' https://api.example.com/v1// ', 'https://api.example.com/v1'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['http://localhost:8188/', 'http://localhost:8188'],
  ])('turns %j into %j', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected)
  })

  it('never strips the slashes in the scheme', () => {
    expect(normalizeBaseUrl('https://')).toBe('https:')
  })

  it.each([undefined, '', '   ', ' / '])('gives an empty string for %j', (input) => {
    expect(normalizeBaseUrl(input)).toBe('')
  })
})

describe('isPublicHttpUrl', () => {
  it.each([
    'https://cdn.example.com/a.png',
    'http://example.com:8080/a.png',
    'https://93.184.216.34/a.png',
    'https://172.15.0.1/a.png',
    'https://172.32.0.1/a.png',
    'https://100.63.255.255/a.png',
    'https://[2606:4700::1111]/a.png',
    'https://[::ffff:5db8:d822]/a.png',
  ])('accepts %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(true)
  })

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/a.png',
    'data:image/png;base64,AAAA',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })

  it.each([
    'http://localhost/a.png',
    'http://localhost:8188/a.png',
    'http://localhost./a.png',
    'http://app.localhost/a.png',
    'http://printer.local/a.png',
    'http://printer.local./a.png',
    'http://db.internal/a.png',
    'http://router.home.arpa/a.png',
    'http://intranet/a.png',
  ])('rejects the local name %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })

  it.each([
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://100.64.0.1/',
    'http://100.127.255.255/',
    'http://127.0.0.1:8188/',
    'http://127.255.255.254/',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
  ])('rejects the private IPv4 address %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })

  it.each([
    ['decimal', 'http://2130706433/'],
    ['hex', 'http://0x7f000001/'],
    ['short dotted', 'http://127.1/'],
    ['hex octets', 'http://0x7f.0.0.1/'],
    ['octal octets', 'http://0177.0.0.1/'],
  ])('rejects loopback written in %s form', (_form, url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })

  it.each([
    'http://[::]/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[febf::1]/',
    'http://[ff02::1]/',
    'http://[::7f00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[::ffff:c0a8:101]/',
  ])('rejects the private IPv6 address %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })
})
