/**
 * 用量查询编排（Phase 2）：主机 `usage` 方法，refresh=true 让主机向 agent 现取。
 * I/O 在 store 层，视图只调用；hello 事件带的 usage 是快照基线，这里可主动刷新。
 */
import type { Usage } from '@codync/shared'
import type { AppModel } from './app-model'

export async function fetchUsage(appModel: AppModel, refresh = false): Promise<Usage> {
  if (appModel.getSnapshot().connection !== 'open') throw new Error('未连接主机')
  return appModel.call<Usage>('usage', refresh ? { refresh: true } : {})
}
