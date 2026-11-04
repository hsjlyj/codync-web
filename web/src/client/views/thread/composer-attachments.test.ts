import { describe, expect, it } from 'vitest'
import { pickedFiles } from './composer-files'

// pickedFiles 只读 name/size/lastModified；size 用 defineProperty 注入，
// 避免 jsdom 为 101 MB 的 File 真实分配内存（worker 会 OOM）。
const file = (name: string, size = 100, lastModified = 1) => {
  const f = new File(['x'], name, { lastModified })
  if (f.size !== size) Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('pickedFiles', () => {
  it('adds new files and keeps existing ones', () => {
    const first = pickedFiles([], [file('a.txt')])
    expect(first.picked.map((p) => p.file.name)).toEqual(['a.txt'])
    const second = pickedFiles(first.picked, [file('b.txt', 5, 2)])
    expect(second.picked.map((p) => p.file.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('deduplicates by name+size+lastModified', () => {
    const first = pickedFiles([], [file('a.txt')])
    const second = pickedFiles(first.picked, [file('a.txt')])
    expect(second.picked).toHaveLength(1)
    expect(second.rejected).toEqual([])
  })

  it('rejects files over the 100 MB host limit and caps at 10', () => {
    const { picked, rejected } = pickedFiles([], [file('huge.bin', 101 * 1024 * 1024)])
    expect(picked).toHaveLength(0)
    expect(rejected[0]).toContain('超过 100 MB')
    const ten = Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`, 1, i))
    const full = pickedFiles([], ten)
    expect(full.picked).toHaveLength(10)
    const over = pickedFiles(full.picked, [file('f11.txt', 1, 99)])
    expect(over.picked).toHaveLength(10)
    expect(over.rejected[0]).toContain('最多 10 个')
  })
})
