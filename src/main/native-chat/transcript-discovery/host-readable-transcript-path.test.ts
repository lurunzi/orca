import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetHostReadableTranscriptPathCacheForTests,
  wslCursorProjectsDirs
} from './host-readable-transcript-path'

const UBUNTU_HOME = '\\\\wsl.localhost\\Ubuntu\\home\\ada'

beforeEach(() => {
  resetHostReadableTranscriptPathCacheForTests()
})

describe('wslCursorProjectsDirs', () => {
  it('reuses cached WSL homes across resolve-poll ticks', async () => {
    const listWslHomeDirs = vi.fn(async () => [UBUNTU_HOME])

    await expect(wslCursorProjectsDirs({ platform: 'win32', listWslHomeDirs })).resolves.toEqual([
      `${UBUNTU_HOME}\\.cursor\\projects`
    ])
    await wslCursorProjectsDirs({ platform: 'win32', listWslHomeDirs })

    expect(listWslHomeDirs).toHaveBeenCalledTimes(1)
  })
})
