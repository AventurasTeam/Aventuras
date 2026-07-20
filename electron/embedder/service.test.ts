import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { __setPipelineFactoryForTest, embed, evictPipeline, listInstalled } from './service'

const { USERDATA } = vi.hoisted(() => ({
  USERDATA: `${process.env.TMPDIR ?? '/tmp'}/ave-service-test-${process.pid}-${Math.random()
    .toString(36)
    .slice(2)}`,
}))

vi.mock('electron', () => ({ app: { getPath: () => USERDATA } }))

const embeddersDir = join(USERDATA, 'embedders')

afterAll(() => {
  __setPipelineFactoryForTest(null)
  rmSync(USERDATA, { recursive: true, force: true })
})

describe('pipeline cache eviction', () => {
  it('rebuilds the pipeline after evictPipeline so a re-download is not served stale', async () => {
    let builds = 0
    __setPipelineFactoryForTest(async () => {
      builds += 1
      return async (texts: string[]) => ({
        tolist: () => texts.map(() => [1, 2, 3]),
        dims: [texts.length, 3],
      })
    })

    const dir = '/models/x'
    await embed({ modelDir: dir, texts: ['a'] })
    await embed({ modelDir: dir, texts: ['b'] })
    expect(builds).toBe(1)

    evictPipeline(dir)
    await embed({ modelDir: dir, texts: ['c'] })
    expect(builds).toBe(2)

    __setPipelineFactoryForTest(null)
  })
})

describe('listInstalled resilience', () => {
  beforeEach(() => {
    rmSync(embeddersDir, { recursive: true, force: true })
    mkdirSync(embeddersDir, { recursive: true })
  })

  it('skips a folder with a corrupt meta.json and still lists a valid sibling', () => {
    const valid = join(embeddersDir, 'valid--model')
    mkdirSync(valid)
    writeFileSync(join(valid, 'model.onnx'), 'weights')
    writeFileSync(join(valid, 'meta.json'), JSON.stringify({ id: 'valid/model', installedAt: 123 }))

    const corrupt = join(embeddersDir, 'corrupt--model')
    mkdirSync(corrupt)
    writeFileSync(join(corrupt, 'model.onnx'), 'weights')
    writeFileSync(join(corrupt, 'meta.json'), '{ not valid json')

    const installed = listInstalled()
    expect(installed).toHaveLength(1)
    const [entry] = installed
    expect(entry).toMatchObject({ id: 'valid/model', installedAt: 123 })
    expect(entry?.sizeBytes).toBeGreaterThan(0)
  })
})
