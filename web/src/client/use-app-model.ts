'use client'

import { useSyncExternalStore } from 'react'
import { appModel, type AppSnapshot } from './store/app-model'

/** 把 AppModel 接入 React：快照不可变，changed() 触发重渲染。 */
export function useAppModel(): AppSnapshot {
  return useSyncExternalStore(appModel.subscribe, appModel.getSnapshot, appModel.getSnapshot)
}
