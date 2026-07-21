import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { EmbedderAttestation, EmbedderDownloadReason } from './types'

export type DownloadResult =
  | { ok: true }
  | { ok: false; reason: EmbedderDownloadReason; message: string }

type DownloadArgs = {
  url: string
  destDir: string
  fileName: string
  expectedSha256: string | null
  signal?: AbortSignal
  onProgress?: (bytesReceived: number, bytesTotal: number) => void
}

const DISK_ERROR_CODES = new Set(['ENOSPC', 'EDQUOT', 'EACCES', 'EROFS', 'EMFILE', 'ENFILE'])

// Emit progress at most every 256KB (plus a terminal emit) to bound IPC chatter.
const PROGRESS_INTERVAL_BYTES = 256 * 1024

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDiskError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    DISK_ERROR_CODES.has((error as { code?: string }).code ?? '')
  )
}

async function hashExistingBytes(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
}

// Assumes one in-flight download per file: the download dialog serializes the
// catalog's files, so a single .part per fileName is never contended. Concurrent
// writers to the same .part would corrupt both the file and its running hash.
export async function downloadFile(args: DownloadArgs): Promise<DownloadResult> {
  return downloadAttempt(args, false)
}

async function downloadAttempt(
  args: DownloadArgs,
  retriedAfter416: boolean,
): Promise<DownloadResult> {
  const { url, destDir, fileName, expectedSha256, signal, onProgress } = args
  const finalPath = join(destDir, fileName)
  const partPath = `${finalPath}.part`

  if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Download cancelled' }

  try {
    await mkdir(destDir, { recursive: true })
  } catch (error) {
    return { ok: false, reason: 'disk', message: messageOf(error) }
  }

  const existingSize = existsSync(partPath) ? statSync(partPath).size : 0

  let response: Response
  try {
    response = await fetch(url, {
      ...(existingSize > 0 ? { headers: { Range: `bytes=${existingSize}-` } } : {}),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Download cancelled' }
    return { ok: false, reason: 'network', message: messageOf(error) }
  }

  if (response.status === 416) {
    // The .part is already >= the server's file size. If it verifies, it's a
    // complete download that never got renamed; otherwise it's stale — discard
    // and restart from scratch.
    if (expectedSha256 !== null && existsSync(partPath)) {
      try {
        const existingHash = createHash('sha256')
        await hashExistingBytes(existingHash, partPath)
        if (existingHash.digest('hex') === expectedSha256.toLowerCase()) {
          await rename(partPath, finalPath)
          return { ok: true }
        }
      } catch (error) {
        return { ok: false, reason: 'disk', message: messageOf(error) }
      }
    }
    // A second 416 with no partial left to resume means the server rejects the
    // bare request too — recursing again would spin without bound.
    if (retriedAfter416) {
      return {
        ok: false,
        reason: 'network',
        message: 'Server rejected the range request and no resumable partial remains',
      }
    }
    await rm(partPath, { force: true })
    return downloadAttempt(args, true)
  }

  if (response.status !== 200 && response.status !== 206) {
    return { ok: false, reason: 'network', message: `Unexpected status ${response.status}` }
  }
  if (!response.body) {
    return { ok: false, reason: 'network', message: 'Response had no body' }
  }

  // A 206 whose range doesn't actually start where our .part ends would splice
  // mismatched bytes onto it, so treat that as a fresh download instead.
  const rangeStart = Number(
    /^bytes\s+(\d+)-/.exec(response.headers.get('content-range') ?? '')?.[1],
  )
  const resuming = existingSize > 0 && response.status === 206 && rangeStart === existingSize
  const hash = createHash('sha256')
  // A missing content-length (chunked transfer) means the total is unknown; -1
  // signals that to the progress UI rather than a 0 that reads as "no bytes".
  const contentLength = response.headers.has('content-length')
    ? Number(response.headers.get('content-length'))
    : -1

  let received = 0
  let total = 0
  let handle: Awaited<ReturnType<typeof open>>

  try {
    if (resuming) {
      await hashExistingBytes(hash, partPath)
      received = existingSize
      total = contentLength < 0 ? -1 : existingSize + contentLength
      handle = await open(partPath, 'a')
    } else {
      // Fresh download, or the server ignored our Range header (200) — start clean.
      if (existsSync(partPath)) await rm(partPath)
      handle = await open(partPath, 'w')
      total = contentLength
    }
  } catch (error) {
    return { ok: false, reason: 'disk', message: messageOf(error) }
  }

  let lastEmitted = 0
  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      await handle.write(value)
      received += value.byteLength
      if (received - lastEmitted >= PROGRESS_INTERVAL_BYTES) {
        onProgress?.(received, total)
        lastEmitted = received
      }
    }
  } catch (error) {
    // A dropped connection leaves the .part in place so a later call can resume;
    // deletePartial is the cleanup path for an abandoned install. Swallow a close
    // failure so it can't replace the error that actually caused the abort.
    await handle.close().catch(() => {})
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Download cancelled' }
    if (isDiskError(error)) return { ok: false, reason: 'disk', message: messageOf(error) }
    return { ok: false, reason: 'network', message: messageOf(error) }
  }

  try {
    await handle.close()
  } catch (error) {
    return { ok: false, reason: 'disk', message: messageOf(error) }
  }

  if (received !== lastEmitted) onProgress?.(received, total)

  if (expectedSha256 !== null && hash.digest('hex') !== expectedSha256.toLowerCase()) {
    await rm(partPath, { force: true })
    return { ok: false, reason: 'hash-mismatch', message: 'SHA-256 did not match expected hash' }
  }

  try {
    await rename(partPath, finalPath)
  } catch (error) {
    return { ok: false, reason: 'disk', message: messageOf(error) }
  }

  return { ok: true }
}

export async function persistInstall(args: {
  destDir: string
  modelId: string
  licenseText: string
  attestation: EmbedderAttestation
}): Promise<void> {
  await mkdir(args.destDir, { recursive: true })
  await writeFile(join(args.destDir, 'LICENSE.txt'), args.licenseText)
  await writeFile(join(args.destDir, '.attestation'), JSON.stringify(args.attestation, null, 2))
  await writeFile(
    join(args.destDir, 'meta.json'),
    JSON.stringify({ id: args.modelId, installedAt: args.attestation.timestamp }, null, 2),
  )
}

export async function deletePartial(destDir: string): Promise<void> {
  await rm(destDir, { recursive: true, force: true })
}
