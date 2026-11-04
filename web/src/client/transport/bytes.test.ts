import { describe, expect, it } from 'vitest'
import { byteCount, chunkRanges, fromBase64, toBase64, UPLOAD_CHUNK } from './bytes'

describe('toBase64 / fromBase64', () => {
  // 384KB 边界 roundtrip 本体 <100ms；显式超时 15s 兜底 jsdom 并行负载抖动
  // 本用例曾偶发超时（试金/榫卯复现），见 development-setup.md 已知坑
  it('roundtrips bytes of every size around the chunk boundary', { timeout: 15000 }, () => {
    for (const size of [0, 1, 2, 3, 76, 1024, UPLOAD_CHUNK, UPLOAD_CHUNK + 1]) {
      const bytes = new Uint8Array(size)
      for (let i = 0; i < size; i++) bytes[i] = (i * 7 + 13) % 256
      expect(fromBase64(toBase64(bytes))).toEqual(bytes)
    }
  })

  it('matches the platform encoder on known vectors', () => {
    expect(toBase64(new Uint8Array([0, 0, 0]))).toBe('AAAA')
    // "hello" → aGVsbG8= (standard, padded) — host decodes with base64::STANDARD.
    expect(toBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=')
    expect(new TextDecoder().decode(fromBase64('aGVsbG8='))).toBe('hello')
  })

  it('encodes large arrays without call-stack overflow', () => {
    const bytes = new Uint8Array(UPLOAD_CHUNK * 2).fill(65)
    expect(fromBase64(toBase64(bytes)).length).toBe(UPLOAD_CHUNK * 2)
  })
})

describe('chunkRanges', () => {
  it('splits into aligned ranges with the last one ending at size', () => {
    expect(chunkRanges(UPLOAD_CHUNK + 5, UPLOAD_CHUNK)).toEqual([
      [0, UPLOAD_CHUNK],
      [UPLOAD_CHUNK, UPLOAD_CHUNK + 5],
    ])
    expect(chunkRanges(UPLOAD_CHUNK, UPLOAD_CHUNK)).toEqual([[0, UPLOAD_CHUNK]])
  })

  it('is empty for empty files', () => {
    expect(chunkRanges(0)).toEqual([])
  })
})

describe('byteCount', () => {
  it('formats like the desktop app', () => {
    expect(byteCount(999)).toBe('999 B')
    expect(byteCount(1000)).toBe('1.0 KB')
    expect(byteCount(1234 * 1000)).toBe('1.2 MB')
    expect(byteCount(5_600_000_000)).toBe('5.6 GB')
  })
})
