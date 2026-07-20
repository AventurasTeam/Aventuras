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
  onProgress?: (bytesReceived: number, bytesTotal: number) => void
}

const DISK_ERROR_CODES = new Set(['ENOSPC', 'EDQUOT', 'EACCES', 'EROFS', 'EMFILE', 'ENFILE'])

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

export async function downloadFile(args: DownloadArgs): Promise<DownloadResult> {
  const { url, destDir, fileName, expectedSha256, onProgress } = args
  const finalPath = join(destDir, fileName)
  const partPath = `${finalPath}.part`

  try {
    await mkdir(destDir, { recursive: true })
  } catch (error) {
    return { ok: false, reason: 'disk', message: messageOf(error) }
  }

  const existingSize = existsSync(partPath) ? statSync(partPath).size : 0

  let response: Response
  try {
    response = await fetch(
      url,
      existingSize > 0 ? { headers: { Range: `bytes=${existingSize}-` } } : {},
    )
  } catch (error) {
    return { ok: false, reason: 'network', message: messageOf(error) }
  }

  if (response.status !== 200 && response.status !== 206) {
    return { ok: false, reason: 'network', message: `Unexpected status ${response.status}` }
  }
  if (!response.body) {
    return { ok: false, reason: 'network', message: 'Response had no body' }
  }

  const resuming = existingSize > 0 && response.status === 206
  const hash = createHash('sha256')
  const contentLength = Number(response.headers.get('content-length') ?? 0)

  let received = 0
  let total = 0
  let handle: Awaited<ReturnType<typeof open>>

  try {
    if (resuming) {
      await hashExistingBytes(hash, partPath)
      received = existingSize
      total = existingSize + contentLength
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

  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      await handle.write(value)
      received += value.byteLength
      onProgress?.(received, total)
    }
  } catch (error) {
    // A dropped connection leaves the .part in place so a later call can resume;
    // deletePartial is the cleanup path for an abandoned install.
    await handle.close()
    if (isDiskError(error)) return { ok: false, reason: 'disk', message: messageOf(error) }
    return { ok: false, reason: 'network', message: messageOf(error) }
  }

  await handle.close()

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
