import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deletePartial, downloadFile, persistInstall } from './downloads'

const PAYLOAD = Buffer.from('a'.repeat(20000) + 'the-quick-brown-fox' + 'b'.repeat(20000))
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex')

type ServerBehavior = {
  // When set, the first request writes `abortAfter` bytes then destroys the socket.
  abortAfter?: number
  // Records the Range header of the most recent request.
  lastRange?: string
  requestCount: number
  // When true, ignore Range and always send the full body with 200.
  ignoreRange?: boolean
}

let server: Server
let behavior: ServerBehavior
let baseUrl: string

beforeEach(async () => {
  behavior = { requestCount: 0 }
  server = createServer((req, res) => {
    behavior.requestCount += 1
    behavior.lastRange = req.headers.range
    const range = behavior.ignoreRange ? undefined : req.headers.range

    if (behavior.abortAfter !== undefined && behavior.requestCount === 1) {
      res.writeHead(200, { 'content-length': String(PAYLOAD.length) })
      res.write(PAYLOAD.subarray(0, behavior.abortAfter))
      setTimeout(() => req.socket.destroy(), 10)
      return
    }

    if (range) {
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
      const slice = PAYLOAD.subarray(start)
      res.writeHead(206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
      })
      res.end(slice)
      return
    }

    res.writeHead(200, { 'content-length': String(PAYLOAD.length) })
    res.end(PAYLOAD)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}/file`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'embedder-dl-'))
}

describe('downloadFile — happy path', () => {
  it('streams, verifies, and renames to the final file', async () => {
    const dir = freshDir()
    const result = await downloadFile({
      url: baseUrl,
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: PAYLOAD_SHA,
    })
    expect(result).toEqual({ ok: true })
    expect(existsSync(join(dir, 'model.onnx'))).toBe(true)
    expect(existsSync(join(dir, 'model.onnx.part'))).toBe(false)
    expect(
      createHash('sha256')
        .update(readFileSync(join(dir, 'model.onnx')))
        .digest('hex'),
    ).toBe(PAYLOAD_SHA)
  })

  it('reports progress up to the total size', async () => {
    const dir = freshDir()
    let lastReceived = 0
    let lastTotal = 0
    await downloadFile({
      url: baseUrl,
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: PAYLOAD_SHA,
      onProgress: (received, total) => {
        lastReceived = received
        lastTotal = total
      },
    })
    expect(lastReceived).toBe(PAYLOAD.length)
    expect(lastTotal).toBe(PAYLOAD.length)
  })
})

describe('downloadFile — verification', () => {
  it('deletes the partial and returns hash-mismatch on a bad hash', async () => {
    const dir = freshDir()
    const result = await downloadFile({
      url: baseUrl,
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: 'deadbeef',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('hash-mismatch')
    expect(existsSync(join(dir, 'model.onnx.part'))).toBe(false)
    expect(existsSync(join(dir, 'model.onnx'))).toBe(false)
  })

  it('skips verification when expectedSha256 is null', async () => {
    const dir = freshDir()
    const result = await downloadFile({
      url: baseUrl,
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: null,
    })
    expect(result).toEqual({ ok: true })
    expect(existsSync(join(dir, 'model.onnx'))).toBe(true)
  })
})

describe('downloadFile — resume', () => {
  it('leaves a .part on mid-stream abort, then resumes with Range and completes', async () => {
    const dir = freshDir()
    behavior.abortAfter = 15000

    const first = await downloadFile({
      url: baseUrl,
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: PAYLOAD_SHA,
    })
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.reason).toBe('network')
    const partPath = join(dir, 'model.onnx.part')
    expect(existsSync(partPath)).toBe(true)
    expect(readFileSync(partPath).length).toBe(15000)

    const second = await downloadFile({
      url: baseUrl,
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: PAYLOAD_SHA,
    })
    expect(second).toEqual({ ok: true })
    expect(behavior.lastRange).toBe('bytes=15000-')
    expect(existsSync(partPath)).toBe(false)
    expect(
      createHash('sha256')
        .update(readFileSync(join(dir, 'model.onnx')))
        .digest('hex'),
    ).toBe(PAYLOAD_SHA)
  })

  it('restarts cleanly when the server ignores Range (200 on a resumed call)', async () => {
    const dir = freshDir()
    const partPath = join(dir, 'model.onnx.part')
    writeFileSync(partPath, PAYLOAD.subarray(0, 5000))
    behavior.ignoreRange = true

    const result = await downloadFile({
      url: baseUrl,
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: PAYLOAD_SHA,
    })
    expect(result).toEqual({ ok: true })
    expect(
      createHash('sha256')
        .update(readFileSync(join(dir, 'model.onnx')))
        .digest('hex'),
    ).toBe(PAYLOAD_SHA)
  })
})

describe('downloadFile — network failure', () => {
  it('returns network when the host is unreachable', async () => {
    const dir = freshDir()
    const result = await downloadFile({
      url: 'http://127.0.0.1:1/nope',
      destDir: dir,
      fileName: 'model.onnx',
      expectedSha256: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('network')
  })
})

describe('persistInstall', () => {
  it('writes LICENSE.txt, .attestation, and meta.json', async () => {
    const dir = freshDir()
    const attestation = {
      timestamp: 1_700_000_000_000,
      licenseSha256: 'abc123',
      sourceUrl: 'https://huggingface.co/x',
      revision: 'rev123',
    }
    await persistInstall({
      destDir: dir,
      modelId: 'Xenova/all-MiniLM-L6-v2',
      licenseText: 'MIT License text',
      attestation,
    })
    expect(readFileSync(join(dir, 'LICENSE.txt'), 'utf8')).toBe('MIT License text')
    expect(JSON.parse(readFileSync(join(dir, '.attestation'), 'utf8'))).toEqual(attestation)
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))).toEqual({
      id: 'Xenova/all-MiniLM-L6-v2',
      installedAt: attestation.timestamp,
    })
  })
})

describe('deletePartial', () => {
  it('recursively removes the model dir', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'model.onnx.part'), 'partial')
    await deletePartial(dir)
    expect(existsSync(dir)).toBe(false)
  })
})
