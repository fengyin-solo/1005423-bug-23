import { migratePatrolRows } from './patrol-rules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-patrol:entries'
// 数据口径版本：版本号落后于 DATA_VERSION 的存量数据，读取时先按现行口径迁移再返回。
const VERSION_KEY = 'geohazard-patrol:version'
const DATA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 种子数据本身是改口径前的存量，播种前先按现行口径重判一遍。
function seedRows(): Record<string, EntryRow[]> {
  const seed = clone(SEED_ROWS)
  seed['patrol'] = migratePatrolRows(seed['patrol'] ?? []).rows
  return seed
}

// 改口径之后存量记录按新的标准重判一遍：巡查模块去重、重判、越界挡回。
function migrateIfNeeded(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return data
  }
  const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
  if (version >= DATA_VERSION) {
    return data
  }
  const next = { ...data, patrol: migratePatrolRows(data['patrol'] ?? []).rows }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.localStorage.setItem(VERSION_KEY, String(DATA_VERSION))
  return next
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedRows()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(DATA_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return migrateIfNeeded({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(DATA_VERSION))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = seedRows()[key] ?? []
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
