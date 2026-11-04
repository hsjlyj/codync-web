/**
 * MockTransport 的演示目录树（自 mock-transport.ts 纯搬移）：
 * ~/demo（git）+ ~/projects 工程，供 FolderPicker 逐级浏览。
 * 拆出原因：mock-transport 已过 500 行红线，Phase 3 的 term/screen 模拟另入 mock-remote.ts。
 */
import type { DirListing } from '@codync/shared'

export function demoDirListing(path: string): DirListing {
  const root: DirListing = {
    path: '',
    parent: null,
    isGit: false,
    recent: [
      { path: '~/demo', usedAt: Date.now() },
      { path: '~/projects/codync-web', usedAt: Date.now() - 3600_000 },
    ],
    dirs: [
      { path: '~', name: '~（个人主目录）', isGit: false },
      { path: '~/projects', name: 'projects', isGit: false },
    ],
  }
  const home: DirListing = {
    path: '~',
    parent: '',
    isGit: false,
    ancestors: [{ path: '', name: '根目录', isGit: false }],
    dirs: [
      { path: '~/demo', name: 'demo', isGit: true },
      { path: '~/projects', name: 'projects', isGit: false },
    ],
  }
  const projects: DirListing = {
    path: '~/projects',
    parent: '~',
    isGit: false,
    ancestors: [
      { path: '', name: '根目录', isGit: false },
      { path: '~', name: '~', isGit: false },
    ],
    dirs: [{ path: '~/projects/codync-web', name: 'codync-web', isGit: true }],
  }
  const leaf = (path: string, parent: string, isGit: boolean): DirListing => ({
    path,
    parent,
    isGit,
    ancestors: [
      { path: '', name: '根目录', isGit: false },
      { path: '~', name: '~', isGit: false },
      { path: '~/projects', name: 'projects', isGit: false },
    ],
    dirs: [],
  })
  const table: Record<string, DirListing> = {
    '': root,
    '~': home,
    '~/projects': projects,
    '~/projects/codync-web': leaf('~/projects/codync-web', '~/projects', true),
    '~/demo': {
      ...leaf('~/demo', '~', true),
      ancestors: [
        { path: '', name: '根目录', isGit: false },
        { path: '~', name: '~', isGit: false },
      ],
    },
  }
  return (
    table[path] ?? {
      path,
      parent: '~',
      isGit: false,
      ancestors: [
        { path: '', name: '根目录', isGit: false },
        { path: '~', name: '~', isGit: false },
      ],
      dirs: [],
    }
  )
}
