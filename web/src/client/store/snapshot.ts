/**
 * AppSnapshot —— useSyncExternalStore 的快照形状与初始值（自 app-model 拆出，
 * 供 app-model / bot-state / entry-state 共享类型而无循环依赖）。
 */
import type { Bot, Hello, Usage } from '@codync/shared'
import type { TransportStatus } from '../transport/host-transport'

export type ConnectionState = TransportStatus

export interface AppSnapshot {
  connection: ConnectionState
  statusDetail: string | undefined
  lastError: string | null
  hello: Hello | null
  usage: Usage | null
  bots: Bot[]
  selectedBotId: string | null
  rev: number
  /** entries 变化计数：ThreadView 依赖它重渲染（Phase 3 换虚拟列表 + 细粒度订阅）。 */
  entriesVersion: number
  pendingSends: number
  /** 正在回应的权限卡片（PermissionCard 按钮转圈用）。 */
  respondingEntryId: string | null
}

export const INITIAL: AppSnapshot = {
  connection: 'idle',
  statusDetail: undefined,
  lastError: null,
  hello: null,
  usage: null,
  bots: [],
  selectedBotId: null,
  rev: 0,
  entriesVersion: 0,
  pendingSends: 0,
  respondingEntryId: null,
}
