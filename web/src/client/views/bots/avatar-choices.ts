/** 头像外观常量（桌面端 lib/theme.ts 的 AVATAR_COLORS/AVATAR_SHAPES 同源子集）。 */
export interface AvatarColorChoice {
  id: string
  label: string
  hex: string
}

export const AVATAR_COLORS: AvatarColorChoice[] = [
  { id: 'black', label: '黑', hex: '#2B2B2B' },
  { id: 'brown', label: '棕', hex: '#936439' },
  { id: 'red', label: '红', hex: '#FF263C' },
  { id: 'orange', label: '橙', hex: '#FF6700' },
  { id: 'yellow', label: '黄', hex: '#FF9800' },
  { id: 'green', label: '绿', hex: '#00C972' },
  { id: 'cyan', label: '青', hex: '#00BCA6' },
  { id: 'blue', label: '蓝', hex: '#1084FE' },
  { id: 'violet', label: '紫', hex: '#9159FE' },
  { id: 'magenta', label: '品红', hex: '#FF309B' },
  { id: 'gray', label: '灰', hex: '#777777' },
]

export const AVATAR_SHAPES = ['blob', 'pebble', 'squircle', 'tablet', 'wedge', 'hex', 'cloud', 'teardrop'] as const

export type AvatarShape = (typeof AVATAR_SHAPES)[number]

/** 按 id 取色值；未知 id 回落 blue（桌面端 avatarColor 同语义）。 */
export function avatarHex(id: string): string {
  return (AVATAR_COLORS.find((c) => c.id === id) ?? AVATAR_COLORS[7]!).hex
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

/** 新建草稿：随机外观、Claude、空 cwd（请求主机个人工作区）、ask 权限（桌面端 drafts.ts 同语义）。 */
export function newDraft(): { name: string; description: string; avatarColor: string; avatarShape: string; backend: string; cwd: string; permission: string } {
  return {
    name: '',
    description: '',
    avatarColor: pick(AVATAR_COLORS).id,
    avatarShape: pick(AVATAR_SHAPES),
    backend: 'claude',
    cwd: '',
    permission: 'ask',
  }
}

/** 保存的 bot 必须有名字；新建的可以没有（主机在首次对话后命名）。 */
export const isValidDraft = (name: string) => name.trim() !== ''

/** 后端不在可用列表时改用第一个可用的 curated 后端（桌面端 fillDefaults 同语义）。 */
export function fillBackendDefault(backend: string, backends: Array<{ id: string; available: boolean; curated?: boolean }>): string {
  const first = backends.find((b) => b.available && b.curated === true)
  if (backends.find((b) => b.id === backend)?.available !== true && first) return first.id
  return backend
}
